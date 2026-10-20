/** خدمة الموردين وحساباتهم */
import type { Purchase, Supplier, SupplierPayment } from '../types';
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

/** مستحقات المورد = مجموع المتبقي في مشترياته المستلمة غير الملغاة */
export async function getSupplierBalance(supplierId: string): Promise<number> {
  const db = await getDB();
  const purchases = (await db.getAllFromIndex('purchases', 'by-supplier', supplierId)) as Purchase[];
  return sumMoney(
    purchases.filter((p) => p.status === 'received' && p.remaining > 0).map((p) => p.remaining),
  );
}

export interface SupplierRow extends Supplier {
  balance: number;
  purchaseCount: number;
}

export async function listSuppliersWithBalance(): Promise<SupplierRow[]> {
  const [suppliers, purchases] = await Promise.all([
    getAll<Supplier>('suppliers'),
    getAll<Purchase>('purchases'),
  ]);
  const received = purchases.filter((p) => p.status === 'received');
  return suppliers
    .map((s) => {
      const mine = received.filter((p) => p.supplierId === s.id);
      return {
        ...s,
        balance: sumMoney(mine.map((p) => p.remaining)),
        purchaseCount: mine.length,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function listSupplierPayments(supplierId?: string): Promise<SupplierPayment[]> {
  const items = await getAll<SupplierPayment>('supplierPayments');
  const filtered = supplierId ? items.filter((p) => p.supplierId === supplierId) : items;
  return filtered.sort((a, b) => b.date - a.date);
}
