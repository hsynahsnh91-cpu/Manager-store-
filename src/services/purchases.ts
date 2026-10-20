/**
 * خدمة المشتريات — دعم الشراء بالكرتونة/الربطة والبيع بالقطعة.
 *
 * السياسة المحاسبية:
 * - الفاتورة «طلبية» (ordered) لا تلمس المخزون ولا التكلفة.
 * - الاستلام (received) يزيد الكمية ويحدّث متوسط التكلفة المرجّح:
 *   (قيمة المخزون الحالي + قيمة الوارد) ÷ الكمية الجديدة.
 * - الكمية تُحوَّل دائمًا إلى وحدة البيع الأساسية قبل التحديث، وكذلك التكلفة
 *   (بعد توزيع الخصم والتكاليف الإضافية مثل النقل) — فلا يختلط سعر الكرتونة بسعر القطعة.
 * - كل تغيّر في تكلفة الشراء يُسجَّل في سجل الأسعار مع المصدر والتاريخ.
 * - تحديث سعر البيع لا يحدث هنا إطلاقًا؛ يُعاد اقتراحه لصاحب المحل ليعتمده.
 * - إلغاء الفاتورة يعكس المخزون والتكلفة ويحفظ السجل التاريخي.
 */
import type {
  CashTransaction,
  PriceChange,
  Product,
  Purchase,
  PurchaseItem,
} from '../types';
import { getAll, getDB, putItem } from './db';
import { uid } from '../utils/id';
import { addMoney, mulCost, round2, round4, subMoney, sumMoney } from '../utils/money';
import { normalizeUnit, toBaseQuantity, unitDef } from '../utils/units';

export type PurchaseInput = Omit<
  Purchase,
  | 'id'
  | 'number'
  | 'createdAt'
  | 'items'
  | 'subtotal'
  | 'total'
  | 'remaining'
  | 'cancelReason'
  | 'cancelledAt'
  | 'clientToken'
> & {
  items: Omit<PurchaseItem, 'lineTotal'>[];
  number?: string;
  clientToken?: string;
};

export class PurchaseError extends Error {
  constructor(
    public code:
      | 'UNIT_CONVERSION_REQUIRED'
      | 'INVALID_QUANTITY'
      | 'PRODUCT_NOT_FOUND'
      | 'EMPTY_ITEMS'
      | 'NO_OUTSTANDING',
    public detail?: string,
  ) {
    super(code);
    this.name = 'PurchaseError';
  }
}

export async function listPurchases(): Promise<Purchase[]> {
  const items = await getAll<Purchase>('purchases');
  return items.sort((a, b) => b.date - a.date || b.createdAt - a.createdAt);
}

export async function getPurchase(id: string): Promise<Purchase | undefined> {
  const db = await getDB();
  return db.get('purchases', id);
}

/**
 * توزيع الخصم والتكاليف الإضافية على البنود ثم حساب تكلفة الوحدة الأساسية.
 * البنود المدخلة هنا بوحدة البيع الأساسية وبسعر إجمالي قبل الخصم.
 */
export function computePurchaseTotals(
  items: Omit<PurchaseItem, 'lineTotal'>[],
  discount: number,
  extraCosts = 0,
) {
  const withTotals: PurchaseItem[] = items.map((i) => ({
    ...i,
    lineTotal: mulCost(i.quantity, i.unitCost),
  }));
  const subtotal = sumMoney(withTotals.map((i) => i.lineTotal));
  const safeDiscount = Math.max(0, Math.min(round2(discount), subtotal));
  const safeExtra = Math.max(0, round2(extraCosts));
  const total = round2(subtotal - safeDiscount + safeExtra);

  const landed: PurchaseItem[] = withTotals.map((i) => {
    const share = subtotal > 0 ? i.lineTotal / subtotal : 0;
    const netValue = round2(i.lineTotal - safeDiscount * share + safeExtra * share);
    const unitCost = i.quantity > 0 ? round4(netValue / i.quantity) : 0;
    return { ...i, unitCost };
  });

  return { items: landed, subtotal, discount: safeDiscount, extraCosts: safeExtra, total };
}

/**
 * يحوّل سطر شراء كما يُدخله صاحب المحل (كرتونة × 12 مثلًا) إلى الكمية والتكلفة
 * بوحدة البيع الأساسية. يعيد خطأً واضحًا إذا كان التحويل غير محدد.
 */
export function preparePurchaseLine(
  product: Pick<Product, 'id' | 'name' | 'code' | 'saleUnit' | 'unit' | 'purchaseUnit' | 'unitsPerPurchase'>,
  enteredQuantity: number,
  enteredUnitCost: number,
  enteredUnit?: string,
): {
  item: Omit<PurchaseItem, 'lineTotal'> | null;
  factor: number | null;
  baseQuantity: number;
  error: 'UNIT_CONVERSION_REQUIRED' | 'INVALID_QUANTITY' | null;
} {
  const purchaseUnit = normalizeUnit(enteredUnit ?? product.purchaseUnit ?? product.saleUnit ?? 'piece');
  const saleUnit = normalizeUnit(product.saleUnit ?? product.unit ?? 'piece');
  const conv = toBaseQuantity(enteredQuantity, purchaseUnit, saleUnit, product.unitsPerPurchase);
  if (conv.error || !conv.factor) {
    return { item: null, factor: conv.factor, baseQuantity: 0, error: conv.error ?? 'UNIT_CONVERSION_REQUIRED' };
  }
  if (!Number.isFinite(enteredUnitCost) || enteredUnitCost < 0) {
    return { item: null, factor: conv.factor, baseQuantity: 0, error: 'INVALID_QUANTITY' };
  }

  const baseQuantity = conv.baseQuantity;
  const grossValue = mulCost(enteredQuantity, enteredUnitCost);
  const baseUnitCost = baseQuantity > 0 ? round4(grossValue / baseQuantity) : 0;

  return {
    item: {
      productId: product.id,
      name: product.name,
      code: product.code,
      quantity: baseQuantity,
      unitCost: baseUnitCost,
      enteredQuantity,
      enteredUnit: purchaseUnit,
      enteredUnitCost: round2(enteredUnitCost),
      unitsPerPurchase: conv.factor,
    },
    factor: conv.factor,
    baseQuantity,
    error: null,
  };
}

/** إنشاء فاتورة شراء (تُحفظ بالحالة المحددة — طلبية أو مستلمة لاحقًا) */
export async function createPurchase(
  input: Omit<PurchaseInput, 'id' | 'createdAt'> & { number: string; clientToken?: string },
): Promise<Purchase> {
  if (!input.items.length) throw new PurchaseError('EMPTY_ITEMS');
  const { items, subtotal, discount, extraCosts, total } = computePurchaseTotals(
    input.items,
    input.discount,
    input.extraCosts ?? 0,
  );
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
    extraCosts,
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

export interface ReceivedPriceChange {
  productId: string;
  productName: string;
  oldCost: number;
  newCost: number;
  salePrice: number;
  suggestedSalePrice: number | null;
}

/**
 * استلام عملية شراء (مرة واحدة فقط):
 * 1) تحويل الكميات إلى الوحدة الأساسية (تم عند الإنشاء).
 * 2) متوسط تكلفة مرجّح + سجل أسعار + آخر سعر من المورد.
 * 3) تسجيل المدفوع في الصندوق.
 * كل ذلك في معاملة واحدة. النقر المكرر لا يكرر الزيادة.
 */
export async function receivePurchase(purchaseId: string): Promise<Purchase> {
  const db = await getDB();
  const purchase = await db.get('purchases', purchaseId);
  if (!purchase) throw new Error('PURCHASE_NOT_FOUND');
  if (purchase.status === 'received') return purchase;
  if (purchase.status === 'cancelled') throw new Error('PURCHASE_CANCELLED');

  const tx = db.transaction(
    ['purchases', 'products', 'cash', 'priceHistory', 'supplierPrices'],
    'readwrite',
  );
  try {
    const pStore = tx.objectStore('purchases');
    const fresh = await pStore.get(purchaseId);
    if (!fresh) throw new Error('PURCHASE_NOT_FOUND');
    if (fresh.status === 'received') {
      await tx.done;
      return fresh;
    }

    const now = Date.now();
    const prodStore = tx.objectStore('products');
    const historyStore = tx.objectStore('priceHistory');
    const supplierLabel = fresh.supplierName ? ` — ${fresh.supplierName}` : '';
    const sourceLabel = `فاتورة مشتريات ${fresh.number}${supplierLabel}`;

    for (const item of fresh.items) {
      const product = await prodStore.get(item.productId);
      if (!product) throw new Error(`PRODUCT_MISSING:${item.name}`);

      const oldQty = product.quantity;
      const oldCost = product.purchasePrice;
      const oldValue = oldQty * oldCost;
      const incomingValue = item.quantity * item.unitCost;
      const newQty = round4(oldQty + item.quantity);
      const newCost = newQty > 0 ? round4((oldValue + incomingValue) / newQty) : item.unitCost;

      // أول استلام فعلي يُخرج الصنف من «دليل الأصناف» ليظهر في البيع
      await prodStore.put({
        ...product,
        quantity: newQty,
        purchasePrice: newCost,
        purchasePriceUpdatedAt: now,
        lastSupplierId: fresh.supplierId ?? product.lastSupplierId ?? null,
        catalogDraft: false,
        updatedAt: now,
      });

      if (newCost !== oldCost && newCost > 0) {
        await historyStore.put({
          id: uid('prc'),
          productId: product.id,
          productName: product.name,
          field: 'purchase',
          oldPrice: oldCost,
          newPrice: newCost,
          date: fresh.date,
          createdAt: now,
          source: 'purchase',
          sourceId: fresh.id,
          sourceLabel,
        } satisfies PriceChange);
      }

      if (fresh.supplierId) {
        // آخر سعر شراء لهذا المنتج من هذا المورّد — يُستبدل بالسجل الأحدث
        const spStore = tx.objectStore('supplierPrices');
        const previous = await spStore.index('by-supplier').getAll(fresh.supplierId);
        for (const row of previous) {
          if (row.productId === product.id) await spStore.delete(row.id);
        }
        await spStore.put({
          id: uid('spr'),
          supplierId: fresh.supplierId,
          supplierName: fresh.supplierName,
          productId: product.id,
          productName: product.name,
          // آخر سعر شراء فعلي لهذه الفاتورة (لا المتوسط المرجّح)
          unitCost: item.unitCost,
          unit: normalizeUnit(product.saleUnit ?? product.unit),
          date: fresh.date,
          source: 'purchase',
          sourceId: fresh.id,
          createdAt: now,
        });
      }
    }

    const received: Purchase = { ...fresh, status: 'received', receivedAt: now };
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
    void tx.done.catch(() => {
      /* مُعالَج: رفض مقصود بعد الإلغاء */
    });
    throw err;
  }
}

/** إلغاء فاتورة شراء: للمستلمة يُعكس أثرها على المخزون والتكلفة ويُحفظ السجل */
export async function cancelPurchase(purchaseId: string, reason: string): Promise<Purchase> {
  const db = await getDB();
  const purchase = await db.get('purchases', purchaseId);
  if (!purchase) throw new Error('PURCHASE_NOT_FOUND');
  if (purchase.status === 'cancelled') return purchase;

  const tx = db.transaction(
    ['purchases', 'products', 'cash', 'priceHistory', 'supplierPrices'],
    'readwrite',
  );
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
      const historyStore = tx.objectStore('priceHistory');
      for (const item of fresh.items) {
        const product = await prodStore.get(item.productId);
        if (!product) continue;
        const newQty = Math.max(0, round4(product.quantity - item.quantity));
        const newCost =
          newQty > 0
            ? round4((product.quantity * product.purchasePrice - item.quantity * item.unitCost) / newQty)
            : product.purchasePrice;
        const safeCost = Math.max(0, newCost);
        await prodStore.put({
          ...product,
          quantity: newQty,
          purchasePrice: safeCost,
          purchasePriceUpdatedAt: now,
          updatedAt: now,
        });
        if (safeCost !== product.purchasePrice) {
          await historyStore.put({
            id: uid('prc'),
            productId: product.id,
            productName: product.name,
            field: 'purchase',
            oldPrice: product.purchasePrice,
            newPrice: safeCost,
            date: now,
            createdAt: now,
            source: 'purchase',
            sourceId: fresh.id,
            sourceLabel: `إلغاء فاتورة ${fresh.number}${reason ? ` — ${reason}` : ''}`,
          } satisfies PriceChange);
        }
        // آخر سعر من المورد المرتبط بهذه الفاتورة لم يعد صالحًا
        if (fresh.supplierId) {
          const spStore = tx.objectStore('supplierPrices');
          const rows = await spStore.index('by-supplier').getAll(fresh.supplierId);
          for (const row of rows) {
            if (row.productId === item.productId && row.sourceId === fresh.id) {
              await spStore.delete(row.id);
            }
          }
        }
      }
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
    void tx.done.catch(() => {
      /* مُعالَج: رفض مقصود بعد الإلغاء */
    });
    throw err;
  }
}

export async function getNextPurchaseNumber(prefix: string): Promise<string> {
  const db = await getDB();
  const rec = await db.get('meta', 'purchaseCounter');
  const next = ((rec?.value as number) || 0) + 1;
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
  clientToken?: string,
): Promise<{ paymentId: string; applied: number; duplicate?: boolean }> {
  const target = round2(amount);
  if (target <= 0) throw new Error('INVALID_AMOUNT');
  const db = await getDB();

  if (clientToken) {
    const existing = await db.getFromIndex('supplierPayments', 'by-token', clientToken).catch(() => undefined);
    if (existing) {
      return { paymentId: existing.id, applied: existing.amount, duplicate: true };
    }
  }

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
    if (applied <= 0) throw new PurchaseError('NO_OUTSTANDING');

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
      clientToken,
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
    void tx.done.catch(() => {
      /* مُعالَج: رفض مقصود بعد الإلغاء */
    });
    throw err;
  }
}

/** عرض الوحدة في فاتورة الشراء: «كرتونة = 24 حبة» */
export function purchaseLineLabel(item: PurchaseItem, lang: 'ar' | 'en' = 'ar'): string {
  const def = unitDef(item.enteredUnit);
  const entered = item.enteredQuantity ?? item.quantity;
  const unitName = def.kind === 'count' ? (lang === 'ar' ? def.ar : def.en) : lang === 'ar' ? def.ar : def.en;
  const base = unitDef('piece');
  if (item.enteredUnit && item.unitsPerPurchase && item.unitsPerPurchase > 1 && def.kind === 'count') {
    return `${entered} ${unitName} = ${item.quantity} ${lang === 'ar' ? base.ar : base.en}`;
  }
  return `${entered} ${unitName}`;
}
