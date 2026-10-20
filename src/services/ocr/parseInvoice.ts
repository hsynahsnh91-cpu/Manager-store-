/**
 * تحليل نص فاتورة مستخرج بـ OCR إلى بيانات منظمة.
 *
 * فلسفة التصميم: لا نفترض تنسيقًا ثابتًا ولا ترتيب أعمدة محددًا.
 * نعتمد على «اتساق الحساب»: الكمية × سعر الوحدة ≈ إجمالي البند.
 * لذلك يعمل المحلل مع:
 * - ترتيب أعمدة مختلف (الصنف يمينًا أو يسارًا).
 * - أرقام عربية هندية (٠١٢…) وفارسية وغربية.
 * - فاصلة عشرية عربية «٫».
 * - أخطاء OCR في الفاصلة العشرية (4.25 → 425) عبر استنتاج سعر الوحدة من الإجمالي.
 * - فواتير عربية وإنجليزية.
 *
 * كل حقل يحمل درجة ثقة، وأي شك يُعلَّم للمراجعة اليدوية بدل اعتماده تلقائيًا.
 */
import { extractSize, normalizeArabic, normalizeDigits, parseNumberLoose } from '../../utils/text';
import { round2 } from '../../utils/money';

export interface ParsedInvoiceItem {
  rawName: string;
  name: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  discount: number;
  tax: number;
  unit: string;
  confidence: number; // 0..1
  needsReview: boolean;
  sourceLine: string;
}

export type ParsedField = 'supplierName' | 'invoiceNumber' | 'invoiceDate' | 'total';

export interface ParsedInvoice {
  supplierName: string;
  invoiceNumber: string;
  invoiceDate: number | null;
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  items: ParsedInvoiceItem[];
  rawText: string;
  confidence: number; // 0..1 متوسط ثقة المحرك والحقول
  fieldConfidence: Record<ParsedField, number>;
  warnings: string[];
  unparsedLines: string[];
}

const HEADER_WORDS = [
  'الصنف', 'البيان', 'المنتج', 'الاصناف', 'الأصناف', 'اسم الصنف', 'الوصف',
  'الكمية', 'كمية', 'سعر الوحدة', 'سعر', 'السعر', 'الإجمالي', 'الاجمالي', 'المجموع', 'القيمة',
  'item', 'description', 'product', 'qty', 'quantity', 'unit price', 'price', 'total', 'amount',
];

const TOTAL_WORDS = [
  'الاجمالي', 'الإجمالي', 'اجمالي', 'إجمالي', 'المجموع الكلي', 'المجموع', 'صافي', 'المبلغ الاجمالي',
  'grand total', 'total', 'net total', 'amount due', 'المستحق',
];
const SUBTOTAL_WORDS = ['المجموع الفرعي', 'subtotal', 'sub total', 'المجموع قبل', 'قبل الخصم'];
const DISCOUNT_WORDS = ['خصم', 'الخصم', 'خصومات', 'discount', 'disc', 'تخفيض'];
const TAX_WORDS = ['ضريبة', 'الضريبة', 'ضريبه', 'ضريبة القيمة المضافة', 'vat', 'tax', 'gst'];
const SUPPLIER_WORDS = ['المورد', 'اسم المورد', 'supplier', 'vendor', 'seller', 'البائع', 'من'];
const STORE_WORDS = ['المتجر', 'اسم المتجر', 'المحل', 'الشركة', 'مؤسسة', 'store', 'company'];

const MONTHS: Record<string, number> = {
  يناير: 1, فبراير: 2, مارس: 3, ابريل: 4, أبريل: 4, مايو: 5, يونيو: 6, يوليو: 7,
  اغسطس: 8, أغسطس: 8, سبتمبر: 9, اكتوبر: 10, أكتوبر: 10, نوفمبر: 11, ديسمبر: 12,
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
  january: 1, february: 2, march: 3, april: 4, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

function containsAny(text: string, words: string[]): boolean {
  return words.some((w) => text.includes(w));
}

function cleanLine(line: string): string {
  return normalizeDigits(line)
    .replace(/[|¦]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function looksLikeHeader(line: string): boolean {
  const norm = normalizeArabic(line);
  const hits = HEADER_WORDS.filter((w) => norm.includes(normalizeArabic(w))).length;
  return hits >= 2;
}

function lastNumber(line: string): number | null {
  const matches = line.match(/\d[\d.,]*/g);
  if (!matches) return null;
  for (let i = matches.length - 1; i >= 0; i--) {
    const n = parseNumberLoose(matches[i]);
    if (n !== null) return n;
  }
  return null;
}

/** تاريخ من نص — يدعم صيغًا متعددة وأسماء أشهر عربية/إنجليزية، ويعيد منتصف اليوم محليًا */
export function parseDateFromText(text: string): number | null {
  const source = normalizeDigits(text);
  const make = (y: number, m: number, d: number): number | null => {
    if (!(y >= 1990 && y <= 2100) || !(m >= 1 && m <= 12) || !(d >= 1 && d <= 31)) return null;
    const dt = new Date(y, m - 1, d, 12, 0, 0, 0);
    if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) return null;
    return dt.getTime();
  };

  // yyyy-mm-dd
  const iso = /(\d{4})[\/.\-](\d{1,2})[\/.\-](\d{1,2})/.exec(source);
  if (iso) {
    const parsed = make(Number(iso[1]), Number(iso[2]), Number(iso[3]));
    if (parsed) return parsed;
  }
  // dd/mm/yyyy أو mm/dd/yyyy — نفضّل dd/mm عند الغموض
  const dmy = /(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})/.exec(source);
  if (dmy) {
    let y = Number(dmy[3]);
    if (y < 100) y += 2000;
    const a = Number(dmy[1]);
    const b = Number(dmy[2]);
    const preferDayFirst = a > 12 || b <= 12;
    const parsed = preferDayFirst ? make(y, b, a) : make(y, a, b);
    if (parsed) return parsed;
    const fallback = preferDayFirst ? make(y, a, b) : make(y, b, a);
    if (fallback) return fallback;
  }
  // 18 أكتوبر 2026 / October 18, 2026
  const normalized = normalizeArabic(source);
  for (const [name, month] of Object.entries(MONTHS)) {
    const key = normalizeArabic(name);
    const idx = normalized.indexOf(key);
    if (idx < 0) continue;
    const before = normalized.slice(Math.max(0, idx - 6), idx);
    const after = normalized.slice(idx + key.length, idx + key.length + 10);
    const beforeNum = /(\d{1,2})/.exec(before);
    const afterYear = /(\d{4})/.exec(after);
    if (beforeNum && afterYear) {
      const parsed = make(Number(afterYear[1]), month, Number(beforeNum[1]));
      if (parsed) return parsed;
    }
    const numsAfter = after.match(/(\d{1,2})\D{0,3}(\d{4})/);
    if (numsAfter) {
      const parsed = make(Number(numsAfter[2]), month, Number(numsAfter[1]));
      if (parsed) return parsed;
    }
    const yearBefore = /(\d{4})\D{0,3}$/.exec(before + normalized.slice(idx - 6, idx));
    if (yearBefore && beforeNum) {
      const parsed = make(Number(yearBefore[1]), month, Number(beforeNum[1]));
      if (parsed) return parsed;
    }
  }
  return null;
}

interface NumericToken {
  index: number; // ترتيب التوكن
  value: number;
  raw: string;
  start: number;
  end: number;
}

function numericTokens(line: string): NumericToken[] {
  const out: NumericToken[] = [];
  const re = /\d[\d.,]*/g;
  let m: RegExpExecArray | null;
  let index = 0;
  while ((m = re.exec(line)) !== null) {
    const value = parseNumberLoose(m[0]);
    if (value === null) continue;
    out.push({ index: index++, value, raw: m[0], start: m.index, end: m.index + m[0].length });
    if (m.index === re.lastIndex) re.lastIndex += 1;
  }
  return out;
}

interface LineCandidate {
  qty: NumericToken;
  total: NumericToken;
  unitPrice: number;
  extraIndices: number[];
  explicitUnit: boolean;
  score: number;
}

const DECIMALS_TOLERANCE = 0.005;

/** يبحث عن أفضل تفسير (كمية، سعر وحدة، إجمالي) لأرقام السطر */
function bestInterpretation(tokens: NumericToken[]): LineCandidate | null {
  if (tokens.length === 0) return null;
  let best: LineCandidate | null = null;

  for (const qty of tokens) {
    for (const total of tokens) {
      if (qty === total) continue;
      const q = qty.value;
      const t = total.value;
      if (!(q > 0) || !(q <= 100_000) || !(t > 0)) continue;
      const unit = t / q;
      if (!(unit > 0) || unit > 1_000_000) continue;

      // سعر الوحدة يجب أن يكون منطقيًا بدقة عملة (أو نستنتجه)
      const roundedUnit = round2(unit);
      const exactUnit = Math.abs(unit - roundedUnit) < DECIMALS_TOLERANCE;
      if (!exactUnit) continue;

      let score = 0;
      if (t >= q) score += 1;
      if (Number.isInteger(q)) score += 2;
      if (Math.abs(q - Math.round(q)) < 1e-9) score += 0.5;
      if (q > t) score -= 2;

      // هل يوجد توكن يساوي سعر الوحدة صريحًا؟
      const explicit = tokens.find((x) => x !== qty && x !== total && Math.abs(x.value - roundedUnit) < DECIMALS_TOLERANCE);
      const extra: number[] = [];
      if (explicit) {
        score += 3;
        extra.push(explicit.index);
      } else {
        // إصلاح فاصلة عشرية ضائعة: 425 بدل 4.25
        const dropped = tokens.find((x) => {
          if (x === qty || x === total) return false;
          const candidate = round2(x.value / 100);
          return candidate > 0 && Math.abs(candidate - roundedUnit) < DECIMALS_TOLERANCE;
        });
        if (dropped) {
          score += 5;
          extra.push(dropped.index);
        }
      }
      if (t >= Math.max(...tokens.map((x) => x.value))) score += 1.5;
      if (q <= Math.min(...tokens.map((x) => x.value))) score += 0.5;

      const candidate: LineCandidate = {
        qty,
        total,
        unitPrice: roundedUnit,
        extraIndices: extra,
        explicitUnit: Boolean(explicit),
        score,
      };
      if (!best || candidate.score > best.score) best = candidate;
    }
  }

  if (best && best.score < 2) return null;
  return best;
}

function removeTokens(line: string, tokens: NumericToken[]): string {
  let out = line;
  for (const token of [...tokens].sort((a, b) => b.start - a.start)) {
    out = out.slice(0, token.start) + ' ' + out.slice(token.end);
  }
  return out
    .replace(/[\s|:;،,.\-–]+$/g, '')
    .replace(/^[\s|:;،,.\-–]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function isMeaningfulName(name: string): boolean {
  const norm = normalizeArabic(name);
  if (norm.length < 2) return false;
  if (containsAny(norm, ['الاجمالي', 'الكمية', 'السعر', 'الصنف', 'خصم', 'ضريبة'])) return false;
  return /[\p{L}]/u.test(name);
}

export interface ParseOptions {
  /** ثقة المحرك الإجمالية 0..100 */
  engineConfidence?: number;
  /** ثقة كل سطر إن وُفرت من المحرك */
  lineConfidence?: (line: string) => number | undefined;
}

/**
 * يحلل نص الفاتورة. لا يعتمد على ترتيب أعمدة، ويعيد تحذيرات صريحة
 * عند التعارض الحسابي أو انخفاض الثقة.
 */
export function parseInvoiceText(rawText: string, options: ParseOptions = {}): ParsedInvoice {
  const lines = rawText
    .split(/\r?\n/)
    .map(cleanLine)
    .filter((l) => l.length > 0);

  const warnings: string[] = [];
  const unparsedLines: string[] = [];

  // ————— الحقول العامة —————
  let supplierName = '';
  let supplierConfidence = 0;
  let invoiceNumber = '';
  let invoiceNumberConfidence = 0;
  let invoiceDate: number | null = null;
  let dateConfidence = 0;

  for (const line of lines) {
    const norm = normalizeArabic(line);
    if (!supplierName) {
      const supplierKey = SUPPLIER_WORDS.find((w) => norm.includes(normalizeArabic(w)));
      if (supplierKey) {
        const idx = norm.indexOf(normalizeArabic(supplierKey));
        const after = line.slice(Math.max(0, idx + supplierKey.length)).replace(/^[\s:：\-–]+/, '').trim();
        if (after && /[\p{L}]/u.test(after)) {
          supplierName = after;
          supplierConfidence = 0.85;
        }
      }
    }
    if (!invoiceNumber) {
      const numMatch = /(?:رقم\s*(?:الفاتورة|الفاتوره)?|invoice\s*(?:no|number|#)?|inv[.\s-]*(?:no|#)?|bill\s*(?:no|#)?|فاتورة\s*رقم)\s*[:#\-]?\s*([A-Za-z0-9\u0660-\u0669\u06F0-\u06F9][A-Za-z0-9\-\/_.\u0660-\u0669\u06F0-\u06F9]{1,24})/iu.exec(line);
      if (numMatch) {
        invoiceNumber = normalizeDigits(numMatch[1]).replace(/[.,;:]$/, '').trim();
        invoiceNumberConfidence = 0.9;
      }
    }
  }

  // اسم المتجر في أعلى الصفحة كبديل لاسم المورد
  if (!supplierName) {
    for (const line of lines.slice(0, 4)) {
      const norm = normalizeArabic(line);
      if (looksLikeHeader(line)) continue;
      if (containsAny(norm, ['فاتورة', 'invoice', 'التاريخ', 'date', 'رقم'])) continue;
      if (/[\p{L}]/u.test(line) && line.split(' ').length <= 8) {
        supplierName = line.trim();
        supplierConfidence = 0.45;
        break;
      }
    }
  }
  if (!supplierName) warnings.push('لم يتم التعرف على اسم المورد — أدخله يدويًا');

  // التاريخ: نفضّل السطر الذي يحوي كلمة تاريخ
  const dateLine = lines.find((l) => /تاريخ|date/i.test(normalizeArabic(l)));
  if (dateLine) {
    const parsed = parseDateFromText(dateLine);
    if (parsed) {
      invoiceDate = parsed;
      dateConfidence = 0.9;
    }
  }
  if (invoiceDate === null) {
    for (const line of lines) {
      const parsed = parseDateFromText(line);
      if (parsed) {
        invoiceDate = parsed;
        dateConfidence = 0.55;
        break;
      }
    }
  }
  if (invoiceDate === null) warnings.push('لم يتم التعرف على تاريخ الفاتورة — أدخله يدويًا');

  // رقم فاتورة بلا كلمة مفتاحية: رمز يحتوي حروفًا وأرقامًا مثل INV-4582
  if (!invoiceNumber) {
    const token = lines
      .join(' ')
      .match(/\b(?:INV|PUR|BILL|FAT)[-\/]?\d{2,10}\b/i);
    if (token) {
      invoiceNumber = token[0].toUpperCase();
      invoiceNumberConfidence = 0.6;
    }
  }

  // ————— البنود —————
  const items: ParsedInvoiceItem[] = [];
  const seen = new Set<string>();
  let headerSeen = false;

  for (const line of lines) {
    const norm = normalizeArabic(line);
    if (looksLikeHeader(line)) {
      headerSeen = true;
      continue;
    }
    if (containsAny(norm, TOTAL_WORDS) || containsAny(norm, DISCOUNT_WORDS) || containsAny(norm, TAX_WORDS)) continue;
    if (containsAny(norm, SUPPLIER_WORDS) || containsAny(norm, STORE_WORDS)) continue;
    if (/(?:^|\s)(?:ال)?(?:رقم|تاريخ|date|invoice|فاتورة|هاتف|phone|عنوان|address)(?=\s|:|$)/i.test(norm)) continue;
    if (/(?:^|\s)(?:vat|tax)\s*(?:no|number|registration|reg)?(?=\s|:|$)/i.test(norm)) continue;

    const tokens = numericTokens(line);
    if (tokens.length === 0) continue;
    const candidate = bestInterpretation(tokens);
    if (!candidate) {
      unparsedLines.push(line);
      continue;
    }

    const removed = [candidate.qty, candidate.total];
    for (const extraIndex of candidate.extraIndices) {
      const token = tokens.find((t) => t.index === extraIndex);
      if (token) removed.push(token);
    }
    const name = removeTokens(line, removed);
    if (!isMeaningfulName(name)) {
      unparsedLines.push(line);
      continue;
    }

    // تجاهل التكرار الناتج عن قراءة رأس الجدول مرتين
    const key = normalizeArabic(`${name}|${candidate.qty.value}|${candidate.total.value}`);
    if (seen.has(key)) continue;
    seen.add(key);

    const arithmetic = round2(candidate.qty.value * candidate.unitPrice);
    const diff = Math.abs(arithmetic - candidate.total.value);
    const arithmeticOk = diff <= Math.max(0.02, candidate.qty.value * 0.01);

    const lineConf = options.lineConfidence?.(line);
    let confidence = 0.5;
    if (candidate.explicitUnit) confidence += 0.25;
    if (Number.isInteger(candidate.qty.value)) confidence += 0.1;
    if (arithmeticOk) confidence += 0.15;
    if (candidate.extraIndices.length > 0 && !candidate.explicitUnit) confidence -= 0.1;
    if (lineConf !== undefined && lineConf < 70) confidence -= 0.25;
    else if (lineConf !== undefined && lineConf >= 85) confidence += 0.05;
    confidence = Math.max(0.1, Math.min(0.99, confidence));

    const size = extractSize(name);
    items.push({
      rawName: name,
      name,
      quantity: candidate.qty.value,
      unitPrice: candidate.unitPrice,
      lineTotal: candidate.total.value,
      discount: 0,
      tax: 0,
      unit: size?.unit ?? '',
      confidence: round2(confidence),
      needsReview: confidence < 0.75 || !arithmeticOk,
      sourceLine: line,
    });
  }

  if (items.length === 0) warnings.push('لم يتم العثور على بنود — صحّح النص أو أضف الأسطر يدويًا');
  if (unparsedLines.length > 0) {
    warnings.push(`${unparsedLines.length} سطرًا لم يتم التعرف عليه — راجعه يدويًا`);
  }
  if (!headerSeen && items.length > 0) {
    warnings.push('لم يُعثر على صف عناوين الجدول — قد تكون الأعمدة مقروءة بشكل جزئي');
  }

  // ————— الإجماليات —————
  const findAmount = (words: string[], preferLast = false): number | null => {
    const matching = lines.filter((l) => containsAny(normalizeArabic(l), words));
    if (matching.length === 0) return null;
    const ordered = preferLast ? [...matching].reverse() : matching;
    for (const line of ordered) {
      const n = lastNumber(line);
      if (n !== null) return n;
    }
    return null;
  };

  const parsedSubtotal = findAmount(SUBTOTAL_WORDS);
  const parsedDiscount = findAmount(DISCOUNT_WORDS) ?? 0;
  const parsedTax = findAmount(TAX_WORDS) ?? 0;
  const explicitTotal = findAmount(TOTAL_WORDS, true);

  const itemsSum = round2(items.reduce((acc, i) => acc + i.lineTotal, 0));
  const computedTotal = round2((parsedSubtotal ?? itemsSum) - parsedDiscount + parsedTax);
  let total = explicitTotal ?? computedTotal;
  let totalConfidence = explicitTotal !== null ? 0.85 : 0.55;

  const subtotal = parsedSubtotal ?? itemsSum;

  if (explicitTotal !== null && items.length > 0) {
    const expected = round2(subtotal - parsedDiscount + parsedTax);
    if (Math.abs(explicitTotal - expected) > Math.max(0.5, expected * 0.02)) {
      warnings.push(
        `الإجمالي المقروء (${explicitTotal}) لا يطابق مجموع البنود (${expected}) — راجع الأسعار`,
      );
      totalConfidence = 0.4;
    }
  }
  if (items.length > 0 && total < itemsSum * 0.5) {
    warnings.push('الإجمالي أقل بكثير من مجموع البنود — تأكد من قراءة الفاصلة العشرية');
    totalConfidence = Math.min(totalConfidence, 0.35);
  }
  if (total === 0 && items.length > 0) {
    total = computedTotal;
    warnings.push('لم يُعثر على إجمالي — حُسب من البنود');
  }

  const engineConfidence = options.engineConfidence ?? 0;
  const itemConfidence =
    items.length > 0 ? items.reduce((a, i) => a + i.confidence, 0) / items.length : 0;
  const confidence = Math.max(
    0,
    Math.min(
      1,
      engineConfidence > 0
        ? (engineConfidence / 100) * 0.3 + itemConfidence * 0.5 + totalConfidence * 0.2
        : itemConfidence * 0.7 + totalConfidence * 0.3,
    ),
  );

  return {
    supplierName,
    invoiceNumber,
    invoiceDate,
    subtotal,
    discount: parsedDiscount,
    tax: parsedTax,
    total,
    items,
    rawText,
    confidence: round2(confidence),
    fieldConfidence: {
      supplierName: supplierConfidence,
      invoiceNumber: invoiceNumberConfidence,
      invoiceDate: dateConfidence,
      total: totalConfidence,
    },
    warnings,
    unparsedLines,
  };
}
