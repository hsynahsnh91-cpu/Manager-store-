/**
 * خدمة المشتريات — إنشاء واستلام الفواتير وزيادة المخزون.
 * السياسة: الطلب (ordered) لا يلمس المخزون، الاستلام (received) يزيد الكمية
 * ويحدّث متوسط التكلفة المرجّح: (قيمة المخزون الحالي + قيمة الوارد) ÷ الكمية الجديدة.
 */
import type { Purchase, PurchaseItem, CashTransaction, Product } from '../types';
import { getAll, getDB, putItem } from './db';
import { uid } from '../utils/id';
import { addMoney, mulMoney, round2, subMoney, sumMoney } from '../utils/money';

export type PurchaseInput = Omit<
  Purchase,
  'id' | 'number' | 'createdAt' | 'items' | 'subtotal' | 'total' | 'remaining' | 'cancelReason' | 'cancelledAt' | 'clientToken'
> & {
  items: Omit<PurchaseItem, 'lineTotal'>[];
  number?: string;
};

export async function listPurchases(): Promise<Purchase[]> {
  const items = await getAll<Purchase>('purchases');
  return items.sort((a, b) => b.date - a.date || b.createdAt - a.createdAt);
}

export async function getPurchase(id: string): Promise<Purchase | undefined> {
  const db = await getDB();
  return db.get('purchases', id);
}

export function computePurchaseTotals(items: Omit<PurchaseItem, 'lineTotal'>[], discount: number) {
  const withTotals: PurchaseItem[] = items.map((i) => ({
    ...i,
    lineTotal: mulMoney(i.quantity, i.unitCost),
  }));
  const subtotal = sumMoney(withTotals.map((i) => i.lineTotal));
  const safeDiscount = Math.max(0, Math.min(round2(discount), subtotal));
  const total = subMoney(subtotal, safeDiscount);
  return { items: withTotals, subtotal, discount: safeDiscount, total };
}

/** إنشاء فاتورة شراء (تُحفظ بالحالة المحددة — نقدية أو آجلة) */
export async function createPurchase(
  input: Omit<PurchaseInput, 'id' | 'createdAt'> & { number: string; clientToken?: string },
): Promise<Purchase> {
  const { items, subtotal, discount, total } = computePurchaseTotals(input.items, input.discount);
  const paid = Math.max(0, Math.min(round2(input.paid), total));
  const remaining = subMoney(total, paid);
  const status = input.status === 'cancelled' ? 'cancelled' : input.status;
  const purchase: Purchase = {
    ...input,
    id: uid('pur'),
    number: input.number,
    items,
    subtotal,
    discount,
    total,
    paid,
    remaining,
    status,
    clientToken: input.clientToken ?? uid('tok'),
    cancelReason: '',
    cancelledAt: null,
    createdAt: Date.now(),
  };
  await putItem('purchases', purchase);
  return purchase;
}

/**
 * استلام عملية شراء (تُستدعى مرة واحدة فقط لكل فاتورة):
 * 1) التحقق من أن الفاتورة لم تُستلم سلفًا (حماية من النقر المكرر).
 * 2) زيادة المخزون بالكميات المستلمة وتحديث متوسط التكلفة.
 * 3) تسجيل المدفوع في الصندوق.
 * تعمل ضمن معاملة واحدة لضمان الاتساق.
 */
export async function receivePurchase(purchaseId: string): Promise<Purchase> {
  const db = await getDB();
  const purchase = await db.get('purchases', purchaseId);
  if (!purchase) throw new Error('PURCHASE_NOT_FOUND');
  if (purchase.status === 'received') return purchase; // مُستلم مسبقًا — لا تكرار
  if (purchase.status === 'cancelled') throw new Error('PURCHASE_CANCELLED');

  const tx = db.transaction(['purchases', 'products', 'cash'], 'readwrite');
  try {
    const pStore = tx.objectStore('purchases');
    const fresh = await pStore.get(purchaseId);
    if (!fresh) throw new Error('PURCHASE_NOT_FOUND');
    if (fresh.status === 'received') {
      await tx.done;
      return fresh; // حصل تزامن — نعيد دون تكرار
    }

    const now = Date.now();
    const prodStore = tx.objectStore('products');
    for (const item of fresh.items) {
      const product = (await prodStore.get(item.productId)) as Product | undefined;
      if (!product) throw new Error(`PRODUCT_MISSING:${item.name}`);

      const oldQty = product.quantity;
      const oldValue = mulMoney(oldQty, product.purchasePrice);
      const incomingValue = mulMoney(item.quantity, item.unitCost);
      const newQty = oldQty + item.quantity;
      const newCost = newQty > 0 ? round2((oldValue + incomingValue) / newQty) : item.unitCost;
      await prodStore.put({
        ...product,
        quantity: newQty,
        purchasePrice: newCost,
        updatedAt: now,
      });
    }

    const received: Purchase = { ...fresh, status: 'received' };
    await pStore.put(received);

    if (received.paid > 0) {
      const cashRec: CashTransaction = {
        id: uid('csh'),
        date: now,
        type: 'out',
        amount: received.paid,
        account: received.paymentMethod === 'bank' ? 'bank' : 'cash',
        category: 'مشتريات',
        description: `شراء ${received.number}${received.supplierName ? ` — ${received.supplierName}` : ''}`,
        refType: 'purchase',
        refId: received.id,
        createdAt: now,
      };
      await tx.objectStore('cash').put(cashRec);
    }

    await tx.done;
    return received;
  } catch (err) {
    try {
      tx.abort();
    } catch {
      /* noop */
    }
      void tx.done.catch(() => { /* مُعالَج: رفض مقصود بعد الإلغاء */ });
    throw err;
  }
}

/** إلغاء فاتورة شراء: للمستلمة يُعكس أثرها على المخزون (بتكلفة الفاتورة) ويُحفظ السجل */
export async function cancelPurchase(purchaseId: string, reason: string): Promise<Purchase> {
  const db = await getDB();
  const purchase = await db.get('purchases', purchaseId);
  if (!purchase) throw new Error('PURCHASE_NOT_FOUND');
  if (purchase.status === 'cancelled') return purchase;

  const tx = db.transaction(['purchases', 'products', 'cash'], 'readwrite');
  try {
    const pStore = tx.objectStore('purchases');
    const fresh = await pStore.get(purchaseId);
    if (!fresh) throw new Error('PURCHASE_NOT_FOUND');
    if (fresh.status === 'cancelled') {
      await tx.done;
      return fresh;
    }
    const now = Date.now();

    if (fresh.status === 'received') {
      const prodStore = tx.objectStore('products');
      for (const item of fresh.items) {
        const product = (await prodStore.get(item.productId)) as Product | undefined;
        if (product) {
          const newQty = Math.max(0, product.quantity - item.quantity);
          const newCost =
            newQty > 0 ? round2((product.quantity * product.purchasePrice - item.quantity * item.unitCost) / newQty) : product.purchasePrice;
          await prodStore.put({
            ...product,
            quantity: newQty,
            purchasePrice: Math.max(0, newCost),
            updatedAt: now,
          });
        }
      }
      // استرداد المدفوع إن كان نقدًا — كحركة صندوق مقابلة
      if (fresh.paid > 0) {
        const refund: CashTransaction = {
          id: uid('csh'),
          date: now,
          type: 'in',
          amount: fresh.paid,
          account: fresh.paymentMethod === 'bank' ? 'bank' : 'cash',
          category: 'استرداد شراء',
          description: `استرداد مبلغ شراء ${fresh.number}${reason ? ` — ${reason}` : ''}`,
          refType: 'manual',
          createdAt: now,
        };
        await tx.objectStore('cash').put(refund);
      }
    }

    const cancelled: Purchase = { ...fresh, status: 'cancelled', cancelReason: reason, cancelledAt: now };
    await pStore.put(cancelled);
    await tx.done;
    return cancelled;
  } catch (err) {
    try {
      tx.abort();
    } catch {
      /* noop */
    }
      void tx.done.catch(() => { /* مُعالَج: رفض مقصود بعد الإلغاء */ });
    throw err;
  }
}

export async function getNextPurchaseNumber(prefix: string): Promise<string> {
  const db = await getDB();
  const rec = await db.get('meta', 'purchaseCounter');
  const next = ((rec?.value as number | undefined) ?? 0) + 1;
  await db.put('meta', { key: 'purchaseCounter', value: next });
  return `${prefix}-${String(next).padStart(5, '0')}`;
}

/** تسديد دفعة للمورد: توزَّع على فواتير الشراء غير المسددة (الأقدم أولًا) */
export async function paySupplier(
  supplierId: string,
  supplierName: string,
  amount: number,
  method: 'cash' | 'bank',
  date: number,
  notes = '',
): Promise<{ paymentId: string; applied: number }> {
  const target = round2(amount);
  if (target <= 0) throw new Error('INVALID_AMOUNT');
  const db = await getDB();

  const tx = db.transaction(['purchases', 'cash', 'supplierPayments'], 'readwrite');
  try {
    const pStore = tx.objectStore('purchases');
    const all = (await pStore.getAll()) as Purchase[];
    const open = all
      .filter((p) => p.supplierId === supplierId && p.status === 'received' && p.remaining > 0)
      .sort((a, b) => a.date - b.date);

    let left = target;
    const paidIds: string[] = [];
    for (const p of open) {
      if (left <= 0) break;
      const apply = Math.min(left, p.remaining);
      const updated: Purchase = { ...p, paid: addMoney(p.paid, apply), remaining: subMoney(p.remaining, apply) };
      await pStore.put(updated);
      paidIds.push(p.id);
      left = subMoney(left, apply);
    }
    const applied = subMoney(target, left);
    if (applied <= 0) throw new Error('NO_OUTSTANDING');

    const paymentId = uid('spay');
    await tx.objectStore('supplierPayments').put({
      id: paymentId,
      date,
      supplierId,
      supplierName,
      purchaseIds: paidIds,
      amount: applied,
      method,
      notes,
      createdAt: Date.now(),
    });
    const cashRec: CashTransaction = {
      id: uid('csh'),
      date,
      type: 'out',
      amount: applied,
      account: method === 'bank' ? 'bank' : 'cash',
      category: 'سداد مورد',
      description: `سداد للمورد ${supplierName}${notes ? ` — ${notes}` : ''}${paidIds.length ? ` (${paidIds.length} فاتورة)` : ''}`,
      refType: 'supplier_payment',
      refId: paymentId,
      createdAt: Date.now(),
    };
    await tx.objectStore('cash').put(cashRec);
    await tx.done;
    return { paymentId, applied };
  } catch (err) {
    try {
      tx.abort();
    } catch {
      /* noop */
    }
      void tx.done.catch(() => { /* مُعالَج: رفض مقصود بعد الإلغاء */ });
    throw err;
  }
}
