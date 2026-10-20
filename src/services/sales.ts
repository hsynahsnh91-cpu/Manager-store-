/**
 * خدمة المبيعات — نقطة البيع وفواتير المبيعات.
 * القواعد:
 * - عملية بيع واحدة = معاملة ذرية واحدة (فاتورة + خصم مخزون + حركة صندوق).
 * - مفتاح clientToken يمنع البيع المكرر على مستوى قاعدة البيانات.
 * - تكلفة البضاعة (COGS) تُجمَع في لقطة داخل الفاتورة ولا تتغير بتغيّر سعر المنتج لاحقًا.
 */
import type { CashTransaction, Invoice, InvoiceItem, Product } from '../types';
import { getAll, getDB } from './db';
import { uid } from '../utils/id';
import { mulCost, mulMoney, round2, subMoney, sumMoney } from '../utils/money';

export interface SaleLine {
  /** معرّف المنتج — أو فارغ مع customName لبيع سريع غير مخزني */
  productId: string;
  quantity: number; // بوحدة البيع (تقبل الكسور للوزن)
  unitPrice?: number; // إن لم يُمرَّر يُستخدم سعر المنتج الحالي
  /** بيع سريع لصنف غير موجود في الدليل — لا يخصم مخزونًا */
  customName?: string;
  customUnit?: string;
  customCost?: number;
}

export interface CreateSaleInput {
  lines: SaleLine[];
  customerId: string | null;
  customerName?: string;
  discount: number;
  paid: number;
  paymentMethod: Invoice['paymentMethod'];
  clientToken: string; // مولّد في الواجهة قبل الإرسال — مفتاح ضد التكرار
  notes?: string;
  date?: number;
}

export class SaleError extends Error {
  constructor(
    public code:
      | 'EMPTY_CART'
      | 'PRODUCT_NOT_FOUND'
      | 'INSUFFICIENT_STOCK'
      | 'DUPLICATE_SALE'
      | 'INVALID_AMOUNT',
    public detail?: string,
  ) {
    super(code);
    this.name = 'SaleError';
  }
}

/** حساب إجماليات السلة من دون لمس القاعدة (يُستخدم في شاشة البيع) */
export function computeCartTotals(
  lines: { productId: string; name?: string; quantity: number; unitPrice: number }[],
  discount: number,
  paid: number,
): { subtotal: number; discount: number; total: number; paid: number; remaining: number } {
  const subtotal = sumMoney(lines.map((l) => mulMoney(l.quantity, l.unitPrice)));
  const safeDiscount = Math.max(0, Math.min(round2(discount), subtotal));
  const total = subMoney(subtotal, safeDiscount);
  const safePaid = Math.max(0, round2(paid));
  const remaining = Math.max(0, subMoney(total, safePaid));
  return { subtotal, discount: safeDiscount, total, paid: Math.min(safePaid, total), remaining };
}

/**
 * إنشاء فاتورة بيع داخل معاملة ذرية واحدة.
 * - يتحقق من توافر المخزون (إلا إذا كان البيع السالب مسموحًا في الإعدادات).
 * - يخصم الكميات، يحفظ الفاتورة، ويسجّل المدفوع نقدًا في الصندوق.
 * - النقر المتكرر بنفس clientToken يعيد الفاتورة الموجودة ولا يكرر الخصم.
 */
export async function createSale(
  input: CreateSaleInput,
  opts: { allowNegativeStock?: boolean; nextInvoiceNumber: string },
): Promise<Invoice> {
  if (input.lines.length === 0) throw new SaleError('EMPTY_CART');
  if (!Number.isFinite(input.paid) || input.paid < 0) throw new SaleError('INVALID_AMOUNT');

  const db = await getDB();

  // فحص مبكر موحد ضد التكرار
  const existingByToken = await db.getFromIndex('invoices', 'by-token', input.clientToken);
  if (existingByToken) return existingByToken;

  const tx = db.transaction(['invoices', 'products', 'cash'], 'readwrite');
  try {
    // فحص التكرار داخل المعاملة أيضًا
    const dup = await tx.objectStore('invoices').index('by-token').get(input.clientToken);
    if (dup) {
      await tx.done;
      return dup;
    }

    const productStore = tx.objectStore('products');
    const invoiceStore = tx.objectStore('invoices');

    // 1) قراءة المنتجات والتحقق من الكمية
    const items: InvoiceItem[] = [];
    const productsToUpdate: Product[] = [];
    for (const line of input.lines) {
      // بيع سريع: لا منتج ولا خصم مخزون — يُسجَّل الاسم والسعر في الفاتورة فقط
      if (line.customName) {
        const name = line.customName.trim();
        if (!name) throw new SaleError('PRODUCT_NOT_FOUND');
        if (!(line.quantity > 0)) throw new SaleError('INVALID_AMOUNT', name);
        const unitPrice = line.unitPrice ?? 0;
        items.push({
          productId: `custom:${name.toLowerCase()}`,
          name,
          code: '',
          quantity: line.quantity,
          unitPrice,
          unitCost: Math.max(0, line.customCost ?? 0),
          lineTotal: mulMoney(line.quantity, unitPrice),
          unit: line.customUnit ?? '',
        });
        continue;
      }

      const product = await productStore.get(line.productId);
      if (!product) throw new SaleError('PRODUCT_NOT_FOUND', line.productId);
      if (line.quantity <= 0) throw new SaleError('INVALID_AMOUNT', product.name);
      if (!opts.allowNegativeStock && product.quantity < line.quantity) {
        throw new SaleError('INSUFFICIENT_STOCK', product.name);
      }
      const unitPrice = line.unitPrice ?? product.salePrice;
      items.push({
        productId: product.id,
        name: product.name,
        code: product.code,
        quantity: line.quantity,
        unitPrice,
        unitCost: product.purchasePrice, // لقطة التكلفة التاريخية
        lineTotal: mulMoney(line.quantity, unitPrice),
        unit: product.saleUnit ?? product.unit ?? '',
      });
      productsToUpdate.push(product);
    }

    // 2) الحسابات
    const subtotal = sumMoney(items.map((i) => i.lineTotal));
    const discount = Math.max(0, Math.min(round2(input.discount), subtotal));
    const total = subMoney(subtotal, discount);
    const paid = Math.max(0, Math.min(round2(input.paid), total));
    const remaining = subMoney(total, paid);
    const cogs = sumMoney(items.map((i) => mulCost(i.quantity, i.unitCost)));
    const status: Invoice['status'] =
      remaining <= 0 ? 'paid' : paid > 0 ? 'partial' : 'unpaid';

    const now = Date.now();
    const invoice: Invoice = {
      id: uid('inv'),
      number: opts.nextInvoiceNumber,
      date: input.date ?? now,
      customerId: input.customerId,
      customerName: input.customerName ?? '',
      items,
      subtotal,
      discount,
      total,
      paid,
      remaining,
      paymentMethod: input.paymentMethod,
      status,
      cogs,
      initialPaid: paid,
      clientToken: input.clientToken,
      cancelReason: '',
      cancelledAt: null,
      notes: input.notes ?? '',
      createdAt: now,
    };

    // 3) خصم المخزون
    for (let i = 0; i < items.length; i++) {
      const product = productsToUpdate[i];
      const line = items[i];
      await productStore.put({ ...product, quantity: product.quantity - line.quantity, updatedAt: now });
    }

    // 4) حفظ الفاتورة
    await invoiceStore.put(invoice);

    // 5) تسجيل المدفوع في الصندوق (لا يُسجَّل المتبقي — يُحصَّل لاحقًا كدفعة عميل)
    if (paid > 0) {
      const account = input.paymentMethod === 'bank' ? 'bank' : 'cash';
      const cashRec: CashTransaction = {
        id: uid('csh'),
        date: now,
        type: 'in',
        amount: paid,
        account,
        category: 'بيع',
        description: `بيع فاتورة ${invoice.number}${input.customerName ? ` — ${input.customerName}` : ''}`,
        refType: 'sale',
        refId: invoice.id,
        createdAt: now,
      };
      await tx.objectStore('cash').put(cashRec);
    }

    await tx.done;
    return invoice;
  } catch (err) {
    try {
      tx.abort();
    } catch {
      // المعاملة قد تكون انتهت بالفعل
    }
      void tx.done.catch(() => { /* مُعالَج: رفض مقصود بعد الإلغاء */ });
    if (err instanceof SaleError) {
      if (err.code === 'DUPLICATE_SALE') {
        const again = await db.getFromIndex('invoices', 'by-token', input.clientToken);
        if (again) return again;
      }
      throw err;
    }
    // رقعة ضد تكرار غير متوقع من فهرس unique
    const conflict = String((err as Error)?.name ?? '');
    if (conflict === 'ConstraintError') {
      const existing = await db.getFromIndex('invoices', 'by-token', input.clientToken);
      if (existing) return existing;
    }
    throw err;
  }
}

/**
 * إلغاء/مرتجع فاتورة: يحفظ السجل المالي كما هو، يعلّمه ملغى،
 * يعيد الكميات للمخزون، ويقيّد استرداد المدفوع كحركة صندوق صادرة.
 * لا يُحذف أي سجل تاريخي.
 */
export async function cancelInvoice(
  invoiceId: string,
  reason: string,
): Promise<Invoice> {
  const db = await getDB();
  const tx = db.transaction(['invoices', 'products', 'cash'], 'readwrite');
  try {
    const inv = await tx.objectStore('invoices').get(invoiceId);
    if (!inv) throw new Error('INVOICE_NOT_FOUND');
    if (inv.status === 'cancelled') {
      await tx.done;
      return inv;
    }

    const now = Date.now();
    const cancelled: Invoice = {
      ...inv,
      status: 'cancelled',
      cancelReason: reason,
      cancelledAt: now,
      // الاحتفاظ بالمبالغ التاريخية للسجل — الاسترداد يظهر كحركة صندوق منفصلة
    };
    await tx.objectStore('invoices').put(cancelled);

    // إرجاع الكميات للمخزون (بتكلفة الفاتورة الأصلية — لا نعدّل التاريخ)
    const productStore = tx.objectStore('products');
    for (const item of inv.items) {
      const product = await productStore.get(item.productId);
      if (product) {
        await productStore.put({ ...product, quantity: product.quantity + item.quantity, updatedAt: now });
      }
    }

    // استرداد المدفوع نقدًا إن وجد
    if (inv.paid > 0) {
      const account = inv.paymentMethod === 'bank' ? 'bank' : 'cash';
      const refund: CashTransaction = {
        id: uid('csh'),
        date: now,
        type: 'out',
        amount: inv.paid,
        account,
        category: 'مرتجع',
        description: `استرداد فاتورة ${inv.number}${reason ? ` — ${reason}` : ''}`,
        refType: 'invoice_cancel',
        refId: inv.id,
        createdAt: now,
      };
      await tx.objectStore('cash').put(refund);
    }

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

/** جميع الفواتير (الأحدث أولًا) */
export async function listInvoices(): Promise<Invoice[]> {
  const items = await getAll<Invoice>('invoices');
  return items.sort((a, b) => b.date - a.date || b.createdAt - a.createdAt);
}

export async function getInvoice(id: string): Promise<Invoice | undefined> {
  const db = await getDB();
  return db.get('invoices', id);
}

/** الرقم التسلسلي للفاتورة التالية — يُقرأ من meta ويُحدَّث داخل معاملة البيع */
export async function getNextInvoiceNumber(prefix: string): Promise<string> {
  const db = await getDB();
  const rec = await db.get('meta', 'invoiceCounter');
  const next = ((rec?.value as number | undefined) ?? 0) + 1;
  await db.put('meta', { key: 'invoiceCounter', value: next });
  return `${prefix}-${String(next).padStart(5, '0')}`;
}
