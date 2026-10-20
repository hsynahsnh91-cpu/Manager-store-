/** الإعدادات الافتراضية وخدمة قراءة/حفظ الإعدادات */
import type { Settings } from '../types';
import { getDB } from './db';

export const SETTINGS_KEY = 'app';

export const DEFAULT_SETTINGS: Settings = {
  storeName: 'متجري',
  storePhone: '',
  storeAddress: '',
  currency: 'ر.س',
  language: 'ar',
  theme: 'light',
  allowNegativeStock: false,
  invoicePrefix: 'INV',
  purchasePrefix: 'PUR',
  lowStockDefault: 5,
  expenseCategories: ['إيجار', 'رواتب', 'كهرباء ومياه', 'نقل وشحن', 'صيانة', 'تغليف', 'أخرى'],
  updatedAt: 0,
};

export async function getSettings(): Promise<Settings> {
  try {
    const db = await getDB();
    const rec = await db.get('settings', SETTINGS_KEY);
    if (rec) return { ...DEFAULT_SETTINGS, ...rec };
  } catch {
    // في حال فشل فتح القاعدة نرجع الافتراضي
  }
  return { ...DEFAULT_SETTINGS };
}

export async function saveSettings(settings: Settings): Promise<Settings> {
  const db = await getDB();
  const next: Settings = { ...settings, updatedAt: Date.now() };
  await db.put('settings', { ...next, key: SETTINGS_KEY } as never);
  return next;
}
