/**
 * طبقة التخزين الدائم — IndexedDB عبر مكتبة idb.
 * قاعدة واحدة تحوي جميع جداول التطبيق مع فهارس للاستعلامات.
 */
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type {
  AuditEntry,
  CashTransaction,
  Customer,
  CustomerPayment,
  Expense,
  Invoice,
  InvoiceImage,
  ManualSale,
  PriceChange,
  Product,
  ProductCategory,
  Purchase,
  ScannedInvoice,
  Settings,
  StockWriteOff,
  Supplier,
  SupplierPayment,
  SupplierPrice,
} from '../types';

interface StoreDB extends DBSchema {
  products: { key: string; value: Product; indexes: { 'by-code': string; 'by-barcode': string; 'by-category': string } };
  customers: { key: string; value: Customer; indexes: { 'by-name': string } };
  suppliers: { key: string; value: Supplier; indexes: { 'by-name': string } };
  invoices: { key: string; value: Invoice; indexes: { 'by-date': number; 'by-customer': string; 'by-status': string; 'by-token': string } };
  purchases: { key: string; value: Purchase; indexes: { 'by-date': number; 'by-supplier': string; 'by-status': string; 'by-token': string } };
  expenses: { key: string; value: Expense; indexes: { 'by-date': number } };
  cash: { key: string; value: CashTransaction; indexes: { 'by-date': number; 'by-ref': string } };
  customerPayments: {
    key: string;
    value: CustomerPayment;
    indexes: { 'by-date': number; 'by-customer': string; 'by-token': string };
  };
  supplierPayments: {
    key: string;
    value: SupplierPayment;
    indexes: { 'by-date': number; 'by-supplier': string; 'by-token': string };
  };
  settings: { key: string; value: Settings };
  meta: { key: string; value: { key: string; value: unknown } };
  // ——— الإصدار 2: سجل المبيعات، التصنيفات، الأسعار، الفواتير الممسوحة ———
  manualSales: {
    key: string;
    value: ManualSale;
    indexes: { 'by-date': number; 'by-token': string; 'by-product': string; 'by-source': string };
  };
  categories: { key: string; value: ProductCategory; indexes: { 'by-normalized': string } };
  priceHistory: {
    key: string;
    value: PriceChange;
    indexes: { 'by-product': string; 'by-date': number };
  };
  scannedInvoices: {
    key: string;
    value: ScannedInvoice;
    indexes: { 'by-scan-date': number; 'by-invoice-date': number; 'by-fingerprint': string; 'by-supplier': string };
  };
  invoiceImages: { key: string; value: InvoiceImage };
  audit: { key: string; value: AuditEntry; indexes: { 'by-at': number } };
  // ——— الإصدار 3: الإتلاف وتاريخ أسعار الموردين ———
  stockWriteOffs: { key: string; value: StockWriteOff; indexes: { 'by-date': number; 'by-product': string } };
  supplierPrices: {
    key: string;
    value: SupplierPrice;
    indexes: { 'by-supplier': string; 'by-product': string; 'by-date': number };
  };
}

export const DB_NAME = 'masroofi-store-manager';
export const DB_VERSION = 3;

let dbPromise: Promise<IDBPDatabase<StoreDB>> | null = null;

export function getDB(): Promise<IDBPDatabase<StoreDB>> {
  if (!dbPromise) {
    dbPromise = openDB<StoreDB>(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion, _newVersion, tx) {
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

        // ————— الإصدار 2 — إضافة فقط، دون المساس بالبيانات الموجودة —————
        if (!db.objectStoreNames.contains('manualSales')) {
          const s = db.createObjectStore('manualSales', { keyPath: 'id' });
          s.createIndex('by-date', 'date');
          s.createIndex('by-token', 'clientToken', { unique: true });
          s.createIndex('by-product', 'productId');
          s.createIndex('by-source', 'source');
        }
        if (!db.objectStoreNames.contains('categories')) {
          const s = db.createObjectStore('categories', { keyPath: 'id' });
          s.createIndex('by-normalized', 'normalized', { unique: true });
        }
        if (!db.objectStoreNames.contains('priceHistory')) {
          const s = db.createObjectStore('priceHistory', { keyPath: 'id' });
          s.createIndex('by-product', 'productId');
          s.createIndex('by-date', 'date');
        }
        if (!db.objectStoreNames.contains('scannedInvoices')) {
          const s = db.createObjectStore('scannedInvoices', { keyPath: 'id' });
          s.createIndex('by-scan-date', 'scanDate');
          s.createIndex('by-invoice-date', 'invoiceDate');
          s.createIndex('by-fingerprint', 'fingerprint');
          s.createIndex('by-supplier', 'supplierName');
        }
        if (!db.objectStoreNames.contains('invoiceImages')) {
          db.createObjectStore('invoiceImages', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('audit')) {
          const s = db.createObjectStore('audit', { keyPath: 'id' });
          s.createIndex('by-at', 'at');
        }

        // ————— الإصدار 3 — إضافة فقط: الإتلاف وأسعار الموردين وفهارس منع التكرار —————
        if (!db.objectStoreNames.contains('stockWriteOffs')) {
          const s = db.createObjectStore('stockWriteOffs', { keyPath: 'id' });
          s.createIndex('by-date', 'date');
          s.createIndex('by-product', 'productId');
        }
        if (!db.objectStoreNames.contains('supplierPrices')) {
          const s = db.createObjectStore('supplierPrices', { keyPath: 'id' });
          s.createIndex('by-supplier', 'supplierId');
          s.createIndex('by-product', 'productId');
          s.createIndex('by-date', 'date');
        }
        // فهارس منع تكرار الدفعات — تُضاف للسجلات القديمة دون حذفها.
        // السجلات القديمة بلا clientToken لا تدخل الفهرس، فلا تعارض.
        if (oldVersion < 3) {
          for (const [storeName, indexName] of [
            ['customerPayments', 'by-token'],
            ['supplierPayments', 'by-token'],
          ] as const) {
            const store = tx.objectStore(storeName);
            if (!store.indexNames.contains(indexName)) {
              store.createIndex(indexName, 'clientToken');
            }
          }
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
