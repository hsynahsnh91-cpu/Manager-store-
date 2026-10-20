/**
 * سجل المبيعات اليدوي — تسجيل أي عملية بيع حتى لو لم تُنفَّذ من نقطة البيع.
 *
 * قواعد الاتساق:
 * - السجل اليدوي هو المصدر الوحيد لاحتساب مبيعاته في التقارير (لا يُنشئ فاتورة، فلا ازدواج).
 * - «بيع مخزني» = خصم كمية من المنتج + لقطة تكلفة (COGS) + حركة صندوق للمبلغ المحصّل،
 *   كلها داخل معاملة ذرية واحدة مع السجل.
 * - التعديل/الحذف يعيد ضبط المخزون والصندوق ثم يطبّق القيم الجديدة، ويُسجَّل في سجل المراجعة.
 * - clientToken فريد يمنع تكرار التسجيل بالنقر المزدوج.
 */
import type { CashTransaction, ManualSale, PaymentMethod, Product, SaleSourceType } from '../types';
import { getDB } from './db';
import { uid } from '../utils/id';
import { mulMoney, round2 } from '../utils/money';
import { startOfDay } from '../utils/dates';
import { logAudit, describeManualSale } from './audit';
import { categoryKey } from '../utils/text';

export class ManualSaleError extends Error {
  constructor(
    public code:
      | 'NAME_REQUIRED'
      | 'INVALID_QUANTITY'
      | 'INVALID_PRICE'
      | 'PRODUCT_NOT_FOUND'
      | 'INSUFFICIENT_STOCK'
      | 'NOT_FOUND',
    public detail?: string,
  ) {
    super(code);
    this.name = 'ManualSaleError';
  }
}

export interface CreateManualSaleInput {
  productId: string | null;
  productName: string;
  quantity: number;
  unitPrice: number;
  unitCost?: number | null;
  buyerName?: string;
  category?: string;
  note?: string;
  date?: number;
  source?: SaleSourceType;
  stockApplied?: boolean;
  paid?: number;
  paymentMethod?: PaymentMethod | 'credit';
  clientToken: string;
  /** إنشاء منتج جديد تلقائيًا مع البيع (بدل إجبار المستخدم على إنشاء منتج كامل أولًا) */
  createProduct?: {
    category: string;
    initialQuantity?: number;
    salePrice?: number;
  } | null;
}

export interface ManualSaleOptions {
  allowNegativeStock?: boolean;
  prefix?: string;
}

function normalizeSaleNumber(prefix: string, value: number): string {
  return `${prefix}-${String(value).padStart(5, '0')}`;
}

/** يمنع تكرار النقر: نفس التوكن يعيد السجل الموجود */
export async function createManualSale(
  input: CreateManualSaleInput,
  opts: ManualSaleOptions = {},
): Promise<{ sale: ManualSale; duplicate: boolean }> {
  const name = input.productName.trim();
  if (!name) throw new ManualSaleError('NAME_REQUIRED');
  if (!Number.isFinite(input.quantity) || input.quantity <= 0) throw new ManualSaleError('INVALID_QUANTITY');
  if (!Number.isFinite(input.unitPrice) || input.unitPrice < 0) throw new ManualSaleError('INVALID_PRICE');

  const db = await getDB();
  const existing = await db.getFromIndex('manualSales', 'by-token', input.clientToken);
  if (existing) return { sale: existing, duplicate: true };

  const quantity = round2(input.quantity);
  const unitPrice = round2(input.unitPrice);
  const total = mulMoney(quantity, unitPrice);
  const date = input.date ?? Date.now();
  const stockApplied = Boolean(input.stockApplied);
  const paid = Math.min(Math.max(0, round2(input.paid ?? total)), total);
  const paymentMethod: PaymentMethod | 'credit' = input.paymentMethod ?? 'cash';
  const prefix = opts.prefix || 'MS';

  const tx = db.transaction(['manualSales', 'products', 'cash', 'meta', 'categories'], 'readwrite');
  try {
    const productStore = tx.objectStore('products');

    // 1) المنتج: موجود أو يُنشأ الآن
    let product: Product | undefined;
    if (input.productId) {
      product = await productStore.get(input.productId);
      if (!product) throw new ManualSaleError('PRODUCT_NOT_FOUND', input.productId);
    } else if (input.createProduct) {
      const now = Date.now();
      const initialQuantity = Math.max(0, round2(input.createProduct.initialQuantity ?? 0));
      if (stockApplied && !opts.allowNegativeStock && initialQuantity < quantity) {
        throw new ManualSaleError('INSUFFICIENT_STOCK', name);
      }
      product = {
        id: uid('prd'),
        name,
        code: '',
        barcode: '',
        category: input.createProduct.category.trim(),
        purchasePrice: round2(input.unitCost ?? 0),
        salePrice: round2(input.createProduct.salePrice ?? unitPrice),
        quantity: initialQuantity,
        alertThreshold: 5,
        supplierId: null,
        description: '',
        archived: false,
        createdAt: now,
        updatedAt: now,
        purchasePriceUpdatedAt: round2(input.unitCost ?? 0) > 0 ? now : undefined,
        salePriceUpdatedAt: now,
      };
      await productStore.put(product);
      // ضمان وجود التصنيف في قاعدة التصنيفات
      const catName = input.createProduct.category.trim();
      if (catName) {
        const catId = uid('cat');
        const key = categoryKey(catName);
        const existingCat = await tx
          .objectStore('categories')
          .index('by-normalized')
          .get(key);
        if (!existingCat) {
          await tx.objectStore('categories').put({
            id: catId,
            name: catName,
            normalized: key,
            keywords: [],
            isDefault: false,
            createdAt: now,
            updatedAt: now,
          });
        }
      }
    }

    // 2) التحقق من المخزون والخصم
    if (stockApplied && product) {
      if (!opts.allowNegativeStock && product.quantity < quantity) {
        throw new ManualSaleError('INSUFFICIENT_STOCK', product.name);
      }
      const updated: Product = { ...product, quantity: round2(product.quantity - quantity), updatedAt: Date.now() };
      await productStore.put(updated);
    }

    // 3) الرقم التسلسلي
    const counterRec = await tx.objectStore('meta').get('manualSaleCounter');
    const nextCounter = ((counterRec?.value as number | undefined) ?? 0) + 1;
    await tx.objectStore('meta').put({ key: 'manualSaleCounter', value: nextCounter });

    const now = Date.now();
    const unitCost = input.unitCost === null || input.unitCost === undefined
      ? (product?.purchasePrice ?? null)
      : round2(input.unitCost);

    const sale: ManualSale = {
      id: uid('ms'),
      number: normalizeSaleNumber(prefix, nextCounter),
      date,
      productId: product?.id ?? null,
      productName: name,
      quantity,
      unitPrice,
      total,
      unitCost: unitCost !== null && Number.isFinite(unitCost) ? round2(unitCost) : null,
      buyerName: input.buyerName?.trim() ?? '',
      category: (input.category ?? product?.category ?? '').trim(),
      note: input.note?.trim() ?? '',
      source: input.source ?? 'manual',
      stockApplied,
      paid,
      paymentMethod,
      clientToken: input.clientToken,
      createdAt: now,
      updatedAt: now,
    };
    await tx.objectStore('manualSales').put(sale);

    // 4) حركة الصندوق (المحصّل فقط)
    if (paid > 0) {
      const cash: CashTransaction = {
        id: uid('csh'),
        date,
        type: 'in',
        amount: paid,
        account: paymentMethod === 'bank' ? 'bank' : 'cash',
        category: 'بيع يدوي',
        description: `${name} × ${quantity} — ${sale.number}`,
        refType: 'manual_sale',
        refId: sale.id,
        createdAt: now,
      };
      await tx.objectStore('cash').put(cash);
    }

    await tx.done;

    await logAudit({
      action: 'create',
      entity: 'manualSale',
      entityId: sale.id,
      summary: `تسجيل بيع يدوي ${sale.number}`,
      before: '',
      after: describeManualSale(sale),
    });

    return { sale, duplicate: false };
  } catch (err) {
    try {
      tx.abort();
    } catch {
      /* noop */
    }
    void tx.done.catch(() => {
      /* مُعالَج: رفض مقصود بعد الإلغاء */
    });
    if (err instanceof ManualSaleError) throw err;
    throw err;
  }
}

export interface UpdateManualSaleInput {
  productId?: string | null;
  productName?: string;
  quantity?: number;
  unitPrice?: number;
  unitCost?: number | null;
  buyerName?: string;
  category?: string;
  note?: string;
  date?: number;
  stockApplied?: boolean;
  paid?: number;
  paymentMethod?: PaymentMethod | 'credit';
}

/**
 * تعديل سجل بيع: يعيد ضبط أثر المخزون والصندوق ثم يطبّق القيم الجديدة،
 * دفعة واحدة (كل شيء أو لا شيء).
 */
export async function updateManualSale(
  id: string,
  patch: UpdateManualSaleInput,
  opts: ManualSaleOptions = {},
): Promise<ManualSale> {
  const db = await getDB();
  const tx = db.transaction(['manualSales', 'products', 'cash'], 'readwrite');
  try {
    const saleStore = tx.objectStore('manualSales');
    const productStore = tx.objectStore('products');
    const cashStore = tx.objectStore('cash');

    const current = await saleStore.get(id);
    if (!current) throw new ManualSaleError('NOT_FOUND', id);

    const quantity = patch.quantity !== undefined ? round2(patch.quantity) : current.quantity;
    const unitPrice = patch.unitPrice !== undefined ? round2(patch.unitPrice) : current.unitPrice;
    if (!(quantity > 0)) throw new ManualSaleError('INVALID_QUANTITY');
    if (!(unitPrice >= 0)) throw new ManualSaleError('INVALID_PRICE');

    const productName = (patch.productName ?? current.productName).trim();
    if (!productName) throw new ManualSaleError('NAME_REQUIRED');

    const nextProductId = patch.productId !== undefined ? patch.productId : current.productId;
    const stockApplied = patch.stockApplied !== undefined ? patch.stockApplied : current.stockApplied;

    // 1) إرجاع أثر المخزون القديم
    if (current.stockApplied && current.productId) {
      const oldProduct = await productStore.get(current.productId);
      if (oldProduct) {
        await productStore.put({
          ...oldProduct,
          quantity: round2(oldProduct.quantity + current.quantity),
          updatedAt: Date.now(),
        });
      }
    }

    // 2) تطبيق المخزون الجديد
    let product: Product | undefined;
    if (nextProductId) {
      product = await productStore.get(nextProductId);
      if (!product) throw new ManualSaleError('PRODUCT_NOT_FOUND', nextProductId);
      if (stockApplied) {
        if (!opts.allowNegativeStock && product.quantity < quantity) {
          throw new ManualSaleError('INSUFFICIENT_STOCK', product.name);
        }
        await productStore.put({
          ...product,
          quantity: round2(product.quantity - quantity),
          updatedAt: Date.now(),
        });
      }
    } else if (stockApplied) {
      throw new ManualSaleError('PRODUCT_NOT_FOUND');
    }

    const total = mulMoney(quantity, unitPrice);
    // إذا كان السجل مدفوعًا بالكامل ثم تغيّرت الكمية/السعر، نُبقي «مدفوعًا بالكامل»
    // ما لم يُمرَّر مبلغ صريح. وإلا نحافظ على المبلغ المحصّل الفعلي.
    const wasFullyPaid = Math.abs(current.paid - current.total) < 0.005;
    const paidInput = patch.paid !== undefined ? patch.paid : wasFullyPaid ? total : current.paid;
    const paid = Math.min(Math.max(0, round2(paidInput)), total);
    const date = patch.date ?? current.date;
    const paymentMethod = patch.paymentMethod ?? current.paymentMethod;

    // 3) إعادة كتابة حركة الصندوق المرتبطة
    const cashRows = await cashStore.index('by-ref').getAll(id);
    for (const row of cashRows) await cashStore.delete(row.id);
    if (paid > 0) {
      await cashStore.put({
        id: uid('csh'),
        date,
        type: 'in',
        amount: paid,
        account: paymentMethod === 'bank' ? 'bank' : 'cash',
        category: 'بيع يدوي',
        description: `${productName} × ${quantity} — ${current.number}`,
        refType: 'manual_sale',
        refId: id,
        createdAt: Date.now(),
      } satisfies CashTransaction);
    }

    const unitCost =
      patch.unitCost !== undefined
        ? patch.unitCost === null
          ? null
          : round2(patch.unitCost)
        : current.unitCost;

    const updated: ManualSale = {
      ...current,
      productId: nextProductId,
      productName,
      quantity,
      unitPrice,
      total,
      unitCost,
      buyerName: (patch.buyerName ?? current.buyerName).trim(),
      category: (patch.category ?? current.category).trim(),
      note: (patch.note ?? current.note).trim(),
      date,
      stockApplied,
      paid,
      paymentMethod,
      updatedAt: Date.now(),
    };
    await saleStore.put(updated);
    await tx.done;

    await logAudit({
      action: 'update',
      entity: 'manualSale',
      entityId: id,
      summary: `تعديل بيع يدوي ${current.number}`,
      before: describeManualSale(current),
      after: describeManualSale(updated),
    });

    return updated;
  } catch (err) {
    try {
      tx.abort();
    } catch {
      /* noop */
    }
    void tx.done.catch(() => {
      /* مُعالَج */
    });
    throw err;
  }
}

/** حذف سجل مع إرجاع المخزون وإزالة حركته في الصندوق — والسجل يبقى في سجل المراجعة */
export async function deleteManualSale(id: string): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(['manualSales', 'products', 'cash'], 'readwrite');
  try {
    const sale = await tx.objectStore('manualSales').get(id);
    if (!sale) {
      await tx.done;
      return;
    }
    if (sale.stockApplied && sale.productId) {
      const product = await tx.objectStore('products').get(sale.productId);
      if (product) {
        await tx.objectStore('products').put({
          ...product,
          quantity: round2(product.quantity + sale.quantity),
          updatedAt: Date.now(),
        });
      }
    }
    const cashRows = await tx.objectStore('cash').index('by-ref').getAll(id);
    for (const row of cashRows) await tx.objectStore('cash').delete(row.id);
    await tx.objectStore('manualSales').delete(id);
    await tx.done;

    await logAudit({
      action: 'sale_delete',
      entity: 'manualSale',
      entityId: id,
      summary: `حذف بيع يدوي ${sale.number}`,
      before: describeManualSale(sale),
      after: '',
    });
  } catch (err) {
    try {
      tx.abort();
    } catch {
      /* noop */
    }
    void tx.done.catch(() => {
      /* مُعالَج */
    });
    throw err;
  }
}

export async function getManualSale(id: string): Promise<ManualSale | undefined> {
  const db = await getDB();
  return db.get('manualSales', id);
}

export async function listManualSales(): Promise<ManualSale[]> {
  const db = await getDB();
  const rows = await db.getAll('manualSales');
  return rows.sort((a, b) => b.date - a.date);
}

/** مفتاح اليوم بالتوقيت المحلي — أساس الأرشفة (لا يعتمد على توقيت فتح الصفحة) */
export function dayKey(date: number): string {
  const d = new Date(date);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export interface DaySummary {
  key: string; // YYYY-MM-DD
  start: number;
  count: number;
  quantity: number;
  sales: number;
  products: number;
  manualCount: number;
  posCount: number;
}

export function summarizeDays(sales: ManualSale[]): DaySummary[] {
  const map = new Map<string, DaySummary>();
  for (const sale of sales) {
    const key = dayKey(sale.date);
    const row =
      map.get(key) ??
      {
        key,
        start: startOfDay(sale.date),
        count: 0,
        quantity: 0,
        sales: 0,
        products: 0,
        manualCount: 0,
        posCount: 0,
      };
    row.count += 1;
    row.quantity = round2(row.quantity + sale.quantity);
    row.sales = round2(row.sales + sale.total);
    row.products += 1;
    if (sale.source === 'manual') row.manualCount += 1;
    else row.posCount += 1;
    map.set(key, row);
  }
  return [...map.values()].sort((a, b) => b.start - a.start);
}

/** الفترات المتاحة في الأرشيف (سنة/شهر) */
export function archivePeriods(days: DaySummary[]): { year: number; month: number; days: DaySummary[] }[] {
  const map = new Map<string, { year: number; month: number; days: DaySummary[] }>();
  for (const day of days) {
    const d = new Date(day.start);
    const key = `${d.getFullYear()}-${d.getMonth() + 1}`;
    const row = map.get(key) ?? { year: d.getFullYear(), month: d.getMonth() + 1, days: [] };
    row.days.push(day);
    map.set(key, row);
  }
  return [...map.values()].sort((a, b) => b.year - a.year || b.month - a.month);
}
