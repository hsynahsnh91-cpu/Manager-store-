/**
 * أدوات العملة الآمنة.
 * التمثيل: أرقام عشرية بوحدتي عملة (مثلاً 12.50 = 12.50).
 * جميع العمليات تمر عبر تمثيل السنتات (أعداد صحيحة) لتفادي أخطاء الفاصلة العائمة،
 * مع سماحية صغيرة (≈ 1e-12) لجبران خطأ التمثيل الثنائي قبل التقريب.
 */

/** تقريب مبلغ إلى منزلتين عشريتين — قلب النظام المالي */
export function round2(amount: number): number {
  if (!Number.isFinite(amount)) return 0;
  const sign = amount < 0 ? -1 : 1;
  const x = Math.abs(amount) * 100;
  // سماحية تغطي خطأ التمثيل: تكفي خطأ الضرب والتمثيل ولا تغيّر القيم المكتوبة بدقّة العملة
  const slack = Math.max(x * 4 * Number.EPSILON, 1e-12);
  return (sign * Math.round(x + slack)) / 100;
}

/** تحويل مبلغ إلى سنتات (عدد صحيح) مع تقريب صحيح */
export function toCents(amount: number): number {
  if (!Number.isFinite(amount)) return 0;
  const sign = amount < 0 ? -1 : 1;
  const x = Math.abs(amount) * 100;
  const slack = Math.max(x * 4 * Number.EPSILON, 1e-12);
  return sign * Math.round(x + slack);
}

/** تحويل السنتات إلى مبلغ عشري */
export function fromCents(cents: number): number {
  return cents / 100;
}

/** جمع مبالغ: يجمع الخام ثم يقرّب مرة واحدة (أدقّ من تقريب كل حدّ) */
export function addMoney(...amounts: number[]): number {
  let sum = 0;
  for (const a of amounts) {
    if (Number.isFinite(a)) sum += a;
  }
  return round2(sum);
}

/** طرح مبالغ بأمان */
export function subMoney(a: number, b: number): number {
  return round2((Number.isFinite(a) ? a : 0) - (Number.isFinite(b) ? b : 0));
}

/** ضرب (كمية × سعر): الكمية × سعر الوحدة المقرَّب لسنتين */
export function mulMoney(quantity: number, price: number): number {
  if (!Number.isFinite(quantity) || !Number.isFinite(price)) return 0;
  return fromCents(Math.round(quantity * toCents(price)));
}

/** جمع قائمة مبالغ */
export function sumMoney(amounts: number[]): number {
  let sum = 0;
  for (const a of amounts) {
    if (Number.isFinite(a)) sum += a;
  }
  return round2(sum);
}

/** تنظيف قيمة مبلغ غير صالح */
export function clampMoney(amount: number): number {
  return round2(amount);
}

/** نسبة مئوية من مبلغ (للخصم) */
export function percentOf(amount: number, percent: number): number {
  if (!Number.isFinite(amount) || !Number.isFinite(percent)) return 0;
  return fromCents(Math.round(toCents(amount) * (percent / 100)));
}

/** تنسيق مبلغ للعرض */
export function formatMoney(amount: number, currency = ''): string {
  const value = round2(amount);
  const formatted = value.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return currency ? `${formatted} ${currency}` : formatted;
}
