/** تنبيهات الصلاحية: منتهية، قريبة الانتهاء، وسليمة */
import type { Product } from '../types';
import { getAll } from './db';
import { startOfDay } from '../utils/dates';

export type ExpiryStatus = 'none' | 'ok' | 'expiring' | 'expired';

export interface ExpiryInfo {
  status: ExpiryStatus;
  daysLeft: number | null;
}

export function expiryInfo(product: Pick<Product, 'expiryDate' | 'perishable'>, now = Date.now()): ExpiryInfo {
  if (!product.expiryDate) return { status: product.perishable ? 'none' : 'none', daysLeft: null };
  const today = startOfDay(now);
  const expiry = startOfDay(product.expiryDate);
  const daysLeft = Math.round((expiry - today) / 86_400_000);
  if (daysLeft < 0) return { status: 'expired', daysLeft };
  return { status: 'expiring', daysLeft };
}

export interface ExpiryRow {
  product: Product;
  status: Exclude<ExpiryStatus, 'none'>;
  daysLeft: number;
}

/** المنتجات المنتهية أو القريبة من الانتهاء (داخل مهلة التنبيه) */
export function buildExpiryAlerts(products: Product[], alertDays = 30, now = Date.now()): ExpiryRow[] {
  const rows: ExpiryRow[] = [];
  for (const product of products) {
    if (product.archived || product.quantity <= 0 || !product.expiryDate) continue;
    const info = expiryInfo(product, now);
    if (info.status === 'expired' || (info.status === 'expiring' && (info.daysLeft ?? 0) <= alertDays)) {
      rows.push({ product, status: info.status, daysLeft: info.daysLeft ?? 0 });
    }
  }
  return rows.sort((a, b) => a.daysLeft - b.daysLeft);
}

export async function listExpiryAlerts(alertDays = 30): Promise<ExpiryRow[]> {
  const products = await getAll<Product>('products');
  return buildExpiryAlerts(products, alertDays);
}
