/** الإعدادات الافتراضية وخدمة قراءة/حفظ الإعدادات */
import type { Settings } from '../types';
import { getDB } from './db';

export const SETTINGS_KEY = 'app';

export const DEFAULT_SETTINGS: Settings = {
  storeName: 'متجري',
  storePhone: '',
  storeAddress: '',
  currency: 'ل.س',
  language: 'ar',
  theme: 'light',
  allowNegativeStock: false,
  invoicePrefix: 'INV',
  purchasePrefix: 'PUR',
  lowStockDefault: 5,
  expenseCategories: [
    'إيجار المحل',
    'كهرباء وطاقة',
    'نقل وتوصيل',
    'أكياس تغليف ومواد مستهلكة',
    'صيانة معدات',
    'رواتب',
    'مياه وإنترنت',
    'أخرى',
  ],
  updatedAt: 0,
  salePricePolicy: 'ask',
  defaultMarginPercent: 25,
  roundSalePriceTo: 0.25,
  manualSalePrefix: 'MS',
  storeType: 'grocery',
  debtLedgerTitle: 'دفتر الدين',
  searchSynonyms: [],
  expiryAlertDays: 30,
};

/** يضيف تصنيفات المصروفات الجديدة دون حذف تخصيصات المستخدم */
function migrateExpenseCategories(stored: string[] | undefined): string[] {
  const current = stored?.filter(Boolean) ?? [];
  if (current.length === 0) return [...DEFAULT_SETTINGS.expenseCategories];
  const missing = DEFAULT_SETTINGS.expenseCategories.filter((c) => !current.includes(c));
  return [...current, ...missing];
}

export async function getSettings(): Promise<Settings> {
  try {
    const db = await getDB();
    const rec = await db.get('settings', SETTINGS_KEY);
    if (rec) {
      const merged: Settings = { ...DEFAULT_SETTINGS, ...rec };
      return {
        ...merged,
        expenseCategories: migrateExpenseCategories(merged.expenseCategories),
      };
    }
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
