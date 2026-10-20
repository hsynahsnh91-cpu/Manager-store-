/** خدمة المنتجات والمخزون */
import type { Product } from '../types';
import { getAll, getDB, putItem } from './db';
import { uid } from '../utils/id';
import { round2, round4 } from '../utils/money';
import { DEFAULT_UNIT, normalizeUnit } from '../utils/units';

export type ProductInput = Omit<Product, 'id' | 'createdAt' | 'updatedAt' | 'archived'> & {
  archived?: boolean;
};

export async function listProducts(): Promise<Product[]> {
  const items = await getAll<Product>('products');
  return items.sort((a, b) => b.createdAt - a.createdAt);
}

export async function listActiveProducts(): Promise<Product[]> {
  return (await listProducts()).filter((p) => !p.archived);
}

export async function getProduct(id: string): Promise<Product | undefined> {
  const db = await getDB();
  return db.get('products', id);
}

export async function findProductByBarcode(barcode: string): Promise<Product | undefined> {
  const value = barcode.trim();
  if (!value) return undefined;
  const db = await getDB();
  return (await db.getFromIndex('products', 'by-barcode', value)) ?? undefined;
}

/** رمز داخلي تلقائي للمنتجات التي لا تحمل رمزًا (اختياري في البقالية) */
async function nextProductCode(): Promise<string> {
  const db = await getDB();
  const rec = await db.get('meta', 'productCounter');
  const next = ((rec?.value as number | undefined) ?? 0) + 1;
  await db.put('meta', { key: 'productCounter', value: next });
  return `P-${String(next).padStart(5, '0')}`;
}

/** تنظيف حقول الوحدات والأسماء البديلة قبل الحفظ */
function normalizeProductFields(product: Product): Product {
  const saleUnit = normalizeUnit(product.saleUnit ?? product.unit ?? DEFAULT_UNIT);
  const aliases = (product.aliases ?? [])
    .map((a) => a.trim())
    .filter((a, i, arr) => a.length > 0 && arr.indexOf(a) === i);
  return {
    ...product,
    saleUnit,
    purchaseUnit: product.purchaseUnit ? normalizeUnit(product.purchaseUnit) : saleUnit,
    aliases,
    brand: (product.brand ?? '').trim(),
    shortName: (product.shortName ?? '').trim(),
    purchasePrice: round4(product.purchasePrice ?? 0),
    salePrice: round2(product.salePrice ?? 0),
    quantity: round4(product.quantity ?? 0),
  };
}

export async function createProduct(input: ProductInput): Promise<Product> {
  const now = Date.now();
  const code = input.code?.trim() ? input.code.trim() : await nextProductCode();
  const product: Product = normalizeProductFields({
    ...input,
    code,
    id: uid('prd'),
    archived: input.archived ?? false,
    createdAt: now,
    updatedAt: now,
  });
  await putItem('products', product);
  return product;
}

export async function updateProduct(id: string, patch: Partial<ProductInput>): Promise<Product> {
  const db = await getDB();
  const existing = await db.get('products', id);
  if (!existing) throw new Error('PRODUCT_NOT_FOUND');
  const merged: Product = {
    ...existing,
    ...patch,
    id: existing.id,
    code: patch.code !== undefined && !patch.code.trim() ? existing.code : patch.code ?? existing.code,
    updatedAt: Date.now(),
  };
  const updated = normalizeProductFields(merged);
  await putItem('products', updated);
  return updated;
}

/** الأرشفة لا تحذف السجل — تُخفيه من قوائم البيع النشطة */
export async function archiveProduct(id: string, archived: boolean): Promise<void> {
  await updateProduct(id, { archived });
}

/** تعديل كمية مخزون يدويًا (جرد) مع سبب — يقبل الكسور لوحدات الوزن */
export async function adjustStock(id: string, newQuantity: number): Promise<Product> {
  if (!Number.isFinite(newQuantity) || newQuantity < 0) throw new Error('INVALID_QUANTITY');
  return updateProduct(id, { quantity: round4(newQuantity) });
}

export function isLowStock(p: Product): boolean {
  return !p.archived && !p.catalogDraft && p.quantity <= p.alertThreshold;
}

/** هل هذا المنتج مسودة دليل بلا مخزون حقيقي؟ */
export function isCatalogDraft(p: Product): boolean {
  return Boolean(p.catalogDraft);
}

/** معلومات الوحدة للعرض: «كيلوغرام» أو «حبة» */
export function productUnit(p: Product): string {
  return normalizeUnit(p.saleUnit ?? p.unit ?? DEFAULT_UNIT);
}
