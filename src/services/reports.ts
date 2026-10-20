/**
 * خدمة التقارير — كل الأرقام مشتقّة من السجلات الفعلية (فواتير، مشتريات، مصروفات، صندوق).
 * قواعد:
 * - الفواتير الملغاة مستثناة من المبيعات والأرباح (سجلّها يبقى).
 * - صافي المبيعات = الإجمالي − الخصومات (المرتجعات ملغاة أصلًا).
 * - الربح الإجمالي = صافي المبيعات − COGS المحفوظة لحظة البيع.
 * - صافي الربح = الربح الإجمالي − المصروفات التشغيلية.
 * - تحصيل الديون والتحويلات الداخلية خارج الدخل والمصروفات.
 */
import type {
  CashTransaction,
  CustomerPayment,
  Expense,
  Invoice,
  ManualSale,
  Purchase,
  Product,
  SupplierPayment,
} from '../types';
import { getAll } from './db';
import { addMoney, mulMoney, subMoney, sumMoney, round2 } from '../utils/money';
import { endOfDay, startOfDay } from '../utils/dates';

export interface DateRange {
  from: number;
  to: number;
}

export function inRange(ts: number, range: DateRange): boolean {
  return ts >= startOfDay(range.from) && ts <= endOfDay(range.to);
}

export interface SalesReportRow {
  invoice: Invoice;
}

export interface PnlReport {
  grossSales: number; // إجمالي الفواتير (قبل خصم) للفواتير النشطة
  discounts: number;
  sales: number; // صافي المبيعات بعد الخصومات
  cogs: number; // تكلفة البضاعة المباعة
  grossProfit: number;
  expenses: number;
  netProfit: number;
  invoiceCount: number;
  paidAmount: number; // المقبوظ نقدًا ضمن المبيعات
  outstanding: number; // المتوقع تحصيله
  cancelledCount: number;
  cancelledTotal: number;
  manualCount: number; // عدد السجلات اليدوية المحتسبة (لا تُنشئ فواتير فلا ازدواج)
  manualSales: number; // مبيعات يدوية ضمن الفترة
}

export interface DashboardData {
  pnl: PnlReport;
  todaySales: number;
  monthSales: number;
  monthPnl: PnlReport;
  inventoryCostValue: number; // قيمة المخزون بالتكلفة
  inventoryRetailValue: number;
  customerDebts: number;
  supplierDues: number;
  lowStock: Product[];
  recentInvoices: Invoice[];
  topProducts: { productId: string; name: string; quantity: number; revenue: number }[];
  salesSeries: { label: string; ts: number; sales: number; profit: number }[];
}

async function loadAll() {
  const [invoices, purchases, expenses, payments, supplierPayments, products, cash, manualSales] =
    await Promise.all([
      getAll<Invoice>('invoices'),
      getAll<Purchase>('purchases'),
      getAll<Expense>('expenses'),
      getAll<CustomerPayment>('customerPayments'),
      getAll<SupplierPayment>('supplierPayments'),
      getAll<Product>('products'),
      getAll<CashTransaction>('cash'),
      getAll<ManualSale>('manualSales'),
    ]);
  return { invoices, purchases, expenses, payments, supplierPayments, products, cash, manualSales };
}

/** تكلفة البضاعة لسجل يدوي (صفر إذا كانت التكلفة غير معروفة) */
export function manualSaleCogs(sale: ManualSale): number {
  return sale.unitCost === null ? 0 : mulMoney(sale.quantity, sale.unitCost);
}

export function computePnl(
  invoices: Invoice[],
  expenses: Expense[],
  range?: DateRange,
  manualSales: ManualSale[] = [],
): PnlReport {
  const inWindow = (ts: number) => (range ? inRange(ts, range) : true);
  const active = invoices.filter((i) => i.status !== 'cancelled' && inWindow(i.date));
  const cancelled = invoices.filter((i) => i.status === 'cancelled' && inWindow(i.date));
  const manual = manualSales.filter((m) => inWindow(m.date));
  const manualTotal = sumMoney(manual.map((m) => m.total));
  const grossSales = addMoney(sumMoney(active.map((i) => i.subtotal)), manualTotal);
  const discounts = sumMoney(active.map((i) => i.discount));
  const sales = addMoney(sumMoney(active.map((i) => i.total)), manualTotal);
  const cogs = addMoney(sumMoney(active.map((i) => i.cogs)), sumMoney(manual.map(manualSaleCogs)));
  const grossProfit = round2(sales - cogs);
  const exp = sumMoney(expenses.filter((e) => inWindow(e.date)).map((e) => e.amount));
  const netProfit = round2(grossProfit - exp);
  return {
    grossSales,
    discounts,
    sales,
    cogs,
    grossProfit,
    expenses: exp,
    netProfit,
    invoiceCount: active.length,
    paidAmount: addMoney(sumMoney(active.map((i) => i.paid)), sumMoney(manual.map((m) => m.paid))),
    outstanding: addMoney(
      sumMoney(active.map((i) => i.remaining)),
      sumMoney(manual.map((m) => round2(m.total - m.paid))),
    ),
    cancelledCount: cancelled.length,
    cancelledTotal: sumMoney(cancelled.map((i) => i.total)),
    manualCount: manual.length,
    manualSales: manualTotal,
  };
}

export async function getDashboard(
  range: DateRange,
  monthRange: DateRange,
  seriesDays = 7,
): Promise<DashboardData> {
  const { invoices, purchases, expenses, payments, supplierPayments, products, manualSales } = await loadAll();

  const pnl = computePnl(invoices, expenses, range, manualSales);
  const monthPnl = computePnl(invoices, expenses, monthRange, manualSales);

  const todayStart = startOfDay(Date.now());
  const todaySales = addMoney(
    sumMoney(invoices.filter((i) => i.status !== 'cancelled' && i.date >= todayStart).map((i) => i.total)),
    sumMoney(manualSales.filter((m) => m.date >= todayStart).map((m) => m.total)),
  );
  const monthStart = monthRange.from;
  const monthSales = addMoney(
    sumMoney(
      invoices.filter((i) => i.status !== 'cancelled' && i.date >= monthStart && i.date <= monthRange.to).map((i) => i.total),
    ),
    sumMoney(manualSales.filter((m) => m.date >= monthStart && m.date <= monthRange.to).map((m) => m.total)),
  );

  // قيمة المخزون بالتكلفة
  const activeProducts = products.filter((p) => !p.archived);
  const inventoryCostValue = round2(
    activeProducts.reduce((acc, p) => acc + p.quantity * p.purchasePrice, 0),
  );
  const inventoryRetailValue = round2(
    activeProducts.reduce((acc, p) => acc + p.quantity * p.salePrice, 0),
  );

  // ديون العملاء = المتبقي في الفواتير النشطة
  const customerDebts = sumMoney(
    invoices.filter((i) => i.status !== 'cancelled').map((i) => i.remaining),
  );

  // مستحقات الموردين = المتبقي في المشتريات المستلمة
  const supplierDues = sumMoney(
    purchases.filter((p) => p.status === 'received').map((p) => p.remaining),
  );

  const lowStock = activeProducts
    .filter((p) => p.quantity <= p.alertThreshold)
    .sort((a, b) => a.quantity - b.quantity);

  const recentInvoices = [...invoices]
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 8);

  // المنتجات الأكثر مبيعًا (للفواتير النشطة)
  const topMap = new Map<string, { productId: string; name: string; quantity: number; revenue: number }>();
  for (const inv of invoices) {
    if (inv.status === 'cancelled') continue;
    if (range && !inRange(inv.date, range)) continue;
    for (const item of inv.items) {
      const cur = topMap.get(item.productId) ?? { productId: item.productId, name: item.name, quantity: 0, revenue: 0 };
      cur.quantity += item.quantity;
      cur.revenue = round2(cur.revenue + item.lineTotal);
      topMap.set(item.productId, cur);
    }
  }
  for (const sale of manualSales) {
    if (range && !inRange(sale.date, range)) continue;
    const key = sale.productId ?? `manual:${sale.productName}`;
    const cur = topMap.get(key) ?? { productId: key, name: sale.productName, quantity: 0, revenue: 0 };
    cur.quantity += sale.quantity;
    cur.revenue = round2(cur.revenue + sale.total);
    topMap.set(key, cur);
  }
  const topProducts = [...topMap.values()].sort((a, b) => b.quantity - a.quantity).slice(0, 6);

  // سلسلة المبيعات اليومية
  const salesSeries: { label: string; ts: number; sales: number; profit: number }[] = [];
  const now = Date.now();
  for (let d = seriesDays - 1; d >= 0; d--) {
    const day = new Date(now);
    day.setDate(day.getDate() - d);
    const s = startOfDay(day.getTime());
    const e = endOfDay(day.getTime());
    const dayInvoices = invoices.filter((i) => i.status !== 'cancelled' && i.date >= s && i.date <= e);
    const dayManual = manualSales.filter((m) => m.date >= s && m.date <= e);
    const sales = addMoney(
      sumMoney(dayInvoices.map((i) => i.total)),
      sumMoney(dayManual.map((m) => m.total)),
    );
    const cogs = addMoney(
      sumMoney(dayInvoices.map((i) => i.cogs)),
      sumMoney(dayManual.map(manualSaleCogs)),
    );
    const dayExp = sumMoney(expenses.filter((x) => x.date >= s && x.date <= e).map((x) => x.amount));
    salesSeries.push({
      label: day.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit' }),
      ts: s,
      sales,
      profit: round2(sales - cogs - dayExp),
    });
  }

  // تجاهل ما لم نعد بحاجته هنا (تُستخدم في صفحات التقارير)
  void payments;
  void supplierPayments;

  return {
    pnl,
    todaySales,
    monthSales,
    monthPnl,
    inventoryCostValue,
    inventoryRetailValue,
    customerDebts,
    supplierDues,
    lowStock,
    recentInvoices,
    topProducts,
    salesSeries,
  };
}

// ————— تقارير مفصّلة —————

export interface SalesDetailRow {
  id: string;
  number: string;
  date: number;
  customer: string;
  status: string;
  subtotal: number;
  discount: number;
  total: number;
  paid: number;
  remaining: number;
  cogs: number;
  profit: number;
}

export function buildSalesReport(
  invoices: Invoice[],
  range: DateRange,
  manualSales: ManualSale[] = [],
): SalesDetailRow[] {
  const invoiceRows: SalesDetailRow[] = invoices
    .filter((i) => inRange(i.date, range))
    .map((i) => ({
      id: i.id,
      number: i.number,
      date: i.date,
      customer: i.customerName || '—',
      status: i.status,
      subtotal: i.subtotal,
      discount: i.discount,
      total: i.total,
      paid: i.paid,
      remaining: i.remaining,
      cogs: i.cogs,
      profit: i.status === 'cancelled' ? 0 : round2(i.total - i.cogs),
    }));
  const manualRows: SalesDetailRow[] = manualSales
    .filter((m) => inRange(m.date, range))
    .map((m) => {
      const cogs = manualSaleCogs(m);
      return {
        id: m.id,
        number: m.number,
        date: m.date,
        customer: m.buyerName || '—',
        status: 'manual',
        subtotal: m.total,
        discount: 0,
        total: m.total,
        paid: m.paid,
        remaining: round2(m.total - m.paid),
        cogs,
        profit: round2(m.total - cogs),
      };
    });
  return [...invoiceRows, ...manualRows].sort((a, b) => b.date - a.date);
}

export interface ProfitRow {
  date: number;
  sales: number;
  cogs: number;
  expenses: number;
  profit: number;
}

export function buildProfitReport(
  invoices: Invoice[],
  expenses: Expense[],
  range: DateRange,
  manualSales: ManualSale[] = [],
): ProfitRow[] {
  const days = new Map<number, ProfitRow>();
  const ensure = (ts: number): ProfitRow => {
    const key = startOfDay(ts);
    let row = days.get(key);
    if (!row) {
      row = { date: key, sales: 0, cogs: 0, expenses: 0, profit: 0 };
      days.set(key, row);
    }
    return row;
  };
  for (const i of invoices) {
    if (i.status === 'cancelled' || !inRange(i.date, range)) continue;
    const row = ensure(i.date);
    row.sales = round2(row.sales + i.total);
    row.cogs = round2(row.cogs + i.cogs);
  }
  for (const m of manualSales) {
    if (!inRange(m.date, range)) continue;
    const row = ensure(m.date);
    row.sales = round2(row.sales + m.total);
    row.cogs = round2(row.cogs + manualSaleCogs(m));
  }
  for (const e of expenses) {
    if (!inRange(e.date, range)) continue;
    const row = ensure(e.date);
    row.expenses = round2(row.expenses + e.amount);
  }
  return [...days.values()]
    .sort((a, b) => b.date - a.date)
    .map((r) => ({ ...r, profit: round2(r.sales - r.cogs - r.expenses) }));
}

export interface InventoryRow {
  productId: string;
  name: string;
  code: string;
  quantity: number;
  cost: number;
  price: number;
  costValue: number;
  retailValue: number;
  low: boolean;
}

export function buildInventoryReport(products: Product[]): InventoryRow[] {
  return products
    .filter((p) => !p.archived)
    .map((p) => ({
      productId: p.id,
      name: p.name,
      code: p.code,
      quantity: p.quantity,
      cost: p.purchasePrice,
      price: p.salePrice,
      costValue: round2(p.quantity * p.purchasePrice),
      retailValue: round2(p.quantity * p.salePrice),
      low: p.quantity <= p.alertThreshold,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export interface TopProductRow {
  productId: string;
  name: string;
  quantity: number;
  revenue: number;
  cost: number;
  profit: number;
}

export function buildTopProducts(
  invoices: Invoice[],
  range: DateRange,
  manualSales: ManualSale[] = [],
): TopProductRow[] {
  const map = new Map<string, TopProductRow>();
  for (const inv of invoices) {
    if (inv.status === 'cancelled' || !inRange(inv.date, range)) continue;
    for (const item of inv.items) {
      const row =
        map.get(item.productId) ??
        { productId: item.productId, name: item.name, quantity: 0, revenue: 0, cost: 0, profit: 0 };
      row.quantity += item.quantity;
      // توزيع خصم الفاتورة على البنود بالنسبة (كي يتطابق إجمالي الأرباح مع صافي المبيعات)
      const share = inv.subtotal > 0 ? item.lineTotal / inv.subtotal : 0;
      const net = subMoney(item.lineTotal, inv.discount * share);
      row.revenue = addMoney(row.revenue, net);
      row.cost = addMoney(row.cost, mulMoney(item.quantity, item.unitCost));
      map.set(item.productId, row);
    }
  }
  for (const m of manualSales) {
    if (!inRange(m.date, range)) continue;
    const key = m.productId ?? `manual:${m.productName}`;
    const row =
      map.get(key) ??
      { productId: key, name: m.productName, quantity: 0, revenue: 0, cost: 0, profit: 0 };
    row.quantity += m.quantity;
    row.revenue = addMoney(row.revenue, m.total);
    row.cost = addMoney(row.cost, manualSaleCogs(m));
    map.set(key, row);
  }
  return [...map.values()]
    .map((r) => ({ ...r, revenue: round2(r.revenue), profit: round2(r.revenue - r.cost) }))
    .sort((a, b) => b.quantity - a.quantity);
}
