/**
 * مطابقة أصناف الفاتورة الممسوحة مع منتجات قاعدة البيانات.
 * لا تربط منتجًا عشوائيًا: تعيد قائمة مرشحين بدرجات ثقة، والقرار النهائي للمستخدم
 * عند انخفاض الثقة (الحالة 'new' أو 'unlinked').
 *
 * إشارات المطابقة: الاسم المطبَّع، تقاطع الكلمات، تشابه ثنائيات الحروف،
 * الحجم/الوحدة (1.8 لتر، 400 جم)، الباركود، والوحدة.
 */
import type { Product } from '../../types';
import { bigramSimilarity, extractSize, meaningfulTokens, normalizeArabic, tokenSimilarity } from '../../utils/text';

export interface ProductMatch {
  product: Product;
  score: number; // 0..1
  confidence: 'high' | 'medium' | 'low';
  reasons: string[];
}

export const MATCH_HIGH = 0.78;
export const MATCH_MEDIUM = 0.5;

function scorePair(name: string, barcode: string | undefined, product: Product): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  const a = normalizeArabic(name);
  const b = normalizeArabic(product.name);
  const productBarcode = (product.barcode || '').trim();
  const itemBarcode = (barcode || '').trim();

  if (itemBarcode && productBarcode && itemBarcode === productBarcode) {
    return { score: 1, reasons: ['الباركود مطابق'] };
  }
  if (a === b && a.length > 0) {
    return { score: 1, reasons: ['الاسم مطابق تمامًا'] };
  }

  let score = 0;
  if (a.includes(b) && b.length >= 3) {
    score += 0.55;
    reasons.push('الاسم يحتوي اسم المنتج');
  } else if (b.includes(a) && a.length >= 3) {
    score += 0.5;
    reasons.push('اسم المنتج يحتوي البحث');
  }

  const tokenScore = tokenSimilarity(name, product.name);
  if (tokenScore > 0) {
    score += tokenScore * 0.35;
    reasons.push(`تشابه الكلمات ${Math.round(tokenScore * 100)}%`);
  }

  const bigram = bigramSimilarity(name, product.name);
  if (bigram > 0.4) {
    score += bigram * 0.25;
    reasons.push(`تشابه الحروف ${Math.round(bigram * 100)}%`);
  }

  const sizeA = extractSize(name);
  const sizeB = extractSize(product.name);
  if (sizeA && sizeB) {
    if (sizeA.unit === sizeB.unit) {
      if (Math.abs(sizeA.value - sizeB.value) < 1e-9) {
        score += 0.15;
        reasons.push('الحجم/الوحدة متطابقان');
      } else {
        score -= 0.25;
        reasons.push(`اختلاف الحجم (${sizeA.value} مقابل ${sizeB.value})`);
      }
    } else {
      score -= 0.08;
    }
  }

  const tokensA = new Set(meaningfulTokens(name));
  const tokensB = new Set(meaningfulTokens(product.name));
  let shared = 0;
  for (const t of tokensA) if (tokensB.has(t)) shared += 1;
  if (shared === 0 && score > 0) score -= 0.12;

  return { score: Math.max(0, Math.min(1, score)), reasons };
}

/** يعيد أفضل المرشحين مرتبين بالدرجة */
export function rankProductMatches(name: string, products: Product[], barcode?: string): ProductMatch[] {
  return products
    .filter((p) => !p.archived)
    .map((product) => {
      const { score, reasons } = scorePair(name, barcode, product);
      return {
        product,
        score,
        reasons,
        confidence: (score >= MATCH_HIGH ? 'high' : score >= MATCH_MEDIUM ? 'medium' : 'low') as ProductMatch['confidence'],
      };
    })
    .filter((m) => m.score > 0.12)
    .sort((x, y) => y.score - x.score)
    .slice(0, 8);
}

export function bestMatch(name: string, products: Product[], barcode?: string): ProductMatch | null {
  const list = rankProductMatches(name, products, barcode);
  return list[0] ?? null;
}

/** كل منتج مرتبط يظهر مرة واحدة، مع أفضل درجة */
export function dedupeMatches(matches: ProductMatch[]): ProductMatch[] {
  const map = new Map<string, ProductMatch>();
  for (const m of matches) {
    const existing = map.get(m.product.id);
    if (!existing || m.score > existing.score) map.set(m.product.id, m);
  }
  return [...map.values()].sort((a, b) => b.score - a.score);
}

/** تنظيف اسم الصنف المستخرج من ضجيج OCR */
export function cleanProductName(raw: string): string {
  return raw
    .replace(/^[\s|:;،,.·•\-–—]+/, '')
    .replace(/[\s|:;،,.·•\-–—]+$/, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/\b([A-Za-z])\s+(?=[A-Za-z]{3,})/g, '$1') // «D I T O L» → «DITOL»
    .trim();
}
