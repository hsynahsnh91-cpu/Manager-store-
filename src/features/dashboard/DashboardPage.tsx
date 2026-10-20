import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowLeft,
  Banknote,
  Boxes,
  Receipt,
  ShoppingCart,
  TrendingDown,
  TrendingUp,
  Users,
  Wallet,
  Building2,
  Camera,
  ClipboardList,
  Tag,
  ScanLine,
  Trash2,
  CalendarClock,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { getDashboard } from '../../services/reports';
import { useAsync } from '../../hooks/useAsync';
import { useApp } from '../../context/AppContext';
import { useI18n } from '../../i18n';
import { EmptyState, StatCard, Badge, SkeletonRows } from '../../components/UI';
import { formatMoney } from '../../utils/money';
import { formatDate, startOfMonth, endOfMonth, startOfDay, endOfDay } from '../../utils/dates';

export function DashboardPage() {
  const { t, lang } = useI18n();
  const { settings } = useApp();

  const range = useMemo(() => ({ from: startOfDay(Date.now()), to: endOfDay(Date.now()) }), []);
  const monthRange = useMemo(() => ({ from: startOfMonth(Date.now()), to: endOfMonth(Date.now()) }), []);
  const { data, loading } = useAsync(() => getDashboard(range, monthRange, 7), [range.from, monthRange.from]);

  const money = (v: number) => formatMoney(v, settings.currency);

  if (loading && !data) {
    return (
      <div className="space-y-4">
        <h1 className="text-lg font-extrabold">{t('dashboardTitle')}</h1>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-24 animate-pulse-soft rounded-xl bg-slate-200 dark:bg-slate-800" />
          ))}
        </div>
        <div className="card p-4">
          <SkeletonRows rows={5} cols={4} />
        </div>
      </div>
    );
  }

  if (!data) {
    return <EmptyState icon={<Banknote size={26} />} title={t('error')} hint={t('errGeneric')} />;
  }

  const { pnl, monthPnl } = data;
  const chartData = data.salesSeries;
  const hasChartData = chartData.some((d) => d.sales > 0 || d.profit > 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-extrabold text-slate-800 dark:text-white">{t('dashboardTitle')}</h1>
          <p className="mt-0.5 text-xs text-slate-400">
            {t('today')}: {money(data.todaySales)} · {t('thisMonth')}: {money(data.monthSales)}
          </p>
        </div>
        <Link
          to="/pos"
          className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3.5 py-2 text-xs font-bold text-white transition-colors hover:bg-brand-700"
        >
          <ShoppingCart size={14} />
          {t('posTitle')}
        </Link>
      </div>

      {/* اختصارات سريعة للميزات الجديدة */}
      <div className="grid gap-2 sm:grid-cols-3">
        <Link to="/sales-log" className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-3 py-2.5 transition-colors hover:border-brand-300 hover:bg-brand-50/40 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-brand-700 dark:hover:bg-brand-900/10">
          <span className="flex items-center gap-2 text-xs font-bold text-slate-700 dark:text-slate-200">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-50 text-brand-600 dark:bg-brand-900/30 dark:text-brand-300"><ClipboardList size={16} /></span>
            {t('quickSalesLog')}
          </span>
          <ArrowLeft size={14} className="text-slate-300 rtl:rotate-180" />
        </Link>
        <Link to="/scan" className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-3 py-2.5 transition-colors hover:border-brand-300 hover:bg-brand-50/40 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-brand-700 dark:hover:bg-brand-900/10">
          <span className="flex items-center gap-2 text-xs font-bold text-slate-700 dark:text-slate-200">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-50 text-amber-600 dark:bg-amber-900/30 dark:text-amber-300"><Camera size={16} /></span>
            {t('quickScan')}
          </span>
          <ScanLine size={14} className="text-slate-300" />
        </Link>
        <Link to="/prices" className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-3 py-2.5 transition-colors hover:border-brand-300 hover:bg-brand-50/40 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-brand-700 dark:hover:bg-brand-900/10">
          <span className="flex items-center gap-2 text-xs font-bold text-slate-700 dark:text-slate-200">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-300"><Tag size={16} /></span>
            {t('quickPrices')}
          </span>
          <ArrowLeft size={14} className="text-slate-300 rtl:rotate-180" />
        </Link>
      </div>

      {/* البطاقات المالية */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
        <StatCard title={t('todaySales')} amount={data.todaySales} icon={<ShoppingCart size={18} />} accent="brand" loading={loading} />
        <StatCard title={t('monthSales')} amount={data.monthSales} icon={<Receipt size={18} />} accent="brand" loading={loading} />
        <StatCard
          title={`${t('invoiceCount')} (${t('today')})`}
          value={String(pnl.invoiceCount)}
          icon={<Receipt size={18} />}
          accent="violet"
          loading={loading}
        />
        <StatCard title={t('expensesTotal')} amount={pnl.expenses} icon={<TrendingDown size={18} />} accent="rose" loading={loading} />
        <StatCard title={t('cogs')} amount={pnl.cogs} icon={<Boxes size={18} />} accent="amber" loading={loading} />
        <StatCard title={t('grossProfit')} amount={pnl.grossProfit} icon={<TrendingUp size={18} />} accent="emerald" loading={loading} />
        <StatCard title={t('netProfit')} amount={pnl.netProfit} icon={<Banknote size={18} />} accent={pnl.netProfit >= 0 ? 'emerald' : 'rose'} loading={loading} />
        <StatCard title={t('inventoryValue')} amount={data.inventoryCostValue} icon={<Boxes size={18} />} accent="brand" loading={loading} />
        <StatCard title={t('customerDebtsTotal')} amount={data.customerDebts} icon={<Users size={18} />} accent="rose" loading={loading} />
        <StatCard title={t('supplierDuesTotal')} amount={data.supplierDues} icon={<Building2 size={18} />} accent="amber" loading={loading} />
        <StatCard
          title={t('lowStockProducts')}
          value={String(data.lowStock.length)}
          icon={<AlertTriangle size={18} />}
          accent={data.lowStock.length > 0 ? 'amber' : 'emerald'}
          loading={loading}
        />
        <StatCard title={t('cashCollected')} amount={pnl.paidAmount} icon={<Wallet size={18} />} accent="emerald" loading={loading} />
        <StatCard title={t('writeOffs')} amount={pnl.writeOffs} icon={<Trash2 size={18} />} accent="rose" loading={loading} />
        <StatCard
          title={t('netProfit')}
          sub={t('thisMonth')}
          amount={monthPnl.netProfit}
          icon={<Wallet size={18} />}
          accent={monthPnl.netProfit >= 0 ? 'emerald' : 'rose'}
          loading={loading}
        />
      </div>

      {/* الرسم البياني */}
      <div className="card p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-bold text-slate-700 dark:text-slate-200">{t('salesChart')}</h2>
        </div>
        {!hasChartData ? (
          <EmptyState icon={<TrendingUp size={24} />} title={t('noChartData')} hint={t('emptyHint')} />
        ) : (
          <div className="h-64 w-full" dir="ltr">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.25)" />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#94a3b8' }} />
                <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} width={50} />
                <Tooltip
                  contentStyle={{ borderRadius: 10, fontSize: 12, direction: 'ltr' }}
                  formatter={(value: number, name: string) => [formatMoney(value, settings.currency), name === 'sales' ? t('sales') : t('profit')]}
                />
                <Legend formatter={(value: string) => (value === 'sales' ? t('sales') : t('profit'))} />
                <Line type="monotone" dataKey="sales" stroke="#338fff" strokeWidth={2} dot={{ r: 3 }} />
                <Line type="monotone" dataKey="profit" stroke="#10b981" strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* أحدث الفواتير */}
        <div className="card overflow-hidden">
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-700">
            <h2 className="text-sm font-bold text-slate-700 dark:text-slate-200">{t('recentTransactions')}</h2>
            <Link to="/invoices" className="inline-flex items-center gap-1 text-xs font-bold text-brand-600 hover:underline">
              {t('all')} <ArrowLeft size={13} className="rtl:rotate-180" />
            </Link>
          </div>
          {data.recentInvoices.length === 0 ? (
            <EmptyState icon={<Receipt size={24} />} title={t('noInvoices')} hint={t('noInvoicesHint')} />
          ) : (
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {data.recentInvoices.map((inv) => (
                <li key={inv.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-xs font-bold text-slate-700 dark:text-slate-200">
                      <span dir="ltr">{inv.number}</span> · {inv.customerName || t('walkInCustomer')}
                    </p>
                    <p className="text-[11px] text-slate-400">{formatDate(inv.date, lang)}</p>
                  </div>
                  <div className="text-end">
                    <p className="text-xs font-extrabold text-slate-700 dark:text-slate-200" dir="ltr">
                      {money(inv.total)}
                    </p>
                    {inv.status === 'cancelled' ? (
                      <Badge tone="rose">{t('statusCancelled')}</Badge>
                    ) : inv.status === 'paid' ? (
                      <Badge tone="green">{t('statusPaid')}</Badge>
                    ) : inv.status === 'partial' ? (
                      <Badge tone="amber">{t('statusPartial')}</Badge>
                    ) : (
                      <Badge tone="blue">{t('statusUnpaid')}</Badge>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* الأكثر مبيعًا + المخزون المنخفض */}
        <div className="space-y-4">
          <div className="card overflow-hidden">
            <div className="border-b border-slate-200 px-4 py-3 dark:border-slate-700">
              <h2 className="text-sm font-bold text-slate-700 dark:text-slate-200">{t('topSelling')}</h2>
            </div>
            {data.topProducts.length === 0 ? (
              <EmptyState icon={<ShoppingCart size={24} />} title={t('noData')} hint={t('emptyHint')} />
            ) : (
              <div className="h-48 w-full px-2 pt-3" dir="ltr">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data.topProducts.map((p) => ({ name: p.name.slice(0, 10), qty: p.quantity }))}>
                    <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#94a3b8' }} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: '#94a3b8' }} width={30} />
                    <Tooltip cursor={{ fill: 'rgba(51,143,255,0.08)' }} contentStyle={{ borderRadius: 10, fontSize: 12 }} />
                    <Bar dataKey="qty" fill="#338fff" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>

          <div className="card overflow-hidden">
            <div className="border-b border-slate-200 px-4 py-3 dark:border-slate-700">
              <h2 className="text-sm font-bold text-slate-700 dark:text-slate-200">{t('lowStockProducts')}</h2>
            </div>
            {data.lowStock.length === 0 ? (
              <EmptyState icon={<Boxes size={24} />} title={t('inStock')} hint={t('emptyHint')} />
            ) : (
              <ul className="max-h-56 divide-y divide-slate-100 overflow-y-auto dark:divide-slate-800">
                {data.lowStock.map((p) => (
                  <li key={p.id} className="flex items-center justify-between px-4 py-2.5 text-xs">
                    <div className="min-w-0">
                      <p className="truncate font-bold text-slate-700 dark:text-slate-200">{p.name}</p>
                      <p className="text-[11px] text-slate-400" dir="ltr">
                        {p.code}
                      </p>
                    </div>
                    <Badge tone={p.quantity <= 0 ? 'rose' : 'amber'}>
                      {p.quantity} / {p.alertThreshold}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      {/* تنبيهات الصلاحية */}
      <div className="card overflow-hidden">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-700">
          <h2 className="flex items-center gap-2 text-sm font-bold text-slate-700 dark:text-slate-200">
            <CalendarClock size={16} className="text-amber-500" /> {t('expiryAlerts')}
          </h2>
          <Link to="/products" className="text-xs font-bold text-brand-600 hover:underline">
            {t('productsTitle')}
          </Link>
        </div>
        {data.expiryAlerts.length === 0 ? (
          <EmptyState icon={<CalendarClock size={24} />} title={t('noExpiry')} hint={t('emptyHint')} />
        ) : (
          <ul className="max-h-64 divide-y divide-slate-100 overflow-y-auto dark:divide-slate-800">
            {data.expiryAlerts.map((row) => (
              <li key={row.product.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-xs">
                <div className="min-w-0">
                  <p className="truncate font-bold text-slate-700 dark:text-slate-200">{row.product.name}</p>
                  <p className="text-[11px] text-slate-400">
                    {row.product.quantity} · {row.product.batchNumber || '—'}
                  </p>
                </div>
                <Badge tone={row.status === 'expired' ? 'rose' : 'amber'}>
                  {row.status === 'expired' ? t('expired') : `${row.daysLeft} ${t('daysLeft')}`}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* ملخص الفترة */}
      <div className="card grid grid-cols-2 gap-4 p-4 text-xs sm:grid-cols-4">
        <SummaryItem label={t('netSales')} value={money(pnl.sales)} />
        <SummaryItem label={t('cogs')} value={money(pnl.cogs)} />
        <SummaryItem label={t('grossProfit')} value={money(pnl.grossProfit)} />
        <SummaryItem label={t('expensesTotal')} value={money(pnl.expenses)} />
        <SummaryItem label={t('writeOffs')} value={money(pnl.writeOffs)} tone="negative" />
        <SummaryItem label={t('cashCollected')} value={money(pnl.paidAmount)} />
        <SummaryItem label={t('receivables')} value={money(data.customerDebts)} />
        <SummaryItem label={t('netProfit')} value={money(pnl.netProfit)} strong tone={pnl.netProfit >= 0 ? 'positive' : 'negative'} />
      </div>
      <p className="px-1 text-[10px] text-slate-400">
        {t('inventoryValue')}: {money(data.inventoryCostValue)} — {t('inventoryNotProfit')} · {t('debtCollection')}: {t('notRevenue')}
      </p>
    </div>
  );
}

function SummaryItem({
  label,
  value,
  strong,
  tone,
}: {
  label: string;
  value: string;
  strong?: boolean;
  tone?: 'positive' | 'negative';
}) {
  return (
    <div>
      <p className="text-[11px] font-semibold text-slate-400">{label}</p>
      <p
        className={`mt-0.5 font-mono ${strong ? 'text-base font-extrabold' : 'text-sm font-bold'} ${
          tone === 'positive' ? 'text-emerald-600' : tone === 'negative' ? 'text-rose-600' : 'text-slate-700 dark:text-slate-200'
        }`}
        dir="ltr"
        style={{ textAlign: 'start' }}
      >
        {value}
      </p>
    </div>
  );
}
