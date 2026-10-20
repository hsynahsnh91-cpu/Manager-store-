/**
 * وحدات البيع والشراء السورية.
 *
 * القاعدة الحاسمة: المخزون والأسعار (salePrice/purchasePrice/quantity) تُحفظ دائمًا
 * بوحدة البيع الأساسية للمنتج. عند الشراء بالكرتونة أو بالكيلو نحوّل الكمية والسعر
 * إلى الوحدة الأساسية قبل أي تحديث للمخزون أو التكلفة.
 *
 * لا نخترع معامل تحويل: إن لم يكن التحويل معروفًا (وزن↔عدد، كرتونة بلا عدد قطع)
 * تُرجع الدالة null ويُطلب من المستخدم تحديده.
 */

export type UnitKind = 'count' | 'weight' | 'volume';

export interface UnitDef {
  code: string;
  ar: string;
  en: string;
  kind: UnitKind;
  /** يُستخدم داخل واجهة الشراء كوحدة قد تحتوي عدة وحدات بيع */
  container?: boolean;
}

export const UNITS: UnitDef[] = [
  { code: 'piece', ar: 'حبة / قطعة', en: 'Piece', kind: 'count' },
  { code: 'packet', ar: 'ظرف / كيس', en: 'Packet', kind: 'count' },
  { code: 'box', ar: 'عبوة / علبة', en: 'Box', kind: 'count', container: true },
  { code: 'bundle', ar: 'ربطة', en: 'Bundle', kind: 'count', container: true },
  { code: 'dozen', ar: 'دستة', en: 'Dozen', kind: 'count', container: true },
  { code: 'carton', ar: 'صندوق / كرتونة', en: 'Carton', kind: 'count', container: true },
  { code: 'kg', ar: 'كيلوغرام', en: 'Kilogram', kind: 'weight' },
  { code: 'g', ar: 'غرام', en: 'Gram', kind: 'weight' },
  { code: 'l', ar: 'ليتر', en: 'Litre', kind: 'volume' },
  { code: 'ml', ar: 'مليلتر', en: 'Millilitre', kind: 'volume' },
  { code: 'other', ar: 'وحدة أخرى', en: 'Other unit', kind: 'count' },
];

const BY_CODE = new Map(UNITS.map((u) => [u.code, u]));

/** الوحدة الافتراضية للسجلات القديمة التي لا تحمل وحدة */
export const DEFAULT_UNIT = 'piece';

const LEGACY_ALIASES: Record<string, string> = {
  'حبة': 'piece',
  'قطعة': 'piece',
  'ظرف': 'packet',
  'كيس': 'packet',
  'علبة': 'box',
  'عبوة': 'box',
  'ربطة': 'bundle',
  'دستة': 'dozen',
  'كرتونة': 'carton',
  'صندوق': 'carton',
  'كيلو': 'kg',
  'كغم': 'kg',
  'كغ': 'kg',
  'غرام': 'g',
  'جرام': 'g',
  'ليتر': 'l',
  'لتر': 'l',
  'مل': 'ml',
  'مليلتر': 'ml',
  piece: 'piece',
  packet: 'packet',
  box: 'box',
  bundle: 'bundle',
  dozen: 'dozen',
  carton: 'carton',
  kg: 'kg',
  g: 'g',
  l: 'l',
  ml: 'ml',
};

export function normalizeUnit(unit: string | null | undefined): string {
  if (!unit) return DEFAULT_UNIT;
  const raw = unit.trim();
  return LEGACY_ALIASES[raw] ?? (BY_CODE.has(raw) ? raw : raw);
}

export function unitDef(unit: string | null | undefined): UnitDef {
  return BY_CODE.get(normalizeUnit(unit)) ?? { code: normalizeUnit(unit), ar: normalizeUnit(unit), en: normalizeUnit(unit), kind: 'count' };
}

export function unitLabel(unit: string | null | undefined, lang: 'ar' | 'en' = 'ar'): string {
  const def = BY_CODE.get(normalizeUnit(unit));
  if (!def) return normalizeUnit(unit);
  return lang === 'ar' ? def.ar : def.en;
}

export function unitKind(unit: string | null | undefined): UnitKind {
  return BY_CODE.get(normalizeUnit(unit))?.kind ?? 'count';
}

export function isWeightUnit(unit: string | null | undefined): boolean {
  return unitKind(unit) !== 'count';
}

/** خطوة زيادة الكمية في نقطة البيع — 0.25 كغ أو 1 حبة */
export function quantityStep(unit: string | null | undefined): number {
  return isWeightUnit(unit) ? 0.25 : 1;
}

/**
 * معامل التحويل من وحدة الشراء إلى وحدة البيع.
 * يعيد null عندما يكون التحويل غير معروف ويجب على المستخدم تحديده.
 */
export function conversionFactor(
  purchaseUnit: string | null | undefined,
  saleUnit: string | null | undefined,
  unitsPerPurchase?: number | null,
): number | null {
  const from = normalizeUnit(purchaseUnit);
  const to = normalizeUnit(saleUnit);
  if (from === to) return 1;

  const fromDef = BY_CODE.get(from);
  const toDef = BY_CODE.get(to);
  if (!fromDef || !toDef) return null;

  // الوزن والحجم: تحويل رياضي مؤكد
  if (fromDef.kind === 'weight' && toDef.kind === 'weight') {
    return from === 'kg' ? 1000 : 0.001;
  }
  if (fromDef.kind === 'volume' && toDef.kind === 'volume') {
    return from === 'l' ? 1000 : 0.001;
  }
  if (fromDef.kind !== toDef.kind) return null; // وزن ← عدد: يحتاج وزناً للوحدة

  // العدد: الدستة تعريفًا 12
  if (from === 'dozen' && (to === 'piece' || to === 'packet' || to === 'box')) return 12;
  if (to === 'dozen' && (from === 'piece' || from === 'packet' || from === 'box')) return 1 / 12;

  // الكرتونة/العبوة/الربطة: العدد يحدده المستخدم لكل منتج
  if (unitsPerPurchase && Number.isFinite(unitsPerPurchase) && unitsPerPurchase > 0) {
    if (fromDef.container) return unitsPerPurchase;
    if (toDef.container) return 1 / unitsPerPurchase;
  }
  return null;
}

export interface PurchaseConversion {
  /** الكمية بوحدة البيع الأساسية */
  baseQuantity: number;
  /** معامل التحويل أو null عند تعذّره */
  factor: number | null;
  /** رسالة خطأ بسيطة لصاحب المحل */
  error: 'UNIT_CONVERSION_REQUIRED' | 'INVALID_QUANTITY' | null;
}

/** تحويل كمية الشراء إلى كمية المخزون (وحدة البيع) — لا يخمّن أبدًا */
export function toBaseQuantity(
  quantity: number,
  purchaseUnit: string | null | undefined,
  saleUnit: string | null | undefined,
  unitsPerPurchase?: number | null,
): PurchaseConversion {
  if (!Number.isFinite(quantity) || quantity <= 0) {
    return { baseQuantity: 0, factor: null, error: 'INVALID_QUANTITY' };
  }
  const factor = conversionFactor(purchaseUnit, saleUnit, unitsPerPurchase);
  if (factor === null) {
    return { baseQuantity: 0, factor: null, error: 'UNIT_CONVERSION_REQUIRED' };
  }
  return { baseQuantity: Math.round(quantity * factor * 10000) / 10000, factor, error: null };
}

/** وصف مختصر للتحويل: «كرتونة = 24 حبة» */
export function describeConversion(
  purchaseUnit: string | null | undefined,
  saleUnit: string | null | undefined,
  unitsPerPurchase?: number | null,
  lang: 'ar' | 'en' = 'ar',
): string {
  const factor = conversionFactor(purchaseUnit, saleUnit, unitsPerPurchase);
  if (factor === null) return lang === 'ar' ? 'التحويل غير محدد' : 'Conversion not set';
  const from = unitLabel(purchaseUnit, lang);
  const to = unitLabel(saleUnit, lang);
  const n = Math.round(factor * 10000) / 10000;
  return `${from} = ${n} ${to}`;
}

/** هل يحتاج المنتج إلى تحديد عدد الوحدات في وحدة الشراء؟ */
export function needsUnitsPerPurchase(purchaseUnit: string | null | undefined, saleUnit: string | null | undefined): boolean {
  return conversionFactor(purchaseUnit, saleUnit, null) === null;
}
