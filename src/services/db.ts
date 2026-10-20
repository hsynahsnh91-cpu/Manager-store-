/**
 * طبقة التخزين الدائم — IndexedDB عبر مكتبة idb.
 * قاعدة واحدة تحوي جميع جداول التطبيق مع فهارس للاستعلامات.
 */
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
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

interface StoreDB extends DBSchema {
  products: { key: string; value: Product; indexes: { 'by-code': string; 'by-barcode': string; 'by-category': string } };
  customers: { key: string; value: Customer; indexes: { 'by-name': string } };
  suppliers: { key: string; value: Supplier; indexes: { 'by-name': string } };
  invoices: { key: string; value: Invoice; indexes: { 'by-date': number; 'by-customer': string; 'by-status': string; 'by-token': string } };
  purchases: { key: string; value: Purchase; indexes: { 'by-date': number; 'by-supplier': string; 'by-status': string; 'by-token': string } };
  expenses: { key: string; value: Expense; indexes: { 'by-date': number } };
  cash: { key: string; value: CashTransaction; indexes: { 'by-date': number; 'by-ref': string } };
  customerPayments: { key: string; value: CustomerPayment; indexes: { 'by-date': number; 'by-customer': string } };
  supplierPayments: { key: string; value: SupplierPayment; indexes: { 'by-date': number; 'by-supplier': string } };
  settings: { key: string; value: Settings };
  meta: { key: string; value: { key: string; value: unknown } };
}

export const DB_NAME = 'masroofi-store-manager';
export const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase<StoreDB>> | null = null;

export function getDB(): Promise<IDBPDatabase<StoreDB>> {
  if (!dbPromise) {
    dbPromise = openDB<StoreDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        // المنتجات
        if (!db.objectStoreNames.contains('products')) {
          const s = db.createObjectStore('products', { keyPath: 'id' });
          s.createIndex('by-code', 'code');
          s.createIndex('by-barcode', 'barcode');
          s.createIndex('by-category', 'category');
        }
        // العملاء
        if (!db.objectStoreNames.contains('customers')) {
          const s = db.createObjectStore('customers', { keyPath: 'id' });
          s.createIndex('by-name', 'name');
        }
        // الموردون
        if (!db.objectStoreNames.contains('suppliers')) {
          const s = db.createObjectStore('suppliers', { keyPath: 'id' });
          s.createIndex('by-name', 'name');
        }
        // فواتير المبيعات
        if (!db.objectStoreNames.contains('invoices')) {
          const s = db.createObjectStore('invoices', { keyPath: 'id' });
          s.createIndex('by-date', 'date');
          s.createIndex('by-customer', 'customerId');
          s.createIndex('by-status', 'status');
          s.createIndex('by-token', 'clientToken', { unique: true });
        }
        // المشتريات
        if (!db.objectStoreNames.contains('purchases')) {
          const s = db.createObjectStore('purchases', { keyPath: 'id' });
          s.createIndex('by-date', 'date');
          s.createIndex('by-supplier', 'supplierId');
          s.createIndex('by-status', 'status');
          s.createIndex('by-token', 'clientToken', { unique: true });
        }
        // المصروفات
        if (!db.objectStoreNames.contains('expenses')) {
          const s = db.createObjectStore('expenses', { keyPath: 'id' });
          s.createIndex('by-date', 'date');
        }
        // حركة الصندوق
        if (!db.objectStoreNames.contains('cash')) {
          const s = db.createObjectStore('cash', { keyPath: 'id' });
          s.createIndex('by-date', 'date');
          s.createIndex('by-ref', 'refId');
        }
        // مدفوعات العملاء
        if (!db.objectStoreNames.contains('customerPayments')) {
          const s = db.createObjectStore('customerPayments', { keyPath: 'id' });
          s.createIndex('by-date', 'date');
          s.createIndex('by-customer', 'customerId');
        }
        // مدفوعات الموردين
        if (!db.objectStoreNames.contains('supplierPayments')) {
          const s = db.createObjectStore('supplierPayments', { keyPath: 'id' });
          s.createIndex('by-date', 'date');
          s.createIndex('by-supplier', 'supplierId');
        }
        // الإعدادات (قيمة واحدة)
        if (!db.objectStoreNames.contains('settings')) {
          db.createObjectStore('settings', { keyPath: 'key' } as never);
        }
        // بيانات وصفية (عدادات الأرقام التسلسلية…)
        if (!db.objectStoreNames.contains('meta')) {
          db.createObjectStore('meta', { keyPath: 'key' });
        }
      },
    });
  }
  return dbPromise;
}

/** لإغلاق الاتصال (يُستخدم في الاختبارات) */
export function resetDBConnection(): void {
  dbPromise = null;
}

/** استعلام عام: إحضار كل سجلات متجر */
export async function getAll<T>(store: keyof StoreDB): Promise<T[]> {
  const db = await getDB();
  return (await db.getAll(store as never)) as T[];
}

/** استعلام عام: حفظ سجل */
export async function putItem<T>(store: keyof StoreDB, value: T): Promise<void> {
  const db = await getDB();
  await db.put(store as never, value as never);
}

/** استعلام عام: حذف سجل */
export async function deleteItem(store: keyof StoreDB, key: string): Promise<void> {
  const db = await getDB();
  await db.delete(store as never, key);
}

/** تنفيذ دالة ضمن معاملة واحدة على متجر أو أكثر (اتساق البيانات) */
export async function withTransaction<T>(
  stores: (keyof StoreDB)[],
  mode: 'readonly' | 'readwrite',
  fn: (db: IDBPDatabase<StoreDB>) => Promise<T>,
): Promise<T> {
  const db = await getDB();
  const tx = db.transaction(stores as never, mode);
  const result = await fn(db);
  await tx.done;
  return result;
}
