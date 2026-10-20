/** خدمة الموردين وحساباتهم */
import type { PriceSourceType, Product, Purchase, Supplier, SupplierPayment, SupplierPrice } from '../types';
import { deleteItem, getAll, getDB, putItem } from './db';
import { uid } from '../utils/id';
import { sumMoney } from '../utils/money';

export type SupplierInput = Omit<Supplier, 'id' | 'createdAt' | 'updatedAt'>;

export async function listSuppliers(): Promise<Supplier[]> {
  const items = await getAll<Supplier>('suppliers');
  return items.sort((a, b) => a.name.localeCompare(b.name));
}

export async function createSupplier(input: SupplierInput): Promise<Supplier> {
  const now = Date.now();
  const supplier: Supplier = { ...input, id: uid('sup'), createdAt: now, updatedAt: now };
  await putItem('suppliers', supplier);
  return supplier;
}

export async function updateSupplier(id: string, patch: Partial<SupplierInput>): Promise<Supplier> {
  const db = await getDB();
  const existing = await db.get('suppliers', id);
  if (!existing) throw new Error('SUPPLIER_NOT_FOUND');
  const updated = { ...existing, ...patch, id, updatedAt: Date.now() };
  await putItem('suppliers', updated);
  return updated;
}

export async function deleteSupplier(id: string): Promise<void> {
  await deleteItem('suppliers', id);
}

/** مستحقات المورد = الرصيد السابق + متبقي مشترياته المستلمة غير الملغاة */
export async function getSupplierBalance(supplierId: string): Promise<number> {
  const db = await getDB();
  const [supplier, purchases] = await Promise.all([
    db.get('suppliers', supplierId),
    db.getAllFromIndex('purchases', 'by-supplier', supplierId) as Promise<Purchase[]>,
  ]);
  return sumMoney([
    supplier?.openingBalance ?? 0,
    ...purchases.filter((p) => p.status === 'received' && p.remaining > 0).map((p) => p.remaining),
  ]);
}

export interface SupplierRow extends Supplier {
  balance: number;
  purchaseCount: number;
  unpaidCount: number;
  lastPurchaseAt: number | null;
  lastPaymentAt: number | null;
}

export async function listSuppliersWithBalance(): Promise<SupplierRow[]> {
  const [suppliers, purchases, payments] = await Promise.all([
    getAll<Supplier>('suppliers'),
    getAll<Purchase>('purchases'),
    getAll<SupplierPayment>('supplierPayments'),
  ]);
  const received = purchases.filter((p) => p.status === 'received');
  return suppliers
    .map((s) => {
      const mine = received.filter((p) => p.supplierId === s.id);
      const myPayments = payments.filter((p) => p.supplierId === s.id);
      return {
        ...s,
        balance: sumMoney([s.openingBalance ?? 0, ...mine.map((p) => p.remaining)]),
        purchaseCount: mine.length,
        unpaidCount: mine.filter((p) => p.remaining > 0).length,
        lastPurchaseAt: mine.length > 0 ? Math.max(...mine.map((p) => p.date)) : null,
        lastPaymentAt: myPayments.length > 0 ? Math.max(...myPayments.map((p) => p.date)) : null,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function listSupplierPayments(supplierId?: string): Promise<SupplierPayment[]> {
  const items = await getAll<SupplierPayment>('supplierPayments');
  const filtered = supplierId ? items.filter((p) => p.supplierId === supplierId) : items;
  return filtered.sort((a, b) => b.date - a.date);
}


export interface SupplierPriceRow extends SupplierPrice {
  product?: Product;
}

/** آخر سعر شراء لكل منتج من هذا المورد (من سجل الأسعار، وإلا من الفواتير) */
export async function listSupplierLastPrices(supplierId: string): Promise<SupplierPriceRow[]> {
  const db = await getDB();
  const [prices, products, purchases] = await Promise.all([
    db.getAllFromIndex('supplierPrices', 'by-supplier', supplierId) as Promise<SupplierPrice[]>,
    getAll<Product>('products'),
    db.getAllFromIndex('purchases', 'by-supplier', supplierId) as Promise<Purchase[]>,
  ]);
  const byProduct = new Map<string, SupplierPrice>();
  for (const price of prices) {
    const existing = byProduct.get(price.productId);
    if (!existing || price.date > existing.date) byProduct.set(price.productId, price);
  }
  // استكمال من الفواتير القديمة (قبل إضافة جدول أسعار الموردين)
  for (const purchase of purchases) {
    if (purchase.status !== 'received') continue;
    for (const item of purchase.items) {
      const existing = byProduct.get(item.productId);
      if (!existing || purchase.date > existing.date) {
        byProduct.set(item.productId, {
          id: `derived_${purchase.id}_${item.productId}`,
          supplierId,
          supplierName: purchase.supplierName,
          productId: item.productId,
          productName: item.name,
          unitCost: item.unitCost,
          unit: '',
          date: purchase.date,
          source: 'purchase' as PriceSourceType,
          sourceId: purchase.id,
          createdAt: purchase.createdAt,
        });
      }
    }
  }
  return [...byProduct.values()]
    .map((row) => ({ ...row, product: products.find((p) => p.id === row.productId) }))
    .sort((a, b) => b.date - a.date);
}

/** كل أسعار الموردين المسجّلة لمنتج معيّن — الأحدث أولًا (لعرض المصدر والوحدة) */
export async function listProductSupplierPrices(productId: string): Promise<SupplierPriceRow[]> {
  const db = await getDB();
  const [prices, suppliers] = await Promise.all([
    db.getAllFromIndex('supplierPrices', 'by-product', productId) as Promise<SupplierPrice[]>,
    getAll<Supplier>('suppliers'),
  ]);
  return prices
    .sort((a, b) => b.date - a.date)
    .map((row) => ({
      ...row,
      supplierName: row.supplierName || suppliers.find((s) => s.id === row.supplierId)?.name || '',
    }));
}

export interface SupplierProfile {
  supplier: Supplier | null;
  purchases: Purchase[];
  payments: SupplierPayment[];
  prices: SupplierPriceRow[];
  unpaid: Purchase[];
  balance: number;
}

/** ملف المورد الكامل لصفحة الموردين */
export async function getSupplierProfile(supplierId: string): Promise<SupplierProfile> {
  const db = await getDB();
  const [supplier, purchasesAll, paymentsAll, prices] = await Promise.all([
    db.get('suppliers', supplierId),
    getAll<Purchase>('purchases'),
    getAll<SupplierPayment>('supplierPayments'),
    listSupplierLastPrices(supplierId),
  ]);
  const purchases = purchasesAll
    .filter((p) => p.supplierId === supplierId)
    .sort((a, b) => b.date - a.date);
  const payments = paymentsAll
    .filter((p) => p.supplierId === supplierId)
    .sort((a, b) => b.date - a.date);
  const unpaid = purchases.filter((p) => p.status === 'received' && p.remaining > 0);
  const balance = sumMoney([supplier?.openingBalance ?? 0, ...unpaid.map((p) => p.remaining)]);
  return { supplier: supplier ?? null, purchases, payments, prices, unpaid, balance };
}
