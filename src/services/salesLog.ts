/**
 * سجل المبيعات الموحّد — يدمج فواتير نقطة البيع مع السجلات اليدوية في عرض واحد.
 * البحث يشمل كل السجلات المحفوظة (لا يقتصر على المعروض)، ويجري على البيانات الكاملة
 * بعد تطبيع النص العربي، ويدعم نطاق الأسعار والتواريخ والتصنيف والمصدر ورقم الفاتورة.
 */
import type { Invoice, ManualSale, SaleSourceType } from '../types';
import { getDB } from './db';
import { dayKey } from './manualSales';
import { normalizeArabic, normalizeDigits, parseNumberLoose } from '../utils/text';
import { round2 } from '../utils/money';
import { startOfDay } from '../utils/dates';

export interface SalesLogItem {
  name: string;
  quantity: number;
  unitPrice: number;
  unitCost: number | null;
  total: number;
}

export interface SalesLogEntry {
  id: string;
  kind: 'invoice' | 'manual';
  number: string;
  date: number;
  dayKey: string;
  items: SalesLogItem[];
  productSummary: string;
  buyerName: string;
  quantity: number;
  total: number;
  cogs: number;
  profit: number;
  source: SaleSourceType;
  category: string; // تصنيف (أو تصنيفات) المنتجات في السجل
  note: string;
  status: 'active' | 'cancelled';
  searchText: string;
}

function invoiceSource(inv: Invoice): SaleSourceType {
  const src = (inv as Invoice & { source?: SaleSourceType }).source;
  return src === 'manual' || src === 'scanned' ? src : 'pos';
}

export function invoiceToEntry(inv: Invoice, categoryByProduct?: Map<string, string>): SalesLogEntry {
  const items: SalesLogItem[] = inv.items.map((i) => ({
    name: i.name,
    quantity: i.quantity,
    unitPrice: i.unitPrice,
    unitCost: i.unitCost,
    total: i.lineTotal,
  }));
  const categories = [
    ...new Set(
      inv.items
        .map((i) => categoryByProduct?.get(i.productId) || '')
        .filter((c) => c.trim().length > 0),
    ),
  ];
  return {
    id: inv.id,
    kind: 'invoice',
    number: inv.number,
    date: inv.date,
    dayKey: dayKey(inv.date),
    items,
    productSummary: items.map((i) => i.name).join('، '),
    buyerName: inv.customerName || '',
    quantity: round2(items.reduce((a, i) => a + i.quantity, 0)),
    total: inv.status === 'cancelled' ? inv.total : inv.total,
    cogs: inv.cogs,
    profit: inv.status === 'cancelled' ? 0 : round2(inv.total - inv.cogs),
    source: invoiceSource(inv),
    category: categories.join('، '),
    note: inv.notes,
    status: inv.status === 'cancelled' ? 'cancelled' : 'active',
    searchText: normalizeArabic(
      [inv.number, inv.customerName, inv.notes, ...items.map((i) => i.name)].join(' '),
    ),
  };
}

export function manualSaleToEntry(sale: ManualSale, categoryByProduct?: Map<string, string>): SalesLogEntry {
  const resolvedCategory = sale.category || (sale.productId ? categoryByProduct?.get(sale.productId) ?? '' : '');
  return {
    id: sale.id,
    kind: 'manual',
    number: sale.number,
    date: sale.date,
    dayKey: dayKey(sale.date),
    items: [
      {
        name: sale.productName,
        quantity: sale.quantity,
        unitPrice: sale.unitPrice,
        unitCost: sale.unitCost,
        total: sale.total,
      },
    ],
    productSummary: sale.productName,
    buyerName: sale.buyerName,
    quantity: sale.quantity,
    total: sale.total,
    cogs: sale.unitCost !== null ? round2(sale.unitCost * sale.quantity) : 0,
    profit: sale.unitCost !== null ? round2(sale.total - sale.unitCost * sale.quantity) : sale.total,
    source: sale.source,
    category: resolvedCategory,
    note: sale.note,
    status: 'active',
    searchText: normalizeArabic(
      [sale.number, sale.productName, sale.buyerName, resolvedCategory, sale.note].join(' '),
    ),
  };
}

/** يحمّل السجل كاملًا من قاعدة البيانات (فواتير + سجلات يدوية) */
export async function loadSalesLog(): Promise<SalesLogEntry[]> {
  const db = await getDB();
  const [invoices, manual, products] = await Promise.all([
    db.getAll('invoices'),
    db.getAll('manualSales'),
    db.getAll('products'),
  ]);
  const categoryByProduct = new Map(products.map((p) => [p.id, p.category]));
  return [
    ...invoices.map((inv) => invoiceToEntry(inv, categoryByProduct)),
    ...manual.map((sale) => manualSaleToEntry(sale, categoryByProduct)),
  ].sort((a, b) => b.date - a.date);
}

export type SourceFilter = 'all' | 'manual' | 'pos' | 'scanned';

export interface SalesLogFilters {
  q?: string;
  from?: number | null;
  to?: number | null;
  minPrice?: number | null;
  maxPrice?: number | null;
  category?: string;
  source?: SourceFilter;
  sort?: 'newest' | 'oldest';
}

/** هل يطابق الرقم المكتوب في البحث سعرًا أو كمية في السجل؟ */
function matchesPriceQuery(entry: SalesLogEntry, query: string): boolean {
  const numeric = parseNumberLoose(query);
  if (numeric === null) return false;
  return entry.items.some(
    (i) =>
      Math.abs(i.unitPrice - numeric) < 0.005 ||
      Math.abs(i.total - numeric) < 0.005 ||
      Math.abs(i.quantity - numeric) < 0.005,
  );
}

/**
 * يطبّق الفلاتر على كل السجلات. البحث النصي يطابق اسم المنتج/المشتري/الملاحظة/رقم الفاتورة،
 * وإن كان النص رقمًا يطابق أيضًا السعر أو الإجمالي أو الكمية.
 */
export function filterSalesLog(entries: SalesLogEntry[], filters: SalesLogFilters): SalesLogEntry[] {
  const q = (filters.q ?? '').trim();
  const qNorm = normalizeArabic(q);
  const qDigits = normalizeDigits(q);
  const from = filters.from ?? null;
  const to = filters.to ?? null;
  const min = filters.minPrice ?? null;
  const max = filters.maxPrice ?? null;
  const categoryKeyWanted = filters.category ? normalizeArabic(filters.category) : '';
  const source = filters.source ?? 'all';

  const filtered = entries.filter((e) => {
    if (from !== null && e.date < startOfDay(from)) return false;
    if (to !== null && e.date > startOfDay(to) + 86_399_999) return false;
    if (min !== null && e.total < min) return false;
    if (max !== null && e.total > max) return false;
    if (source !== 'all' && e.source !== source) return false;
    if (categoryKeyWanted) {
      const cats = e.category.split('،').map((c) => normalizeArabic(c.trim()));
      if (!cats.some((c) => c === categoryKeyWanted)) return false;
    }
    if (qNorm) {
      const byText =
        e.searchText.includes(qNorm) ||
        e.items.some((i) => normalizeArabic(i.name).includes(qNorm));
      const byNumber = e.number.toLowerCase().includes(qDigits.toLowerCase());
      const byPrice = matchesPriceQuery(e, q);
      if (!byText && !byNumber && !byPrice) return false;
    }
    return true;
  });

  return filtered.sort((a, b) => (filters.sort === 'oldest' ? a.date - b.date : b.date - a.date));
}

export interface SalesDayGroup {
  key: string;
  start: number;
  entries: SalesLogEntry[];
  sales: number;
  count: number;
  quantity: number;
  products: number;
  manualCount: number;
  posCount: number;
  cancelledCount: number;
}

export function groupByDay(entries: SalesLogEntry[]): SalesDayGroup[] {
  const map = new Map<string, SalesDayGroup>();
  for (const e of entries) {
    const row =
      map.get(e.dayKey) ??
      {
        key: e.dayKey,
        start: startOfDay(e.date),
        entries: [],
        sales: 0,
        count: 0,
        quantity: 0,
        products: 0,
        manualCount: 0,
        posCount: 0,
        cancelledCount: 0,
      };
    row.entries.push(e);
    row.count += 1;
    if (e.status === 'cancelled') {
      row.cancelledCount += 1;
    } else {
      row.sales = round2(row.sales + e.total);
      row.quantity = round2(row.quantity + e.quantity);
      row.products += e.items.length;
    }
    if (e.source === 'manual') row.manualCount += 1;
    else row.posCount += 1;
    map.set(e.dayKey, row);
  }
  return [...map.values()]
    .map((g) => ({ ...g, entries: g.entries.sort((a, b) => b.date - a.date) }))
    .sort((a, b) => b.start - a.start);
}

/** شجرة الأرشيف: سنة ← شهر ← أيام */
export interface ArchiveTree {
  year: number;
  months: { month: number; days: SalesDayGroup[]; sales: number; count: number }[];
  sales: number;
  count: number;
}

export function buildArchiveTree(days: SalesDayGroup[]): ArchiveTree[] {
  const years = new Map<number, ArchiveTree>();
  for (const day of days) {
    const d = new Date(day.start);
    const year = d.getFullYear();
    const month = d.getMonth() + 1;
    const y = years.get(year) ?? { year, months: [], sales: 0, count: 0 };
    let m = y.months.find((x) => x.month === month);
    if (!m) {
      m = { month, days: [], sales: 0, count: 0 };
      y.months.push(m);
    }
    m.days.push(day);
    m.sales = round2(m.sales + day.sales);
    m.count += day.count;
    y.sales = round2(y.sales + day.sales);
    y.count += day.count;
    years.set(year, y);
  }
  const list = [...years.values()].sort((a, b) => b.year - a.year);
  for (const y of list) {
    y.months.sort((a, b) => b.month - a.month);
    for (const m of y.months) m.days.sort((a, b) => b.start - a.start);
  }
  return list;
}

/** مجموع مبيعات فترة — يستخدم في بطاقات السجل */
export function sumEntries(entries: SalesLogEntry[]): { sales: number; count: number; quantity: number; products: number } {
  const active = entries.filter((e) => e.status !== 'cancelled');
  return {
    sales: round2(active.reduce((a, e) => a + e.total, 0)),
    count: active.length,
    quantity: round2(active.reduce((a, e) => a + e.quantity, 0)),
    products: active.reduce((a, e) => a + e.items.length, 0),
  };
}
