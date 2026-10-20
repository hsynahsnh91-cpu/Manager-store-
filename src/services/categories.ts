/**
 * خدمة التصنيفات — دليل أصناف بقالية سورية قابل للتعديل بالكامل.
 *
 * قواعد:
 * - تصنيفات افتراضية مناسبة لمتجر مواد غذائية واستهلاكية، لكنها ليست مقدّسة:
 *   يمكن إعادة تسميتها أو حذفها أو إضافة تصنيفات فرعية.
 * - لا تكرار بسبب فروق كتابة («مواد غذائية» = «المواد الغذائية»).
 * - الترحيل آمن: لا نحذف تصنيفًا تستخدمه منتجات، ولا نغيّر تصنيف منتج عند الترقية.
 */
import type { ProductCategory } from '../types';
import { getDB, getAll } from './db';
import { uid } from '../utils/id';
import { categoryKey, meaningfulTokens, normalizeArabic } from '../utils/text';

export { categoryKey };

interface CategorySeed {
  name: string;
  keywords: string[];
}

/** التصنيفات الافتراضية للبقالية/السوبرماركت السوري */
const DEFAULT_CATEGORIES: CategorySeed[] = [
  { name: 'الأرز والحبوب والبقوليات', keywords: ['ارز', 'رز', 'عدس', 'فول', 'حمص', 'برغل', 'فريكة', 'شعير', 'ذرة', 'حبوب', 'بقوليات', 'rice', 'lentil', 'beans', 'bulgur'] },
  { name: 'السكر والملح والطحين والنشويات', keywords: ['سكر', 'ملح', 'طحين', 'دقيق', 'سميد', 'نشاء', 'نشا', 'بورك', 'مسخن', 'sugar', 'salt', 'flour', 'starch'] },
  { name: 'الزيوت والسمن والمواد التموينية', keywords: ['زيت', 'سمن', 'زبدة', 'زيتون', 'مخلل', 'دبس', 'طحينة', 'حلاوة', 'خل', 'عسل', 'مربى', 'oil', 'ghee', 'tahini', 'olive'] },
  { name: 'المعكرونة والشعيرية والشوربات سريعة التحضير', keywords: ['معكرونة', 'مكرونة', 'شعيرية', 'نودلز', 'شوربة', 'اندومي', 'اندومي', 'شعرية', 'pasta', 'noodle', 'soup'] },
  { name: 'المعلبات ورب البندورة', keywords: ['معلب', 'معلبات', 'تونة', 'سردين', 'رب', 'بندورة', 'بندوره', 'معجون', 'فطر', 'ذرة معلبة', 'can', 'tomato paste', 'tuna'] },
  { name: 'الشاي والمتة والقهوة والنسكافيه', keywords: ['شاي', 'متة', 'مته', 'قهوة', 'قهوه', 'نسكافيه', 'نسكافية', 'اسبريسو', 'بن', 'tea', 'mate', 'coffee', 'nescafe'] },
  { name: 'المشروبات والعصائر والمياه', keywords: ['مياه', 'ماء', 'عصير', 'كولا', 'بيبسي', 'مشروب', 'غازي', 'شراب', 'طاقة', 'juice', 'water', 'cola', 'soda'] },
  { name: 'البسكويت والشوكولا والسكاكر والشيبس', keywords: ['بسكويت', 'شوكولا', 'شوكولاتة', 'سكاكر', 'حلويات', 'شيبس', 'شيبس', 'مقرمشات', 'كيك', 'بسكوت', 'chocolate', 'biscuit', 'chips', 'candy'] },
  { name: 'الألبان والأجبان واللبنة والبيض', keywords: ['حليب', 'لبن', 'لبنة', 'جبن', 'جبنة', 'أجبان', 'بيض', 'قشطة', 'شدة', 'زبادي', 'milk', 'cheese', 'yogurt', 'egg'] },
  { name: 'الخبز والمواد اليومية', keywords: ['خبز', 'خبزة', 'صمون', 'كعك', 'مناقيش', 'فطيرة', 'خميرة', 'bread', 'bakery', 'yeast'] },
  { name: 'المنظفات ومساحيق الغسيل وسائل الجلي', keywords: ['منظف', 'مسحوق', 'غسيل', 'جلي', 'كلور', 'فلاش', 'مبيض', 'ديتول', 'معقم', 'منظفات', 'detergent', 'bleach', 'cleaner'] },
  { name: 'الصابون والشامبو والعناية الشخصية', keywords: ['صابون', 'شامبو', 'بلسم', 'معجون', 'فرشاة', 'كريم', 'عطر', 'مزيل', 'حفاضات', 'عناية', 'soap', 'shampoo', 'toothpaste', 'diaper'] },
  { name: 'المحارم والمناديل والورقيات', keywords: ['محارم', 'مناديل', 'منديل', 'ورق', 'مناشف', 'فاين', 'tissue', 'napkin', 'paper'] },
  { name: 'الأدوات المنزلية والمواد الاستهلاكية', keywords: ['صحن', 'كوب', 'ملعقة', 'سكين', 'قدر', 'مقلاة', 'علبة', 'سلة', 'مكنسة', 'خرطوم', 'لمبة', 'بطارية', 'أدوات', 'tool', 'kitchen'] },
  { name: 'السجائر والمنتجات المقيدة', keywords: ['سجائر', 'دخان', 'تبغ', 'معسل', 'فيب', 'سجارة', 'cigarette', 'tobacco'] },
  { name: 'منتجات أخرى', keywords: [] },
];

/** أسماء التصنيفات القديمة (الإصدار 2) — تُعالج بأمان عند الترقية */
const LEGACY_DEFAULTS = new Set(
  ['المواد الغذائية', 'المشروبات', 'المنظفات', 'العناية الشخصية', 'الأدوات المنزلية', 'منتجات أخرى'].map(categoryKey),
);

export function categoryDefaults(): CategorySeed[] {
  return DEFAULT_CATEGORIES;
}

const SEED_VERSION = 3;

/**
 * يضمن وجود التصنيفات الافتراضية مرة واحدة لكل إصدار.
 * الترقية من الإصدار 2: تُضاف التصنيفات السورية الجديدة، ويُحذف تصنيف قديم
 * فقط إذا لم تكن أي منتجات تستخدمه (لا يضيع تصنيف منتج أبدًا).
 */
export async function ensureCategories(): Promise<ProductCategory[]> {
  const db = await getDB();
  const existing = (await db.getAll('categories')) as ProductCategory[];
  const seeded = await db.get('meta', 'categorySeedVersion');
  const seededVersion = (seeded?.value as number | undefined) ?? 0;
  if (seededVersion >= SEED_VERSION && existing.length > 0) return existing;

  const byKey = new Map(existing.map((c) => [c.normalized, c]));
  const products = await db.getAll('products');
  const usedNames = new Set(products.map((p) => (p.category || '').trim()).filter(Boolean));
  const now = Date.now();
  const tx = db.transaction(['categories', 'meta'], 'readwrite');

  for (let i = 0; i < DEFAULT_CATEGORIES.length; i++) {
    const def = DEFAULT_CATEGORIES[i];
    const key = categoryKey(def.name);
    if (byKey.has(key)) continue;
    const cat: ProductCategory = {
      id: uid('cat'),
      name: def.name,
      normalized: key,
      keywords: def.keywords.map(normalizeArabic).filter(Boolean),
      isDefault: true,
      createdAt: now,
      updatedAt: now,
      parentId: null,
      sortOrder: i,
    };
    await tx.objectStore('categories').put(cat);
    byKey.set(key, cat);
  }

  // حذف التصنيفات القديمة الفارغة فقط (لا منتجات تستخدمها) لتفادي ازدواج الأسماء
  if (seededVersion < SEED_VERSION) {
    for (const old of existing) {
      if (!old.isDefault) continue;
      if (!LEGACY_DEFAULTS.has(old.normalized)) continue;
      if (usedNames.has(old.name)) continue;
      // «منتجات أخرى» مشتركة بين القائمتين — لا تُحذف
      if (old.normalized === categoryKey('منتجات أخرى')) continue;
      await tx.objectStore('categories').delete(old.id);
    }
  }

  await tx.objectStore('meta').put({ key: 'categorySeedVersion', value: SEED_VERSION });
  await tx.done;
  return (await db.getAll('categories')) as ProductCategory[];
}

export async function listCategories(): Promise<ProductCategory[]> {
  const all = await ensureCategories();
  return all.sort((a, b) => {
    const pa = a.parentId ?? '';
    const pb = b.parentId ?? '';
    if (pa !== pb) return pa.localeCompare(pb);
    return (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.name.localeCompare(b.name, 'ar');
  });
}

/** التصنيفات الرئيسية والفرعية مجمّعة للعرض */
export function groupCategories(categories: ProductCategory[]): { parent: ProductCategory; children: ProductCategory[] }[] {
  const parents = categories.filter((c) => !c.parentId);
  return parents.map((parent) => ({
    parent,
    children: categories.filter((c) => c.parentId === parent.id),
  }));
}

/** إنشاء تصنيف مع منع التكرار — يعيد الموجود إذا كان الاسم مطابقًا بعد التطبيع */
export async function createCategory(
  name: string,
  keywords: string[] = [],
  parentId: IDOrNull = null,
): Promise<ProductCategory> {
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
    parentId: parentId || null,
    sortOrder: 1000,
  };
  await db.put('categories', cat);
  return cat;
}

type IDOrNull = string | null;

export async function updateCategory(
  id: string,
  patch: { name?: string; keywords?: string[]; parentId?: string | null },
): Promise<ProductCategory> {
  const db = await getDB();
  const cat = await db.get('categories', id);
  if (!cat) throw new Error('CATEGORY_NOT_FOUND');
  const name = patch.name?.trim() || cat.name;
  const normalized = categoryKey(name);
  if (normalized !== cat.normalized) {
    const clash = await db.getFromIndex('categories', 'by-normalized', normalized);
    if (clash && clash.id !== id) throw new Error('CATEGORY_DUPLICATE');
  }
  if (patch.parentId === id) throw new Error('CATEGORY_PARENT_INVALID');
  const next: ProductCategory = {
    ...cat,
    name,
    normalized,
    keywords: patch.keywords ? patch.keywords.map((k) => normalizeArabic(k)).filter(Boolean) : cat.keywords,
    parentId: patch.parentId !== undefined ? patch.parentId : cat.parentId ?? null,
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
  // التصنيفات الفرعية تُرفع إلى المستوى الأعلى بدل حذفها
  const allCats = await tx.objectStore('categories').getAll();
  for (const child of allCats) {
    if (child.parentId === id) {
      await tx.objectStore('categories').put({ ...child, parentId: null, updatedAt: Date.now() });
    }
  }
  await tx.objectStore('categories').delete(id);
  await tx.done;
}

/** نقل منتجات من تصنيف إلى آخر دون المساس بأسعارها أو سجل مبيعاتها */
export async function moveProducts(fromName: string, toName: string): Promise<number> {
  const db = await getDB();
  const tx = db.transaction('products', 'readwrite');
  const products = await tx.store.getAll();
  let moved = 0;
  for (const p of products) {
    if ((p.category || '') === fromName) {
      await tx.store.put({ ...p, category: toName, updatedAt: Date.now() });
      moved += 1;
    }
  }
  await tx.done;
  return moved;
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
      // كلمة في بداية اسم المنتج أقوى دلالة (صابون ديتول ← الصابون)
      if (name.startsWith(k)) hits += 1;
    }
    // تطابق اسم التصنيف نفسه داخل اسم المنتج
    const catWords = meaningfulTokens(cat.name);
    const nameHit = catWords.length > 0 && catWords.every((w) => tokens.has(w));
    if (nameHit) hits += 2;
    if (hits > 0) {
      const score = Math.min(1, hits / 4);
      if (
        !best ||
        score > best.score ||
        (score === best.score && cat.name.localeCompare(best.name, 'ar') < 0)
      ) {
        best = { name: cat.name, score };
      }
    }
  }
  if (!best) return { category: null, confidence: 0, reason: 'none' };
  return {
    category: best.name,
    confidence: best.score,
    reason: 'keyword',
  };
}

/** إحصاء سريع لاستخدام التصنيفات (للعرض في الإدارة) */
export async function categoryUsage(): Promise<Map<string, number>> {
  const products = await getAll<{ category: string }>('products');
  return countProductsByCategory(products);
}
