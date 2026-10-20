/** خدمة المنتجات والمخزون */
import type { Product } from '../types';
import { getAll, getDB, putItem } from './db';
import { uid } from '../utils/id';

export type ProductInput = Omit<Product, 'id' | 'createdAt' | 'updatedAt' | 'archived'> & {
  archived?: boolean;
};

export async function listProducts(): Promise<Product[]> {
  const items = await getAll<Product>('products');
  return items.sort((a, b) => b.createdAt - a.createdAt);
}

export async function getProduct(id: string): Promise<Product | undefined> {
  const db = await getDB();
  return db.get('products', id);
}

export async function findProductByBarcode(barcode: string): Promise<Product | undefined> {
  if (!barcode) return undefined;
  const db = await getDB();
  return db.getFromIndex('products', 'by-barcode', barcode);
}

export async function createProduct(input: ProductInput): Promise<Product> {
  const now = Date.now();
  const product: Product = {
    ...input,
    id: uid('prd'),
    archived: input.archived ?? false,
    createdAt: now,
    updatedAt: now,
  };
  await putItem('products', product);
  return product;
}

export async function updateProduct(id: string, patch: Partial<ProductInput>): Promise<Product> {
  const db = await getDB();
  const existing = await db.get('products', id);
  if (!existing) throw new Error('PRODUCT_NOT_FOUND');
  const updated: Product = { ...existing, ...patch, id: existing.id, updatedAt: Date.now() };
  await putItem('products', updated);
  return updated;
}

/** الأرشفة لا تحذف السجل — تُخفيه من قوائم البيع النشطة */
export async function archiveProduct(id: string, archived: boolean): Promise<void> {
  await updateProduct(id, { archived });
}

/** تعديل كمية مخزون يدويًا (جرد) مع سبب */
export async function adjustStock(id: string, newQuantity: number): Promise<Product> {
  if (!Number.isFinite(newQuantity) || newQuantity < 0) throw new Error('INVALID_QUANTITY');
  return updateProduct(id, { quantity: newQuantity });
}

export function isLowStock(p: Product): boolean {
  return !p.archived && p.quantity <= p.alertThreshold;
}
