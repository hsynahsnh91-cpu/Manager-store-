import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  BarChart3,
  Banknote,
  Boxes,
  Building2,
  CreditCard,
  Download,
  Printer,
  Receipt,
  ShoppingCart,
  TrendingUp,
  Users,
  Wallet,
} from 'lucide-react';
import {
  buildInventoryReport,
  buildProfitReport,
  buildSalesReport,
  buildTopProducts,
  computePnl,
  inRange,
  type DateRange,
} from '../../services/reports';
import { getAll } from '../../services/db';
import { useAsync } from '../../hooks/useAsync';
import { useApp } from '../../context/AppContext';
import { useI18n } from '../../i18n';
import { Button } from '../../components/Button';
import { EmptyState, SkeletonRows, StatCard } from '../../components/UI';
import { downloadCSV } from '../../utils/csv';
import { daysAgo, endOfDay, formatDate, startOfDay, startOfMonth, toDateInput, fromDateInput } from '../../utils/dates';
import { formatMoney } from '../../utils/money';
import type { CashTransaction, Customer, Expense, Invoice, Product, Purchase, Supplier } from '../../types';

type Tab =
  | 'sales'
  | 'profit'
  | 'purchases'
  | 'expenses'
  | 'inventory'
  | 'top'
  | 'customerDebts'
  | 'supplierDues'
  | 'cash';

export function ReportsPage() {
  const { t, lang } = useI18n();
  const { settings, toast } = useApp();

  const [tab, setTab] = useState<Tab>('sales');
  const [from, setFrom] = useState(toDateInput(startOfMonth(Date.now())));
  const [to, setTo] = useState(toDateInput(Date.now()));

  const range: DateRange = useMemo(
    () => ({ from: fromDateInput(from), to: endOfDay(fromDateInput(to)) }),
    [from, to],
  );

  const { data, loading } = useAsync(async () => {
    const [invoices, purchases, expenses, products, cash, customers, suppliers] = await Promise.all([
      getAll<Invoice>('invoices'),
      getAll<Purchase>('purchases'),
      getAll<Expense>('expenses'),
      getAll<Product>('products'),
      getAll<CashTransaction>('cash'),
      getAll<Customer>('customers'),
      getAll<Supplier>('suppliers'),
    ]);
    return { invoices, purchases, expenses, products, cash, customers, suppliers };
  }, []);

  const money = (v: number) => formatMoney(v, settings.currency);
  const shortDate = (ts: number) => formatDate(ts, lang);

  const d = data;
  const pnl = useMemo(() => (d ? computePnl(d.invoices, d.expenses, range) : null), [d, range]);

  const salesRows = useMemo(() => (d ? buildSalesReport(d.invoices, range) : []), [d, range]);
  const profitRows = useMemo(() => (d ? buildProfitReport(d.invoices, d.expenses, range) : []), [d, range]);
  const inventoryRows = useMemo(() => (d ? buildInventoryReport(d.products) : []), [d]);
  const topRows = useMemo(() => (d ? buildTopProducts(d.invoices, range) : []), [d, range]);

  const purchaseRows = useMemo(
    () =>
      d
        ? d.purchases
            .filter((p) => inRange(p.date, range) && p.status !== 'cancelled')
            .sort((a, b) => b.date - a.date)
        : [],
    [d, range],
  );
  const expenseRows = useMemo(
    () => (d ? d.expenses.filter((e) => inRange(e.date, range)).sort((a, b) => b.date - a.date) : []),
    [d, range],
  );
  const cashRows = useMemo(
    () => (d ? d.cash.filter((c) => inRange(c.date, range)).sort((a, b) => b.date - a.date) : []),
    [d, range],
  );
  const customerDebtRows = useMemo(() => {
    if (!d) return [];
    const active = d.invoices.filter((i) => i.status !== 'cancelled');
    return d.customers
      .map((c) => ({
        customer: c,
        balance: active.filter((i) => i.customerId === c.id).reduce((a, i) => a + i.remaining, 0),
        count: active.filter((i) => i.customerId === c.id && i.remaining > 0).length,
      }))
      .filter((r) => r.balance > 0)
      .sort((a, b) => b.balance - a.balance);
  }, [d]);
  const supplierDueRows = useMemo(() => {
    if (!d) return [];
    return d.suppliers
      .map((s) => ({
        supplier: s,
        balance: d.purchases
          .filter((p) => p.supplierId === s.id && p.status === 'received')
          .reduce((a, p) => a + p.remaining, 0),
      }))
      .filter((r) => r.balance > 0)
      .sort((a, b) => b.balance - a.balance);
  }, [d]);

  const tabs: { id: Tab; label: string; icon: typeof Receipt }[] = [
    { id: 'sales', label: t('tabSales'), icon: Receipt },
    { id: 'profit', label: t('tabProfit'), icon: TrendingUp },
    { id: 'purchases', label: t('tabPurchases'), icon: ShoppingCart },
    { id: 'expenses', label: t('tabExpenses'), icon: CreditCard },
    { id: 'inventory', label: t('tabInventory'), icon: Boxes },
    { id: 'top', label: t('tabTop'), icon: BarChart3 },
    { id: 'customerDebts', label: t('tabCustomerDebts'), icon: Users },
    { id: 'supplierDues', label: t('tabSupplierDues'), icon: Building2 },
    { id: 'cash', label: t('tabCash'), icon: Wallet },
  ];

  const exportCsv = () => {
    try {
      switch (tab) {
        case 'sales':
          downloadCSV(
            'sales-report',
            [t('invoiceNumber'), t('date'), t('customer'), t('status'), t('subtotal'), t('discount'), t('total'), t('paid'), t('remaining'), t('cogs'), t('profit')],
            salesRows.map((r) => [r.number, shortDate(r.date), r.customer, r.status, r.subtotal, r.discount, r.total, r.paid, r.remaining, r.cogs, r.profit]),
          );
          break;
        case 'profit':
          downloadCSV(
            'profit-report',
            [t('date'), t('sales'), t('cogs'), t('expensesTotal'), t('profit')],
            profitRows.map((r) => [shortDate(r.date), r.sales, r.cogs, r.expenses, r.profit]),
          );
          break;
        case 'purchases':
          downloadCSV(
            'purchases-report',
            [t('purchaseNumber'), t('date'), t('supplier'), t('total'), t('paid'), t('remaining'), t('status')],
            purchaseRows.map((p) => [p.number, shortDate(p.date), p.supplierName, p.total, p.paid, p.remaining, p.status]),
          );
          break;
        case 'expenses':
          downloadCSV(
            'expenses-report',
            [t('date'), t('expenseCategory'), t('description'), t('paymentMethod'), t('amount')],
            expenseRows.map((e) => [shortDate(e.date), e.category, e.description, e.paymentMethod, e.amount]),
          );
          break;
        case 'inventory':
          downloadCSV(
            'inventory-report',
            [t('productName'), t('productCode'), t('quantity'), t('purchasePrice'), t('salePrice'), t('stockValue')],
            inventoryRows.map((r) => [r.name, r.code, r.quantity, r.cost, r.price, r.costValue]),
          );
          break;
        case 'top':
          downloadCSV(
            'top-products',
            [t('productName'), t('quantity'), t('sales'), t('cogs'), t('profit')],
            topRows.map((r) => [r.name, r.quantity, r.revenue, r.cost, r.profit]),
          );
          break;
        case 'customerDebts':
          downloadCSV(
            'customer-debts',
            [t('customerName'), t('phone'), t('dueInvoices'), t('balance')],
            customerDebtRows.map((r) => [r.customer.name, r.customer.phone, r.count, r.balance]),
          );
          break;
        case 'supplierDues':
          downloadCSV(
            'supplier-dues',
            [t('supplierName'), t('phone'), t('dues')],
            supplierDueRows.map((r) => [r.supplier.name, r.supplier.phone, r.balance]),
          );
          break;
        case 'cash':
          downloadCSV(
            'cash-flow',
            [t('date'), t('description'), t('expenseCategory'), t('amount'), t('status')],
            cashRows.map((c) => [shortDate(c.date), c.description, c.category, c.type === 'out' ? -c.amount : c.amount, c.type]),
          );
          break;
      }
      toast(t('success'));
    } catch {
      toast(t('error'), 'error');
    }
  };

  const printReport = () => {
    setTimeout(() => window.print(), 100);
  };

  const quickRanges = [
    { label: t('today'), from: toDateInput(startOfDay(Date.now())), to: toDateInput(Date.now()) },
    { label: t('last7'), from: toDateInput(daysAgo(6)), to: toDateInput(Date.now()) },
    { label: t('last30'), from: toDateInput(daysAgo(29)), to: toDateInput(Date.now()) },
    { label: t('thisMonth'), from: toDateInput(startOfMonth(Date.now())), to: toDateInput(Date.now()) },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-extrabold text-slate-800 dark:text-white">{t('reportsTitle')}</h1>
          {pnl && (
            <p className="mt-0.5 text-xs text-slate-400">
              {t('sales')}: {money(pnl.sales)} · {t('cogs')}: {money(pnl.cogs)} · {t('grossProfit')}: {money(pnl.grossProfit)} ·{' '}
              {t('netProfit')}: <strong className={pnl.netProfit >= 0 ? 'text-emerald-600' : 'text-rose-600'}>{money(pnl.netProfit)}</strong>
            </p>
          )}
        </div>
        <div className="flex gap-2 no-print">
          <Button variant="secondary" size="sm" icon={<Download size={14} />} onClick={exportCsv}>
            {t('exportCsv')}
          </Button>
          <Button variant="secondary" size="sm" icon={<Printer size={14} />} onClick={printReport}>
            {t('exportPdf')}
          </Button>
        </div>
      </div>

      {/* نطاق التاريخ */}
      <div className="card flex flex-wrap items-end gap-2 p-3 no-print">
        <label className="text-xs font-semibold text-slate-500">
          {t('from')}
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="ms-2 h-9 rounded-lg border border-slate-300 bg-white px-2 text-xs dark:border-slate-600 dark:bg-slate-800"
          />
        </label>
        <label className="text-xs font-semibold text-slate-500">
          {t('to')}
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="ms-2 h-9 rounded-lg border border-slate-300 bg-white px-2 text-xs dark:border-slate-600 dark:bg-slate-800"
          />
        </label>
        {quickRanges.map((qr) => (
          <button
            key={qr.label}
            onClick={() => {
              setFrom(qr.from);
              setTo(qr.to);
            }}
            className="rounded-lg bg-slate-100 px-3 py-1.5 text-[11px] font-bold text-slate-600 transition-colors hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
          >
            {qr.label}
          </button>
        ))}
      </div>

      {/* التبويبات */}
      <div className="flex gap-1.5 overflow-x-auto pb-1 no-print">
        {tabs.map((tb) => (
          <button
            key={tb.id}
            onClick={() => setTab(tb.id)}
            className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-bold transition-all ${
              tab === tb.id
                ? 'bg-brand-600 text-white shadow-sm'
                : 'bg-white text-slate-500 hover:bg-slate-100 dark:bg-slate-900 dark:text-slate-400 dark:hover:bg-slate-800'
            }`}
          >
            <tb.icon size={13} />
            {tb.label}
          </button>
        ))}
      </div>

      {/* بطاقات الملخص لتبويض الربح */}
      {tab === 'profit' && pnl && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <StatCard title={t('netSales')} value={money(pnl.sales)} icon={<Receipt size={17} />} accent="brand" loading={loading} />
          <StatCard title={t('cogs')} value={money(pnl.cogs)} icon={<Boxes size={17} />} accent="amber" loading={loading} />
          <StatCard title={t('grossProfit')} value={money(pnl.grossProfit)} icon={<TrendingUp size={17} />} accent="emerald" loading={loading} />
          <StatCard title={t('expensesTotal')} value={money(pnl.expenses)} icon={<CreditCard size={17} />} accent="rose" loading={loading} />
          <StatCard
            title={t('netProfit')}
            value={money(pnl.netProfit)}
            icon={<Banknote size={17} />}
            accent={pnl.netProfit >= 0 ? 'emerald' : 'rose'}
            loading={loading}
          />
        </div>
      )}

      {/* الجداول */}
      <div className="card overflow-hidden">
        {loading ? (
          <SkeletonRows rows={7} cols={6} />
        ) : (
          <div className="overflow-x-auto">
            {tab === 'sales' &&
              (salesRows.length === 0 ? (
                <EmptyState icon={<Receipt size={26} />} title={t('noInvoices')} hint={t('noInvoicesHint')} />
              ) : (
                <table className="table-base">
                  <thead>
                    <tr>
                      <th>{t('invoiceNumber')}</th>
                      <th>{t('date')}</th>
                      <th>{t('customer')}</th>
                      <th className="th-numeric">{t('total')}</th>
                      <th className="th-numeric">{t('paid')}</th>
                      <th className="th-numeric">{t('remaining')}</th>
                      <th className="th-numeric">{t('cogs')}</th>
                      <th className="th-numeric">{t('profit')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {salesRows.map((r) => (
                      <tr key={r.id} className={r.status === 'cancelled' ? 'opacity-60' : ''}>
                        <td className="font-bold" dir="ltr">{r.number}</td>
                        <td className="text-xs text-slate-500">{shortDate(r.date)}</td>
                        <td className="text-xs">{r.customer}</td>
                        <td className="td-numeric font-bold">{money(r.total)}</td>
                        <td className="td-numeric text-emerald-600">{money(r.paid)}</td>
                        <td className="td-numeric text-rose-500">{money(r.remaining)}</td>
                        <td className="td-numeric text-slate-400">{money(r.cogs)}</td>
                        <td className={`td-numeric font-bold ${r.profit >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{money(r.profit)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ))}

            {tab === 'profit' &&
              (profitRows.length === 0 ? (
                <EmptyState icon={<TrendingUp size={26} />} title={t('noData')} hint={t('emptyHint')} />
              ) : (
                <table className="table-base">
                  <thead>
                    <tr>
                      <th>{t('date')}</th>
                      <th className="th-numeric">{t('sales')}</th>
                      <th className="th-numeric">{t('cogs')}</th>
                      <th className="th-numeric">{t('expensesTotal')}</th>
                      <th className="th-numeric">{t('profit')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {profitRows.map((r) => (
                      <tr key={r.date}>
                        <td className="text-xs font-semibold">{shortDate(r.date)}</td>
                        <td className="td-numeric">{money(r.sales)}</td>
                        <td className="td-numeric text-slate-400">{money(r.cogs)}</td>
                        <td className="td-numeric text-rose-500">{money(r.expenses)}</td>
                        <td className={`td-numeric font-bold ${r.profit >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{money(r.profit)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ))}

            {tab === 'purchases' &&
              (purchaseRows.length === 0 ? (
                <EmptyState icon={<ShoppingCart size={26} />} title={t('noPurchases')} hint={t('noPurchasesHint')} />
              ) : (
                <table className="table-base">
                  <thead>
                    <tr>
                      <th>{t('purchaseNumber')}</th>
                      <th>{t('date')}</th>
                      <th>{t('supplier')}</th>
                      <th className="th-numeric">{t('total')}</th>
                      <th className="th-numeric">{t('paid')}</th>
                      <th className="th-numeric">{t('remaining')}</th>
                      <th>{t('status')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {purchaseRows.map((p) => (
                      <tr key={p.id}>
                        <td className="font-bold" dir="ltr">{p.number}</td>
                        <td className="text-xs text-slate-500">{shortDate(p.date)}</td>
                        <td className="text-xs">{p.supplierName || '—'}</td>
                        <td className="td-numeric font-bold">{money(p.total)}</td>
                        <td className="td-numeric text-emerald-600">{money(p.paid)}</td>
                        <td className="td-numeric text-rose-500">{money(p.remaining)}</td>
                        <td className="text-xs">{p.status === 'received' ? t('received') : t('ordered')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ))}

            {tab === 'expenses' &&
              (expenseRows.length === 0 ? (
                <EmptyState icon={<CreditCard size={26} />} title={t('noExpenses')} hint={t('noExpensesHint')} />
              ) : (
                <table className="table-base">
                  <thead>
                    <tr>
                      <th>{t('date')}</th>
                      <th>{t('expenseCategory')}</th>
                      <th>{t('description')}</th>
                      <th className="th-numeric">{t('amount')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {expenseRows.map((e) => (
                      <tr key={e.id}>
                        <td className="text-xs text-slate-500">{shortDate(e.date)}</td>
                        <td className="text-xs font-bold">{e.category}</td>
                        <td className="text-xs text-slate-500">{e.description || '—'}</td>
                        <td className="td-numeric font-bold text-rose-600">{money(e.amount)}</td>
                      </tr>
                    ))}
                    <tr className="bg-slate-50 dark:bg-slate-800/60">
                      <td colSpan={3} className="text-end text-xs font-extrabold">{t('totalExpenses')}</td>
                      <td className="td-numeric font-extrabold text-rose-600">{money(pnl?.expenses ?? 0)}</td>
                    </tr>
                  </tbody>
                </table>
              ))}

            {tab === 'inventory' &&
              (inventoryRows.length === 0 ? (
                <EmptyState icon={<Boxes size={26} />} title={t('noData')} hint={t('emptyHint')} />
              ) : (
                <table className="table-base">
                  <thead>
                    <tr>
                      <th>{t('productName')}</th>
                      <th className="th-numeric">{t('quantity')}</th>
                      <th className="th-numeric">{t('purchasePrice')}</th>
                      <th className="th-numeric">{t('salePrice')}</th>
                      <th className="th-numeric">{t('stockValue')}</th>
                      <th>{t('status')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {inventoryRows.map((r) => (
                      <tr key={r.productId}>
                        <td>
                          <span className="text-xs font-bold">{r.name}</span>
                          <span className="ms-1.5 text-[10px] text-slate-400" dir="ltr">{r.code}</span>
                        </td>
                        <td className="td-numeric font-bold">{r.quantity}</td>
                        <td className="td-numeric">{money(r.cost)}</td>
                        <td className="td-numeric">{money(r.price)}</td>
                        <td className="td-numeric font-bold">{money(r.costValue)}</td>
                        <td>
                          {r.quantity <= 0 ? (
                            <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-bold text-rose-600">{t('outOfStock')}</span>
                          ) : r.low ? (
                            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-600">{t('lowStock')}</span>
                          ) : (
                            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-600">{t('inStock')}</span>
                          )}
                        </td>
                      </tr>
                    ))}
                    <tr className="bg-slate-50 dark:bg-slate-800/60">
                      <td className="text-end text-xs font-extrabold" colSpan={4}>{t('stockValue')}</td>
                      <td className="td-numeric font-extrabold" colSpan={2}>
                        {money(inventoryRows.reduce((a, r) => a + r.costValue, 0))}
                      </td>
                    </tr>
                  </tbody>
                </table>
              ))}

            {tab === 'top' &&
              (topRows.length === 0 ? (
                <EmptyState icon={<BarChart3 size={26} />} title={t('noData')} hint={t('emptyHint')} />
              ) : (
                <table className="table-base">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>{t('productName')}</th>
                      <th className="th-numeric">{t('quantity')}</th>
                      <th className="th-numeric">{t('sales')}</th>
                      <th className="th-numeric">{t('cogs')}</th>
                      <th className="th-numeric">{t('profit')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {topRows.map((r, i) => (
                      <tr key={r.productId}>
                        <td className="text-xs font-bold text-slate-400">{i + 1}</td>
                        <td className="text-xs font-bold">{r.name}</td>
                        <td className="td-numeric font-bold">{r.quantity}</td>
                        <td className="td-numeric">{money(r.revenue)}</td>
                        <td className="td-numeric text-slate-400">{money(r.cost)}</td>
                        <td className="td-numeric font-bold text-emerald-600">{money(r.profit)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ))}

            {tab === 'customerDebts' &&
              (customerDebtRows.length === 0 ? (
                <EmptyState icon={<Users size={26} />} title={t('noCustomers')} hint={t('emptyHint')} />
              ) : (
                <table className="table-base">
                  <thead>
                    <tr>
                      <th>{t('customerName')}</th>
                      <th>{t('phone')}</th>
                      <th className="th-numeric">{t('dueInvoices')}</th>
                      <th className="th-numeric">{t('balance')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {customerDebtRows.map((r) => (
                      <tr key={r.customer.id}>
                        <td className="text-xs font-bold">{r.customer.name}</td>
                        <td className="text-xs" dir="ltr">{r.customer.phone || '—'}</td>
                        <td className="td-numeric">{r.count}</td>
                        <td className="td-numeric font-bold text-rose-600">{money(r.balance)}</td>
                      </tr>
                    ))}
                    <tr className="bg-slate-50 dark:bg-slate-800/60">
                      <td colSpan={3} className="text-end text-xs font-extrabold">{t('totalDebts')}</td>
                      <td className="td-numeric font-extrabold text-rose-600">
                        {money(customerDebtRows.reduce((a, r) => a + r.balance, 0))}
                      </td>
                    </tr>
                  </tbody>
                </table>
              ))}

            {tab === 'supplierDues' &&
              (supplierDueRows.length === 0 ? (
                <EmptyState icon={<Building2 size={26} />} title={t('noSuppliers')} hint={t('emptyHint')} />
              ) : (
                <table className="table-base">
                  <thead>
                    <tr>
                      <th>{t('supplierName')}</th>
                      <th>{t('phone')}</th>
                      <th className="th-numeric">{t('dues')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {supplierDueRows.map((r) => (
                      <tr key={r.supplier.id}>
                        <td className="text-xs font-bold">{r.supplier.name}</td>
                        <td className="text-xs" dir="ltr">{r.supplier.phone || '—'}</td>
                        <td className="td-numeric font-bold text-rose-600">{money(r.balance)}</td>
                      </tr>
                    ))}
                    <tr className="bg-slate-50 dark:bg-slate-800/60">
                      <td colSpan={2} className="text-end text-xs font-extrabold">{t('supplierDuesTotal')}</td>
                      <td className="td-numeric font-extrabold text-rose-600">
                        {money(supplierDueRows.reduce((a, r) => a + r.balance, 0))}
                      </td>
                    </tr>
                  </tbody>
                </table>
              ))}

            {tab === 'cash' &&
              (cashRows.length === 0 ? (
                <EmptyState icon={<Wallet size={26} />} title={t('noCash')} hint={t('noCashHint')} />
              ) : (
                <table className="table-base">
                  <thead>
                    <tr>
                      <th>{t('date')}</th>
                      <th>{t('description')}</th>
                      <th>{t('expenseCategory')}</th>
                      <th className="th-numeric">{t('amount')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cashRows.map((c) => (
                      <tr key={c.id}>
                        <td className="whitespace-nowrap text-xs text-slate-500">{shortDate(c.date)}</td>
                        <td className="text-xs font-semibold">{c.description}</td>
                        <td className="text-xs">{c.category}</td>
                        <td className={`td-numeric font-bold ${c.type === 'in' ? 'text-emerald-600' : c.type === 'out' ? 'text-rose-600' : 'text-slate-500'}`}>
                          {c.type === 'in' ? '+' : c.type === 'out' ? '−' : '⇄ '}{money(c.amount)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ))}
          </div>
        )}
      </div>

      {!loading && pnl && (tab === 'sales' || tab === 'profit') && (
        <div className="flex flex-wrap items-center gap-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
          <AlertTriangle size={15} />
          <span>
            {t('netSales')}: <strong>{money(pnl.sales)}</strong> − {t('cogs')}: <strong>{money(pnl.cogs)}</strong> = {t('grossProfit')}:{' '}
            <strong>{money(pnl.grossProfit)}</strong> − {t('expensesTotal')}: <strong>{money(pnl.expenses)}</strong> = {t('netProfit')}:{' '}
            <strong>{money(pnl.netProfit)}</strong>
            {pnl.cancelledCount > 0 && (
              <>
                {' · '}
                {t('statusCancelled')}: {pnl.cancelledCount} ({money(pnl.cancelledTotal)})
              </>
            )}
          </span>
        </div>
      )}
    </div>
  );
}
