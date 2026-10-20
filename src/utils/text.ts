/**
 * أدوات معالجة النصوص العربية/الإنجليزية — تُستخدم في البحث، ومطابقة المنتجات، وتحليل فواتير OCR.
 * كل الدوال نقية (بدون آثار جانبية) وقابلة للاختبار.
 */

const ARABIC_INDIC = '٠١٢٣٤٥٦٧٨٩';
const EXTENDED_ARABIC_INDIC = '۰۱۲۳۴۵۶۷۸۹';

/** يحوّل الأرقام العربية/الفارسية إلى أرقام غربية ويوحّد الفواصل العشرية */
export function normalizeDigits(input: string): string {
  let out = '';
  for (const ch of input) {
    const ai = ARABIC_INDIC.indexOf(ch);
    if (ai >= 0) {
      out += String(ai);
      continue;
    }
    const ei = EXTENDED_ARABIC_INDIC.indexOf(ch);
    if (ei >= 0) {
      out += String(ei);
      continue;
    }
    // الفاصلة العشرية العربية والآلاف
    if (ch === '٫') out += '.';
    else if (ch === '٬' || ch === '٬') out += '';
    else out += ch;
  }
  return out;
}

/** إزالة التشكيل والتطويل */
function stripTashkeel(text: string): string {
  return text.replace(/[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED\u0640]/g, '');
}

/**
 * تطبيع النص العربي: توحيد الألف والياء والتاء المربوطة، إزالة التشكيل والترقيم،
 * وتوحيد المسافات. النتيجة صالحة للمطابقة والبحث (وليست للعرض).
 */
export function normalizeArabic(input: string): string {
  return stripTashkeel(normalizeDigits(input ?? ''))
    .replace(/[إأآٱا]/g, 'ا')
    .replace(/[ىي]/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/[^\p{L}\p{N}\s.%/-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** مفتاح تطبيع للتصنيفات — يمنع تكرار «مواد غذائية» و«المواد الغذائية» */
export function categoryKey(name: string): string {
  return normalizeArabic(name)
    .split(' ')
    .filter(Boolean)
    .map((word) =>
      word
        .replace(/^ال/, '')
        // إزالة لواحق الجمع/النسبة الشائعة لكل كلمة (الغذائية = غذائي)
        .replace(/(ات|ون|ين|يه|ه)$/u, ''),
    )
    .join(' ');
}

/** كلمات لا تفيد المطابقة */
const STOP_WORDS = new Set([
  'من', 'في', 'على', 'مع', 'ال', 'و', 'او', 'أو', 'الى', 'إلى', 'the', 'and', 'of', 'for', 'with',
  'كجم', 'جم', 'جرام', 'غم', 'كغ', 'كيلو', 'لتر', 'مل', 'علبه', 'علبة', 'عبوه', 'عبوة', 'كيس',
  'كرتون', 'كارتون', 'حبه', 'حبة', 'قطعه', 'قطعة', 'عدد', 'باكت', 'باكيت', 'كيس', 'oz', 'kg', 'g',
  'ml', 'l', 'ltr', 'pcs', 'pc', 'pack', 'x',
]);

export function tokenize(input: string): string[] {
  return normalizeArabic(input)
    .split(' ')
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
}

/** كلمات دالة (بدون أرقام وأحجام ووحدات) */
export function meaningfulTokens(input: string): string[] {
  return tokenize(input).filter((t) => t.length > 1 && !STOP_WORDS.has(t) && !/^\d+$/.test(t));
}

/** حجم/وحدة داخل نص — مثال «1.8 لتر»، «400 جم»، «165g» */
export function extractSize(input: string): { value: number; unit: string } | null {
  const text = normalizeArabic(input);
  const m = /(\d+(?:\.\d+)?)\s*(كجم|كغ|كيلو|جم|جرام|غم|g|kg|مل|ml|لتر|l|ltr|oz)\b/u.exec(text);
  if (!m) return null;
  const value = Number(m[1]);
  const unit = m[2].toLowerCase();
  const canonical =
    unit === 'كغ' || unit === 'كيلو' || unit === 'كجم' || unit === 'kg'
      ? 'kg'
      : unit === 'جم' || unit === 'جرام' || unit === 'غم' || unit === 'g'
        ? 'g'
        : unit === 'مل' || unit === 'ml'
          ? 'ml'
          : unit === 'لتر' || unit === 'l' || unit === 'ltr'
            ? 'l'
            : unit;
  return { value, unit: canonical };
}

/** تشابه ثنائيات الحروف (Dice) — مناسب للأخطاء الإملائية القريبة */
export function bigramSimilarity(a: string, b: string): number {
  const na = normalizeArabic(a).replace(/\s+/g, '');
  const nb = normalizeArabic(b).replace(/\s+/g, '');
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  if (na.length < 2 || nb.length < 2) return na === nb ? 1 : 0;
  const grams = new Map<string, number>();
  for (let i = 0; i < na.length - 1; i++) {
    const g = na.slice(i, i + 2);
    grams.set(g, (grams.get(g) ?? 0) + 1);
  }
  let hits = 0;
  for (let i = 0; i < nb.length - 1; i++) {
    const g = nb.slice(i, i + 2);
    const count = grams.get(g) ?? 0;
    if (count > 0) {
      hits += 1;
      grams.set(g, count - 1);
    }
  }
  return (2 * hits) / (na.length - 1 + (nb.length - 1));
}

/** تقاطع مجموعات الكلمات الدالة */
export function tokenSimilarity(a: string, b: string): number {
  const ta = new Set(meaningfulTokens(a));
  const tb = new Set(meaningfulTokens(b));
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter += 1;
  return inter / Math.min(ta.size, tb.size);
}

/** يحوّل «1,234.50» أو «1.234,50» إلى رقم */
export function parseNumberLoose(raw: string): number | null {
  if (!raw) return null;
  let s = normalizeDigits(raw)
    .replace(/[^\d.,-]/g, '')
    .trim();
  if (!s) return null;
  const hasComma = s.includes(',');
  const hasDot = s.includes('.');
  if (hasComma && hasDot) {
    // الأخير هو الفاصل العشري
    if (s.lastIndexOf(',') > s.lastIndexOf('.')) {
      s = s.replace(/\./g, '').replace(',', '.');
    } else {
      s = s.replace(/,/g, '');
    }
  } else if (hasComma) {
    const parts = s.split(',');
    // فاصلة كآلاف: 1,500 — أو عشرية: 12,5
    s = parts.length === 2 && parts[1].length === 3 ? parts.join('') : s.replace(',', '.');
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
