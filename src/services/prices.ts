/**
 * خدمة الأسعار — مصدر واحد لحساب الأسعار المقترحة وتسجيل تاريخ تغيّرها.
 * قواعد:
 * - سعر الشراء وسعر البيع منفصلان: تحديث التكلفة لا يغيّر سعر البيع إلا بسياسة صريحة.
 * - لا يُسجَّل تغيير إذا لم يتغيّر السعر فعليًا (منع ضجيج السجل).
 * - كل تغيير يحمل مصدره (يدوي / فاتورة مشتريات / فاتورة ممسوحة).
 */
import type { PriceChange, PriceField, PriceSourceType, Product, Settings } from '../types';
import { getAll, getDB } from './db';
import { uid } from '../utils/id';
import { round2 } from '../utils/money';
import { DEFAULT_SETTINGS } from './settings';

export const DEFAULT_MARGIN = 25;
export const DEFAULT_ROUND_TO = 0.25;

/** هامش الربح الفعلي من سعرين */
export function marginPercent(cost: number, sale: number): number | null {
  if (!(cost > 0)) return null;
  return round2(((sale - cost) / cost) * 100);
}

/**
 * سعر بيع مقترح اعتمادًا على التكلفة والهامش وسياسة التقريب.
 * يُعيد null إذا كانت التكلفة غير صالحة.
 */
export function suggestSalePrice(
  cost: number,
  opts?: { marginPercent?: number; roundTo?: number },
): number | null {
  if (!Number.isFinite(cost) || cost <= 0) return null;
  const margin = opts?.marginPercent && opts.marginPercent > 0 ? opts.marginPercent : DEFAULT_MARGIN;
  const raw = cost * (1 + margin / 100);
  const step = opts?.roundTo && opts.roundTo > 0 ? opts.roundTo : 0;
  if (step <= 0) return round2(raw);
  // تقريب لأقرب خطوة (0.25 مثلًا) مع ضمان عدم النزول تحت التكلفة
  const rounded = round2(Math.ceil(raw / step) * step);
  return Math.max(rounded, round2(cost));
}

export function pricingSettings(settings: Settings): { policy: 'never' | 'ask' | 'auto'; margin: number; roundTo: number } {
  return {
    policy: settings.salePricePolicy ?? 'ask',
    margin: settings.defaultMarginPercent ?? DEFAULT_SETTINGS.defaultMarginPercent ?? DEFAULT_MARGIN,
    roundTo: settings.roundSalePriceTo ?? DEFAULT_ROUND_TO,
  };
}

export interface ProposedPriceChange {
  productId: string;
  productName: string;
  field: PriceField;
  oldPrice: number;
  newPrice: number;
  changed: boolean;
  reason: 'increase' | 'decrease' | 'same' | 'invalid';
}

/** يقارن سعرًا جديدًا بالقديم ويصنّف التغيّر */
export function classifyPriceChange(
  product: Pick<Product, 'id' | 'name' | 'purchasePrice'>,
  newPrice: number,
): ProposedPriceChange {
  const oldPrice = product.purchasePrice;
  const next = round2(newPrice);
  if (!Number.isFinite(next) || next <= 0) {
    return { productId: product.id, productName: product.name, field: 'purchase', oldPrice, newPrice: oldPrice, changed: false, reason: 'invalid' };
  }
  if (next === oldPrice) {
    return { productId: product.id, productName: product.name, field: 'purchase', oldPrice, newPrice: oldPrice, changed: false, reason: 'same' };
  }
  return {
    productId: product.id,
    productName: product.name,
    field: 'purchase',
    oldPrice,
    newPrice: next,
    changed: true,
    reason: next > oldPrice ? 'increase' : 'decrease',
  };
}

/** تاريخ تغييرات الأسعار لمنتج (الأحدث أولًا) */
export async function getPriceHistory(productId: string): Promise<PriceChange[]> {
  const db = await getDB();
  const rows = await db.getAllFromIndex('priceHistory', 'by-product', productId);
  return rows.sort((a, b) => b.date - a.date);
}

/** كل سجلات الأسعار (للبحث العام) */
export async function listPriceHistory(): Promise<PriceChange[]> {
  return getAll<PriceChange>('priceHistory');
}

export interface RecordPriceInput {
  product: Product;
  field: PriceField;
  newPrice: number;
  source: PriceSourceType;
  sourceId?: string | null;
  sourceLabel?: string;
  date?: number;
  /** يمرَّر داخل معاملة قائمة لضمان الاتساق */
  db?: Awaited<ReturnType<typeof getDB>>;
}

/** يسجّل تغيّر سعر واحد — لا يُنشئ قيدًا إذا لم يتغيّر السعر */
export async function recordPriceChange(input: RecordPriceInput): Promise<PriceChange | null> {
  const current = input.field === 'purchase' ? input.product.purchasePrice : input.product.salePrice;
  const next = round2(input.newPrice);
  if (!(next > 0) || next === current) return null;
  const entry: PriceChange = {
    id: uid('prc'),
    productId: input.product.id,
    productName: input.product.name,
    field: input.field,
    oldPrice: current,
    newPrice: next,
    date: input.date ?? Date.now(),
    createdAt: Date.now(),
    source: input.source,
    sourceId: input.sourceId ?? null,
    sourceLabel: input.sourceLabel ?? '',
  };
  const db = input.db ?? (await getDB());
  await db.put('priceHistory', entry);
  return entry;
}

/**
 * تعديل سعر منتج يدويًا مع تسجيل التاريخ.
 * يستخدم معاملة ذرية: تحديث المنتج + قيد السعر معًا.
 */
export async function setProductPrice(
  productId: string,
  field: PriceField,
  newPrice: number,
  meta: { source?: PriceSourceType; sourceId?: string | null; sourceLabel?: string; date?: number } = {},
): Promise<{ changed: boolean; product: Product }> {
  const db = await getDB();
  const tx = db.transaction(['products', 'priceHistory'], 'readwrite');
  const product = await tx.objectStore('products').get(productId);
  if (!product) {
    await tx.done;
    throw new Error('PRODUCT_NOT_FOUND');
  }
  const next = round2(newPrice);
  if (!(next > 0)) {
    await tx.done;
    throw new Error('INVALID_PRICE');
  }
  const current = field === 'purchase' ? product.purchasePrice : product.salePrice;
  if (next === current) {
    await tx.done;
    return { changed: false, product };
  }
  const now = Date.now();
  const updated: Product = {
    ...product,
    [field === 'purchase' ? 'purchasePrice' : 'salePrice']: next,
    [field === 'purchase' ? 'purchasePriceUpdatedAt' : 'salePriceUpdatedAt']: now,
    updatedAt: now,
  };
  await tx.objectStore('products').put(updated);
  await tx.objectStore('priceHistory').put({
    id: uid('prc'),
    productId: product.id,
    productName: product.name,
    field,
    oldPrice: current,
    newPrice: next,
    date: meta.date ?? now,
    createdAt: now,
    source: meta.source ?? 'manual',
    sourceId: meta.sourceId ?? null,
    sourceLabel: meta.sourceLabel ?? '',
  } satisfies PriceChange);
  await tx.done;
  return { changed: true, product: updated };
}

/** ملخّص مقارنة قبل تطبيق تحديثات الأسعار */
export interface PriceUpdateSummary {
  increases: ProposedPriceChange[];
  decreases: ProposedPriceChange[];
  unchanged: ProposedPriceChange[];
  invalid: ProposedPriceChange[];
}

export function summarizePriceChanges(changes: ProposedPriceChange[]): PriceUpdateSummary {
  return {
    increases: changes.filter((c) => c.changed && c.reason === 'increase'),
    decreases: changes.filter((c) => c.changed && c.reason === 'decrease'),
    unchanged: changes.filter((c) => !c.changed && c.reason === 'same'),
    invalid: changes.filter((c) => c.reason === 'invalid'),
  };
}
