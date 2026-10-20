/**
 * النسخ الاحتياطي: تصدير كامل لقاعدة البيانات كملف JSON واستيراده.
 */
import { getDB } from './db';
import { DEFAULT_SETTINGS } from './settings';
import type {
  CashTransaction,
  Customer,
  CustomerPayment,
  Expense,
  Invoice,
  Product,
  Purchase,
  Settings,
  Supplier,
  SupplierPayment,
} from '../types';

export interface BackupFile {
  app: string;
  version: number;
  exportedAt: number;
  data: {
    products: Product[];
    customers: Customer[];
    suppliers: Supplier[];
    invoices: Invoice[];
    purchases: Purchase[];
    expenses: Expense[];
    cash: CashTransaction[];
    customerPayments: CustomerPayment[];
    supplierPayments: SupplierPayment[];
    settings: Settings;
    meta: { key: string; value: unknown }[];
  };
}

const STORES = [
  'products',
  'customers',
  'suppliers',
  'invoices',
  'purchases',
  'expenses',
  'cash',
  'customerPayments',
  'supplierPayments',
  'settings',
  'meta',
] as const;

export async function exportBackup(): Promise<BackupFile> {
  const db = await getDB();
  const [products, customers, suppliers, invoices, purchases, expenses, cash, customerPayments, supplierPayments, settings, meta] =
    await Promise.all([
      db.getAll('products'),
      db.getAll('customers'),
      db.getAll('suppliers'),
      db.getAll('invoices'),
      db.getAll('purchases'),
      db.getAll('expenses'),
      db.getAll('cash'),
      db.getAll('customerPayments'),
      db.getAll('supplierPayments'),
      db.get('settings', 'app'),
      db.getAll('meta'),
    ]);

  return {
    app: 'masroofi-store-manager',
    version: 1,
    exportedAt: Date.now(),
    data: {
      products,
      customers,
      suppliers,
      invoices,
      purchases,
      expenses,
      cash,
      customerPayments,
      supplierPayments,
      settings: { ...DEFAULT_SETTINGS, ...((settings ?? { key: 'app' }) as Partial<Settings>) },
      meta,
    },
  };
}

export function downloadBackup(backup: BackupFile): void {
  const json = JSON.stringify(backup, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const stamp = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = `store-backup-${stamp}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** استيراد: يمسح الجداول الحالية ويستبدلها بمحتوى النسخة (استبدال كامل) */
export async function importBackup(file: BackupFile, mode: 'replace' = 'replace'): Promise<void> {
  if (file.app !== 'masroofi-store-manager' || !file.data) {
    throw new Error('INVALID_BACKUP');
  }
  const db = await getDB();
  const tx = db.transaction(STORES, 'readwrite');
  try {
    if (mode === 'replace') {
      for (const store of STORES) {
        await tx.objectStore(store).clear();
      }
    }
    const d = file.data;
    for (const p of d.products ?? []) await tx.objectStore('products').put(p);
    for (const c of d.customers ?? []) await tx.objectStore('customers').put(c);
    for (const s of d.suppliers ?? []) await tx.objectStore('suppliers').put(s);
    for (const i of d.invoices ?? []) await tx.objectStore('invoices').put(i);
    for (const p of d.purchases ?? []) await tx.objectStore('purchases').put(p);
    for (const e of d.expenses ?? []) await tx.objectStore('expenses').put(e);
    for (const c of d.cash ?? []) await tx.objectStore('cash').put(c);
    for (const p of d.customerPayments ?? []) await tx.objectStore('customerPayments').put(p);
    for (const p of d.supplierPayments ?? []) await tx.objectStore('supplierPayments').put(p);
    for (const m of d.meta ?? []) await tx.objectStore('meta').put(m);
    if (d.settings) {
      const { key: _key, ...rest } = d.settings as Settings & { key?: string };
      await tx.objectStore('settings').put({ ...rest, key: 'app' } as never);
    }
    await tx.done;
  } catch (err) {
    try {
      tx.abort();
    } catch {
      /* noop */
    }
      void tx.done.catch(() => { /* مُعالَج: رفض مقصود بعد الإلغاء */ });
    throw err;
  }
}

export async function clearAllData(): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(STORES, 'readwrite');
  for (const store of STORES) {
    await tx.objectStore(store).clear();
  }
  await tx.done;
}
