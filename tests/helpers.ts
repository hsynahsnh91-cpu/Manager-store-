/** أدوات مشتركة للاختبارات: قاعدة بيانات نظيفة وعينات جاهزة */
import { getDB, resetDBConnection } from '../src/services/db';

export const ALL_STORES = [
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
  'manualSales',
  'categories',
  'priceHistory',
  'scannedInvoices',
  'invoiceImages',
  'audit',
] as const;

export async function freshDB(): Promise<void> {
  resetDBConnection();
  const db = await getDB();
  for (const store of ALL_STORES) {
    await db.clear(store);
  }
}

/** تاريخ محلي ثابت */
export function at(year: number, month: number, day: number, hour = 12, minute = 0): number {
  return new Date(year, month - 1, day, hour, minute, 0, 0).getTime();
}
