/**
 * خدمة التصنيفات — تصنيفات افتراضية قابلة للتعديل والإضافة، مع منع التكرار
 * عبر مفتاح تطبيع (لا تُنشأ «مواد غذائية» و«المواد الغذائية» كتصنيفين).
 */
import type { ProductCategory } from '../types';
import { getDB } from './db';
import { uid } from '../utils/id';
import { categoryKey, meaningfulTokens, normalizeArabic } from '../utils/text';

export { categoryKey };

/** تصنيفات افتراضية لمتجر عام — تُزرع مرة واحدة فقط */
const DEFAULT_CATEGORIES: { name: string; keywords: string[] }[] = [
  {
    name: 'المواد الغذائية',
    keywords: ['ارز', 'رز', 'سكر', 'طحين', 'دقيق', 'زيت', 'شاي', 'قهوه', 'معكرونه', 'عدس', 'فاصوليا', 'مكرونه', 'بهار', 'ملح', 'عسل', 'جبن', 'حليب', 'لبن', 'بيض', 'معلبات', 'تونة', 'تونة', 'نسكافيه', 'شوكولاته', 'بسكويت'],
  },
  { name: 'المشروبات', keywords: ['مياه', 'ماء', 'عصير', 'كولا', 'بيبسي', 'مشروب', 'شراب', 'غازي', 'ريد بول', 'مشروبات', 'coffee', 'tea', 'juice', 'water', 'cola'] },
  { name: 'المنظفات', keywords: ['صابون', 'منظف', 'كلور', 'ديتول', 'مسحوق', 'غسيل', 'مناديل', 'معقم', 'شامبو', 'منظفات', 'فلاش', 'بريل', 'مبيض'] },
  { name: 'العناية الشخصية', keywords: ['معجون', 'فرشاه', 'كريم', 'عطر', 'مزيل', 'حفاضات', 'مناديل مبلله', 'شامبو', 'بلسم', 'عنايه'] },
  { name: 'الأدوات المنزلية', keywords: ['صحن', 'كوب', 'ملعقه', 'سكين', 'قدر', 'مقلاة', 'علبه', 'سله', 'مكنسه', 'خرطوم', 'لمبه', 'بطاريه', 'ادوات'] },
  { name: 'منتجات أخرى', keywords: [] },
];

export function categoryDefaults(): { name: string; keywords: string[] }[] {
  return DEFAULT_CATEGORIES;
}

/** يضمن وجود التصنيفات الافتراضية (مرة واحدة) ويعيد القائمة كاملة */
export async function ensureCategories(): Promise<ProductCategory[]> {
  const db = await getDB();
  const existing = await db.getAll('categories');
  if (existing.length === 0) {
    const tx = db.transaction('categories', 'readwrite');
    const now = Date.now();
    for (const def of DEFAULT_CATEGORIES) {
      await tx.store.put({
        id: uid('cat'),
        name: def.name,
        normalized: categoryKey(def.name),
        keywords: def.keywords,
        isDefault: true,
        createdAt: now,
        updatedAt: now,
      });
    }
    await tx.done;
    return db.getAll('categories');
  }
  return existing;
}

export async function listCategories(): Promise<ProductCategory[]> {
  const all = await ensureCategories();
  return all.sort((a, b) => a.name.localeCompare(b.name, 'ar'));
}

/** إنشاء تصنيف مع منع التكرار — يعيد الموجود إذا كان الاسم مطابقًا بعد التطبيع */
export async function createCategory(name: string, keywords: string[] = []): Promise<ProductCategory> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('CATEGORY_NAME_REQUIRED');
  await ensureCategories();
  const db = await getDB();
  const normalized = categoryKey(trimmed);
  const existing = await db.getFromIndex('categories', 'by-normalized', normalized);
  if (existing) return existing;
  const now = Date.now();
  const cat: ProductCategory = {
    id: uid('cat'),
    name: trimmed,
    normalized,
    keywords: keywords.map((k) => normalizeArabic(k)).filter(Boolean),
    isDefault: false,
    createdAt: now,
    updatedAt: now,
  };
  await db.put('categories', cat);
  return cat;
}

export async function updateCategory(id: string, patch: { name?: string; keywords?: string[] }): Promise<ProductCategory> {
  const db = await getDB();
  const cat = await db.get('categories', id);
  if (!cat) throw new Error('CATEGORY_NOT_FOUND');
  const name = patch.name?.trim() || cat.name;
  const normalized = categoryKey(name);
  if (normalized !== cat.normalized) {
    const clash = await db.getFromIndex('categories', 'by-normalized', normalized);
    if (clash && clash.id !== id) throw new Error('CATEGORY_DUPLICATE');
  }
  const next: ProductCategory = {
    ...cat,
    name,
    normalized,
    keywords: patch.keywords ? patch.keywords.map((k) => normalizeArabic(k)).filter(Boolean) : cat.keywords,
    updatedAt: Date.now(),
  };
  await db.put('categories', next);

  // إعادة تسمية: نحدّث اسم التصنيف في المنتجات المرتبطة (دون لمس أسعارها أو سجلاتها)
  if (name !== cat.name) {
    const tx = db.transaction('products', 'readwrite');
    const products = await tx.store.getAll();
    for (const p of products) {
      if (p.category === cat.name) await tx.store.put({ ...p, category: name, updatedAt: Date.now() });
    }
    await tx.done;
  }
  return next;
}

/** حذف تصنيف مع نقل منتجاته إلى تصنيف بديل (لا يُحذف أي منتج) */
export async function deleteCategory(id: string, moveToName = 'منتجات أخرى'): Promise<void> {
  const db = await getDB();
  const cat = await db.get('categories', id);
  if (!cat) return;
  const tx = db.transaction(['categories', 'products'], 'readwrite');
  const products = await tx.objectStore('products').getAll();
  for (const p of products) {
    if (p.category === cat.name) {
      await tx.objectStore('products').put({ ...p, category: moveToName, updatedAt: Date.now() });
    }
  }
  await tx.objectStore('categories').delete(id);
  await tx.done;
}

/** عدد المنتجات لكل تصنيف */
export function countProductsByCategory(products: { category: string }[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const p of products) {
    const key = p.category.trim() || 'منتجات أخرى';
    map.set(key, (map.get(key) ?? 0) + 1);
  }
  return map;
}

export interface CategorySuggestion {
  category: string | null;
  confidence: number; // 0..1
  reason: 'keyword' | 'category-name' | 'none';
}

/**
 * يقترح تصنيفًا اعتمادًا على اسم المنتج وكلمات التصنيفات.
 * لا يخترع تصنيفًا: عند غياب ثقة كافية يعيد null كي يطلب المستخدم تصنيفًا.
 */
export function suggestCategory(productName: string, categories: ProductCategory[]): CategorySuggestion {
  const name = normalizeArabic(productName);
  if (!name) return { category: null, confidence: 0, reason: 'none' };
  const tokens = new Set(meaningfulTokens(productName));

  let best: { name: string; score: number } | null = null;
  for (const cat of categories) {
    let hits = 0;
    for (const kw of cat.keywords) {
      const k = normalizeArabic(kw);
      if (!k) continue;
      if (name.includes(k)) hits += k.length > 3 ? 2 : 1;
      else if (tokens.has(k)) hits += 2;
    }
    // تطابق اسم التصنيف نفسه داخل اسم المنتج
    const catWords = meaningfulTokens(cat.name);
    const nameHit = catWords.length > 0 && catWords.every((w) => tokens.has(w));
    if (nameHit) hits += 2;
    if (hits > 0) {
      const score = Math.min(1, hits / 4);
      if (!best || score > best.score) best = { name: cat.name, score };
    }
  }
  if (!best) return { category: null, confidence: 0, reason: 'none' };
  return {
    category: best.name,
    confidence: best.score,
    reason: 'keyword',
  };
}
