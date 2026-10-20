/**
 * البحث الذكي في دليل الأصناف.
 *
 * المبادئ:
 * - البحث لا ينشئ ولا يدمج منتجات؛ يعيد ترتيب الموجود فقط.
 * - اختلاف العلامة التجارية أو الوزن/الحجم أو عدد القطع يعني صنفًا مختلفًا،
 *   لذلك تُعرض نتائج متشابهة كـ«هل تقصد؟» ولا يُدمج أي منتج تلقائيًا.
 * - الباركود والرمز الداخلي لهما أولوية مطلقة.
 */
import type { Product, Settings } from '../types';
import { bigramSimilarity, extractSize, meaningfulTokens, normalizeArabic } from '../utils/text';
import { unitLabel } from '../utils/units';

export interface Synonym {
  from: string;
  to: string[];
}

/** مرادفات محلية شائعة في السوق السوري — قابلة للإضافة من الإعدادات */
export const BUILTIN_SYNONYMS: Synonym[] = [
  { from: 'رز', to: ['ارز', 'rice'] },
  { from: 'ارز', to: ['رز', 'rice'] },
  { from: 'جبنه', to: ['جبن', 'جبنه'] },
  { from: 'جبن', to: ['جبنه'] },
  { from: 'بندوره', to: ['طماطم', 'بندورة'] },
  { from: 'طماطم', to: ['بندوره', 'بندورة'] },
  { from: 'بطاطا', to: ['بطاطس'] },
  { from: 'بطاطس', to: ['بطاطا'] },
  { from: 'مته', to: ['متة'] },
  { from: 'متة', to: ['مته'] },
  { from: 'شاي', to: ['شاى'] },
  { from: 'سكر', to: ['سكّر'] },
  { from: 'طحين', to: ['دقيق', 'طاحون'] },
  { from: 'دقيق', to: ['طحين'] },
  { from: 'لبنه', to: ['لبنة'] },
  { from: 'ماء', to: ['مياه', 'water'] },
  { from: 'مياه', to: ['ماء', 'water'] },
  { from: 'نودلز', to: ['اندومي', 'شوربة'] },
  { from: 'اندومي', to: ['نودلز', 'شعيرية'] },
  { from: 'معكرونه', to: ['مكرونة', 'باستا', 'pasta'] },
  { from: 'مكرونة', to: ['معكرونة', 'باستا'] },
  { from: 'مسحوق', to: ['غسيل', 'منظف'] },
  { from: 'محارم', to: ['مناديل', 'فاين'] },
  { from: 'مناديل', to: ['محارم'] },
];

function synonymsFromSettings(settings?: Settings | null): Synonym[] {
  if (!settings?.searchSynonyms) return [];
  return settings.searchSynonyms.filter((s) => s.from?.trim() && Array.isArray(s.to));
}

/** يوسّع كلمات البحث بالمرادفات (المحلية أولًا ثم المدمجة) */
export function expandQueryTokens(query: string, settings?: Settings | null): string[] {
  const base = normalizeArabic(query)
    .split(' ')
    .filter(Boolean);
  const expanded = new Set(base);
  const all = [...synonymsFromSettings(settings), ...BUILTIN_SYNONYMS];
  for (const syn of all) {
    const from = normalizeArabic(syn.from);
    const tos = syn.to.map(normalizeArabic).filter(Boolean);
    // مطابقة الكلمة كاملة أو داخل العبارة
    if (base.includes(from) || normalizeArabic(query).includes(from)) {
      for (const t of tos) expanded.add(t);
    }
    if (tos.some((t) => base.includes(t))) expanded.add(from);
  }
  return [...expanded].filter(Boolean);
}

/** النص الكامل القابل للبحث لمنتج */
export function productSearchText(product: Product): string {
  return normalizeArabic(
    [
      product.name,
      product.shortName ?? '',
      product.brand ?? '',
      product.code,
      product.barcode,
      product.category,
      product.aliases?.join(' ') ?? '',
      product.unit ?? '',
      product.saleUnit ?? '',
      product.sizeValue != null ? String(product.sizeValue) : '',
      product.sizeUnit ?? '',
      product.batchNumber ?? '',
    ].join(' '),
  );
}

export interface SearchHit {
  product: Product;
  score: number;
  reason: 'barcode' | 'code' | 'name' | 'alias' | 'token' | 'brand' | 'size' | 'fuzzy';
}

export interface SearchOptions {
  settings?: Settings | null;
  includeArchived?: boolean;
  /** مسودات دليل الأصناف لا تظهر في البيع افتراضيًا */
  includeCatalogDrafts?: boolean;
  limit?: number;
}

/**
 * بحث مرتّب: الباركود، الرمز، الاسم/المرادف، الكلمات، العلامة، الحجم، ثم تشابه إملائي.
 */
export function searchProducts(products: Product[], query: string, opts: SearchOptions = {}): SearchHit[] {
  const raw = query.trim();
  if (!raw) return [];
  const normalized = normalizeArabic(raw);
  const tokens = expandQueryTokens(raw, opts.settings);
  const hits: SearchHit[] = [];

  for (const product of products) {
    if (!opts.includeArchived && product.archived) continue;
    if (!opts.includeCatalogDrafts && product.catalogDraft) continue;

    const barcode = normalizeArabic(product.barcode);
    const code = normalizeArabic(product.code);
    const name = normalizeArabic(product.name);
    const aliasText = normalizeArabic((product.aliases ?? []).join(' '));
    const brand = normalizeArabic(product.brand ?? '');
  const shortName = normalizeArabic(product.shortName ?? '');
    const size = extractSize(`${product.sizeValue ?? ''} ${product.sizeUnit ?? ''} ${product.name}`);
    const all = productSearchText(product);

    let score = 0;
    let reason: SearchHit['reason'] = 'token';

    if (barcode && barcode === normalized) {
      hits.push({ product, score: 1, reason: 'barcode' });
      continue;
    }
    if (code && code === normalized) {
      hits.push({ product, score: 0.98, reason: 'code' });
      continue;
    }
    if (shortName && shortName === normalized) {
      score = 0.96;
      reason = 'alias';
    } else if (name === normalized) {
      score = 0.97;
      reason = 'name';
    } else if (aliasText.split(' ').includes(normalized)) {
      score = 0.95;
      reason = 'alias';
    } else if (name.includes(normalized) && normalized.length >= 2) {
      score = 0.9;
      reason = 'name';
    } else if (aliasText.includes(normalized) && normalized.length >= 2) {
      score = 0.86;
      reason = 'alias';
    } else if (brand === normalized) {
      score = 0.8;
      reason = 'brand';
    } else {
      const nameTokens = new Set(meaningfulTokens(product.name));
      const aliasTokens = new Set([
        ...meaningfulTokens((product.aliases ?? []).join(' ')),
        ...meaningfulTokens(product.brand ?? ''),
        ...meaningfulTokens(product.shortName ?? ''),
      ]);
      let tokenHits = 0;
      for (const t of tokens) {
        if (t.length < 2) continue;
        if (nameTokens.has(t)) tokenHits += 1;
        else if (aliasTokens.has(t)) tokenHits += 0.8;
        else if (all.includes(t)) tokenHits += 0.6;
      }
      if (tokenHits > 0) {
        score = Math.min(0.84, 0.45 + tokenHits * 0.18);
        reason = 'token';
      } else if (size && normalized.includes(String(size.value))) {
        score = 0.4;
        reason = 'size';
      } else if (normalized.length >= 4 && bigramSimilarity(raw, product.name) >= 0.62) {
        score = 0.35 * bigramSimilarity(raw, product.name);
        reason = 'fuzzy';
      }
    }

    if (score > 0) hits.push({ product, score, reason });
  }

  hits.sort((a, b) => b.score - a.score || a.product.name.localeCompare(b.product.name, 'ar'));
  return typeof opts.limit === 'number' ? hits.slice(0, opts.limit) : hits;
}

/** يبحث عن المنتج المطابق تمامًا للباركود أو الرمز (لقارئ الباركود) */
export function findExactProduct(products: Product[], query: string): Product | null {
  const q = normalizeArabic(query);
  if (!q) return null;
  return (
    products.find((p) => !p.archived && normalizeArabic(p.barcode) === q) ??
    products.find((p) => !p.archived && normalizeArabic(p.code) === q) ??
    null
  );
}

export interface DuplicateCandidate {
  product: Product;
  score: number;
  /** هل نفس الحجم/الوزن؟ */
  sameSize: boolean;
  /** هل نفس العلامة التجارية؟ */
  sameBrand: boolean;
  /** تحذير: التشابه وحده لا يكفي للدمج */
  conflict: boolean;
}

export interface NewProductAttributes {
  name: string;
  brand?: string;
  sizeValue?: number | null;
  sizeUnit?: string;
  barcode?: string;
}

/**
 * اقتراح منتجات موجودة قبل إنشاء منتج جديد (منع التكرار).
 * لا يدمج شيئًا: يعرض الاحتمالات، وإذا اختلفت العلامة/الحجم فهي أصناف مختلفة.
 */
export function suggestDuplicates(
  products: Product[],
  candidate: NewProductAttributes,
  limit = 5,
): DuplicateCandidate[] {
  const name = normalizeArabic(candidate.name);
  if (!name) return [];
  const brand = normalizeArabic(candidate.brand ?? '');
  const candidateSize = candidate.sizeValue != null
    ? { value: candidate.sizeValue, unit: candidate.sizeUnit ?? '' }
    : extractSize(candidate.name);

  const rows: DuplicateCandidate[] = [];
  for (const product of products) {
    if (product.archived) continue;
    if (candidate.barcode && product.barcode && normalizeArabic(candidate.barcode) === normalizeArabic(product.barcode)) {
      rows.push({ product, score: 1, sameSize: true, sameBrand: true, conflict: false });
      continue;
    }
    const productName = normalizeArabic(product.name);
    const nameScore = Math.max(
      bigramSimilarity(name, productName),
      name.includes(productName) || productName.includes(name) ? 0.85 : 0,
      meaningfulTokens(product.name).length > 0 &&
        meaningfulTokens(product.name).every((t) => meaningfulTokens(candidate.name).includes(t))
        ? 0.8
        : 0,
    );
    if (nameScore < 0.55) continue;
    const productSize = product.sizeValue != null
      ? { value: product.sizeValue, unit: product.sizeUnit ?? '' }
      : extractSize(`${product.sizeUnit ?? ''} ${product.name}`);
    const sameSize =
      candidateSize && productSize
        ? candidateSize.value === productSize.value &&
          normalizeArabic(candidateSize.unit) === normalizeArabic(productSize.unit)
        : !candidateSize && !productSize;
    const productBrand = normalizeArabic(product.brand ?? '');
    const sameBrand = brand && productBrand ? brand === productBrand : !brand || !productBrand;
    rows.push({
      product,
      score: Math.min(0.95, nameScore),
      sameSize,
      sameBrand,
      conflict: !sameSize || !sameBrand,
    });
  }
  return rows.sort((a, b) => b.score - a.score).slice(0, limit);
}

/** وصف مختصر للمنتج في نتائج البحث */
export function describeProduct(product: Product, lang: 'ar' | 'en' = 'ar'): string {
  const parts: string[] = [];
  if (product.brand) parts.push(product.brand);
  if (product.sizeValue != null) parts.push(`${product.sizeValue} ${product.sizeUnit ? unitLabel(product.sizeUnit, lang) : ''}`.trim());
  if (product.saleUnit) parts.push(unitLabel(product.saleUnit, lang));
  return parts.filter(Boolean).join(' · ');
}
