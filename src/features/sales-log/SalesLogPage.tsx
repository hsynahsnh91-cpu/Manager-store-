import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Archive,
  CalendarDays,
  Camera,
  ChevronLeft,
  Download,
  History,
  ListFilter,
  Pencil,
  Plus,
  Search,
  ShoppingBasket,
  Tag,
  Trash2,
  TrendingUp,
} from 'lucide-react';
import type { ManualSale } from '../../types';
import { useAsync } from '../../hooks/useAsync';
import { useApp } from '../../context/AppContext';
import { useI18n } from '../../i18n';
import { Button } from '../../components/Button';
import { Input, Select, Textarea } from '../../components/Form';
import { ConfirmDialog, Modal } from '../../components/Modal';
import { Badge, EmptyState, SkeletonRows, StatCard } from '../../components/UI';
import { formatDate, formatTime, fromDateInput, toDateInput } from '../../utils/dates';
import { formatMoney, mulMoney, round2 } from '../../utils/money';
import { downloadCSV } from '../../utils/csv';
import { uid } from '../../utils/id';
import { listProducts } from '../../services/products';
import { listCategories } from '../../services/categories';
import {
  createManualSale,
  deleteManualSale,
  dayKey,
  listManualSales,
  updateManualSale,
  ManualSaleError,
} from '../../services/manualSales';
import {
  buildArchiveTree,
  filterSalesLog,
  groupByDay,
  loadSalesLog,
  sumEntries,
  type SalesLogEntry,
  type SalesLogFilters,
  type SourceFilter,
} from '../../services/salesLog';
import { listAudit } from '../../services/audit';
import { CategoryPicker } from '../shared/CategoryPicker';

interface SaleForm {
  productName: string;
  productId: string;
  quantity: string;
  unitPrice: string;
  unitCost: string;
  buyerName: string;
  category: string;
  note: string;
  dateTime: string;
  stockApplied: boolean;
  createNew: boolean;
  initialStock: string;
  paymentMethod: 'cash' | 'bank' | 'credit';
  paid: string;
}

function toDateTimeInput(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromDateTimeInput(value: string): number {
  const ts = new Date(value).getTime();
  return Number.isFinite(ts) ? ts : Date.now();
}

const emptyForm = (): SaleForm => ({
  productName: '',
  productId: '',
  quantity: '1',
  unitPrice: '',
  unitCost: '',
  buyerName: '',
  category: '',
  note: '',
  dateTime: toDateTimeInput(Date.now()),
  stockApplied: false,
  createNew: false,
  initialStock: '0',
  paymentMethod: 'cash',
  paid: '',
});

const sourceTone: Record<string, 'blue' | 'green' | 'amber' | 'slate'> = {
  pos: 'blue',
  manual: 'green',
  scanned: 'amber',
};

export function SalesLogPage() {
  const { t, lang } = useI18n();
  const { settings, toast } = useApp();
  const { data: logData, loading, reload } = useAsync(() => loadSalesLog(), []);
  const { data: productData, reload: reloadProducts } = useAsync(() => listProducts(), []);
  const { data: categoryData, reload: reloadCategories } = useAsync(() => listCategories(), []);
  const { data: auditData, reload: reloadAudit } = useAsync(() => listAudit(30), []);
  const { data: manualData } = useAsync(() => listManualSales(), []);

  const entries = useMemo(() => logData ?? [], [logData]);
  const products = productData ?? [];
  const categories = categoryData ?? [];

  const [tab, setTab] = useState<'today' | 'archive'>('today');
  const [filters, setFilters] = useState<SalesLogFilters>({ q: '', source: 'all', sort: 'newest' });
  const [showFilters, setShowFilters] = useState(false);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [yearFilter, setYearFilter] = useState<string>('all');
  const [monthFilter, setMonthFilter] = useState<string>('all');
  const [showAudit, setShowAudit] = useState(false);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<ManualSale | null>(null);
  const [form, setForm] = useState<SaleForm>(emptyForm);
  const [clientToken, setClientToken] = useState(() => uid('msale'));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [categoryPicker, setCategoryPicker] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ManualSale | null>(null);
  const [detail, setDetail] = useState<SalesLogEntry | null>(null);
  const [deleting, setDeleting] = useState(false);

  const filtered = useMemo(() => filterSalesLog(entries, filters), [entries, filters]);
  const days = useMemo(() => groupByDay(filtered), [filtered]);
  const today = dayKey(Date.now());
  const todayEntries = useMemo(() => filtered.filter((e) => e.dayKey === today), [filtered, today]);
  const todaySummary = useMemo(() => sumEntries(todayEntries), [todayEntries]);
  const tree = useMemo(() => buildArchiveTree(days), [days]);

  const selectedEntries = useMemo(
    () => (selectedDay ? days.find((d) => d.key === selectedDay)?.entries ?? [] : []),
    [days, selectedDay],
  );

  const years = useMemo(() => [...new Set(tree.map((y) => y.year))], [tree]);
  const months = useMemo(() => {
    if (yearFilter === 'all') return [];
    return tree.find((y) => String(y.year) === yearFilter)?.months.map((m) => m.month) ?? [];
  }, [tree, yearFilter]);

  const searchActive = Boolean(
    filters.q ||
      filters.minPrice !== null ||
      filters.maxPrice !== null ||
      filters.from ||
      filters.to ||
      filters.category ||
      (filters.source && filters.source !== 'all'),
  );

  const matchedProduct = useMemo(() => {
    const name = form.productName.trim();
    if (!name) return null;
    if (form.productId) return products.find((p) => p.id === form.productId) ?? null;
    return products.find((p) => p.name.trim() === name) ?? null;
  }, [form.productName, form.productId, products]);

  const totalPreview = useMemo(() => {
    const q = Number(form.quantity);
    const p = Number(form.unitPrice);
    if (!Number.isFinite(q) || !Number.isFinite(p) || q <= 0 || p < 0) return 0;
    return mulMoney(q, p);
  }, [form.quantity, form.unitPrice]);

  const openAdd = () => {
    setEditing(null);
    const draft = emptyForm();
    if (matchedProduct) {
      draft.productId = matchedProduct.id;
      draft.unitPrice = String(matchedProduct.salePrice);
      draft.unitCost = String(matchedProduct.purchasePrice);
      draft.category = matchedProduct.category;
    }
    setForm(draft);
    setClientToken(uid('msale'));
    setErrors({});
    setFormOpen(true);
  };

  const openEdit = (sale: ManualSale) => {
    setEditing(sale);
    setForm({
      productName: sale.productName,
      productId: sale.productId ?? '',
      quantity: String(sale.quantity),
      unitPrice: String(sale.unitPrice),
      unitCost: sale.unitCost === null ? '' : String(sale.unitCost),
      buyerName: sale.buyerName,
      category: sale.category,
      note: sale.note,
      dateTime: toDateTimeInput(sale.date),
      stockApplied: sale.stockApplied,
      createNew: false,
      initialStock: '0',
      paymentMethod: sale.paymentMethod,
      paid: String(sale.paid),
    });
    setErrors({});
    setFormOpen(true);
  };

  const onNameChange = (value: string) => {
    const match = products.find((p) => p.name.trim() === value.trim());
    if (match) {
      setForm((f) => ({
        ...f,
        productName: value,
        productId: match.id,
        category: f.category || match.category,
        unitPrice: f.unitPrice && Number(f.unitPrice) > 0 ? f.unitPrice : String(match.salePrice),
        unitCost: f.unitCost ? f.unitCost : String(match.purchasePrice),
        stockApplied: match.quantity > 0 ? true : f.stockApplied,
      }));
    } else {
      setForm((f) => ({ ...f, productName: value, productId: '' }));
    }
  };

  const submit = async () => {
    const errs: Record<string, string> = {};
    const quantity = round2(Number(form.quantity));
    const unitPrice = round2(Number(form.unitPrice));
    const unitCost = form.unitCost.trim() === '' ? null : round2(Number(form.unitCost));
    const initialStock = round2(Number(form.initialStock || 0));
    if (!form.productName.trim()) errs.productName = t('required');
    if (!(quantity > 0)) errs.quantity = t('invalidNumber');
    if (!(unitPrice >= 0)) errs.unitPrice = t('invalidNumber');
    if (form.stockApplied && !form.productId && !form.createNew) errs.productName = t('stockNeedsProduct');
    if (form.stockApplied && form.createNew && initialStock < quantity) errs.initialStock = t('insufficientStock');
    if (!form.dateTime) errs.dateTime = t('required');
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;

    setSaving(true);
    try {
      const paid = form.paid.trim() === '' ? undefined : round2(Number(form.paid));
      const base = {
        productId: form.productId || null,
        productName: form.productName.trim(),
        quantity,
        unitPrice,
        unitCost,
        buyerName: form.buyerName.trim(),
        category: form.category.trim(),
        note: form.note.trim(),
        date: fromDateTimeInput(form.dateTime),
        stockApplied: form.stockApplied,
        paid,
        paymentMethod: form.paymentMethod,
      };
      if (editing) {
        await updateManualSale(editing.id, base, { allowNegativeStock: settings.allowNegativeStock });
        toast(t('saleUpdated'));
      } else {
        await createManualSale(
          {
            ...base,
            clientToken,
            source: 'manual',
            createProduct:
              !form.productId && form.createNew
                ? {
                    category: form.category.trim() || categories[0]?.name || 'منتجات أخرى',
                    initialQuantity: initialStock,
                    salePrice: unitPrice,
                  }
                : null,
          },
          { allowNegativeStock: settings.allowNegativeStock, prefix: settings.manualSalePrefix || 'MS' },
        );
        toast(t('saleSaved'));
      }
      setFormOpen(false);
      reload();
      reloadProducts();
      reloadCategories();
      reloadAudit();
    } catch (err) {
      const message =
        err instanceof ManualSaleError && err.code === 'INSUFFICIENT_STOCK'
          ? t('insufficientStock')
          : err instanceof ManualSaleError && err.code === 'PRODUCT_NOT_FOUND'
            ? t('stockNeedsProduct')
            : t('error');
      toast(message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteManualSale(deleteTarget.id);
      toast(t('saleDeleted'));
      setDeleteTarget(null);
      reload();
      reloadProducts();
      reloadAudit();
    } catch {
      toast(t('error'), 'error');
    } finally {
      setDeleting(false);
    }
  };

  const exportEntries = (rows: SalesLogEntry[], name: string) => {
    downloadCSV(
      name,
      [t('date'), t('time'), t('productName'), t('quantity'), t('price'), t('total'), t('buyer'), t('source'), t('invoiceNumber'), t('notes')],
      rows.map((e) => [
        formatDate(e.date, lang),
        formatTime(e.date, lang),
        e.productSummary,
        e.quantity,
        e.items[0]?.unitPrice ?? '',
        e.total,
        e.buyerName,
        t(e.source === 'manual' ? 'sourceManual' : e.source === 'scanned' ? 'sourceScanned' : 'sourcePos'),
        e.number,
        e.note,
      ]),
    );
  };

  const manualSalesById = useMemo(() => {
    const map = new Map<string, ManualSale>();
    for (const sale of manualData ?? []) map.set(sale.id, sale);
    return map;
  }, [manualData]);

  const entryRow = (entry: SalesLogEntry) => {
    const sale = entry.kind === 'manual' ? manualSalesById.get(entry.id) : undefined;
    return (
      <div
        key={entry.id}
        role="button"
        tabIndex={0}
        onClick={() => setDetail(entry)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') setDetail(entry);
        }}
        className="flex cursor-pointer items-start justify-between gap-3 border-b border-slate-100 px-4 py-3 last:border-0 hover:bg-slate-50/60 dark:border-slate-800 dark:hover:bg-slate-800/40"
      >
        <div className="min-w-0">
          <p className="truncate text-sm font-bold text-slate-800 dark:text-slate-100">{entry.productSummary}</p>
          <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[11px] text-slate-400">
            <span>{formatTime(entry.date, lang)}</span>
            <span>·</span>
            <span>{formatDate(entry.date, lang)}</span>
            {entry.buyerName && (
              <>
                <span>·</span>
                <span className="text-slate-500 dark:text-slate-400">{entry.buyerName}</span>
              </>
            )}
            <span>·</span>
            <span className="font-mono">{entry.number}</span>
            <Badge tone={sourceTone[entry.source]}>{t(entry.source === 'manual' ? 'sourceManual' : entry.source === 'scanned' ? 'sourceScanned' : 'sourcePos')}</Badge>
            {entry.status === 'cancelled' && <Badge tone="rose">{t('statusCancelled')}</Badge>}
          </div>
          {entry.note && <p className="mt-1 truncate text-[11px] text-slate-400">{entry.note}</p>}
        </div>
        <div className="flex shrink-0 items-start gap-2">
          <div className="text-end">
            <p className="font-mono text-sm font-bold text-slate-800 dark:text-slate-100">{formatMoney(entry.total, settings.currency)}</p>
            <p className="text-[11px] text-slate-400">
              {entry.quantity} × {formatMoney(entry.items[0]?.unitPrice ?? 0, settings.currency)}
            </p>
          </div>
          {sale && (
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  openEdit(sale);
                }}
                className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-brand-600 dark:hover:bg-slate-800"
                aria-label={t('edit')}
              >
                <Pencil size={14} />
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setDeleteTarget(sale);
                }}
                className="rounded-md p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-900/20"
                aria-label={t('delete')}
              >
                <Trash2 size={14} />
              </button>
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      {/* الرأس والإجراءات السريعة */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-extrabold text-slate-800 dark:text-white">{t('salesLogTitle')}</h1>
          <p className="mt-0.5 text-xs text-slate-400">{t('salesLogSubtitle')}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" icon={<Plus size={15} />} onClick={openAdd}>
            {t('recordSale')}
          </Button>
          <Link to="/scan">
            <Button size="sm" variant="secondary" icon={<Camera size={15} />}>
              {t('scanInvoice')}
            </Button>
          </Link>
          <Link to="/prices">
            <Button size="sm" variant="secondary" icon={<Tag size={15} />}>
              {t('priceSearch')}
            </Button>
          </Link>
          <Button
            size="sm"
            variant="ghost"
            icon={<Download size={15} />}
            onClick={() => exportEntries(filtered, `sales-log-${today}`)}
          >
            {t('exportCsv')}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard title={t('todaySales')} amount={todaySummary.sales} icon={<TrendingUp size={18} />} accent="emerald" />
        <StatCard title={t('salesCount')} value={String(todaySummary.count)} icon={<ShoppingBasket size={18} />} accent="brand" />
        <StatCard title={t('productsCount')} value={String(todaySummary.products)} icon={<Tag size={18} />} accent="violet" />
        <StatCard title={t('archiveDays')} value={String(tree.length)} icon={<Archive size={18} />} accent="amber" />
      </div>

      {/* البحث والفلاتر */}
      <div className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-wrap items-center gap-2">
          <div className="min-w-[220px] flex-1">
            <Input
              icon={<Search size={15} />}
              placeholder={t('searchAllRecords')}
              value={filters.q ?? ''}
              onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value }))}
              aria-label={t('search')}
            />
          </div>
          <Button
            size="md"
            variant="secondary"
            icon={<ListFilter size={15} />}
            onClick={() => setShowFilters((v) => !v)}
          >
            {t('filter')}
          </Button>
          <div className="flex rounded-lg border border-slate-200 p-0.5 dark:border-slate-700">
            <button
              type="button"
              onClick={() => setTab('today')}
              className={`rounded-md px-3 py-1.5 text-xs font-semibold ${tab === 'today' ? 'bg-brand-600 text-white' : 'text-slate-500 dark:text-slate-400'}`}
            >
              {t('todayLog')}
            </button>
            <button
              type="button"
              onClick={() => setTab('archive')}
              className={`rounded-md px-3 py-1.5 text-xs font-semibold ${tab === 'archive' ? 'bg-brand-600 text-white' : 'text-slate-500 dark:text-slate-400'}`}
            >
              {t('archive')}
            </button>
          </div>
        </div>

        {showFilters && (
          <div className="mt-3 grid grid-cols-2 gap-2 border-t border-slate-100 pt-3 dark:border-slate-800 md:grid-cols-4">
            <Input
              type="number"
              label={t('minPrice')}
              value={filters.minPrice ?? ''}
              onChange={(e) => setFilters((f) => ({ ...f, minPrice: e.target.value === '' ? null : Number(e.target.value) }))}
            />
            <Input
              type="number"
              label={t('maxPrice')}
              value={filters.maxPrice ?? ''}
              onChange={(e) => setFilters((f) => ({ ...f, maxPrice: e.target.value === '' ? null : Number(e.target.value) }))}
            />
            <Input
              type="date"
              label={t('fromDate')}
              value={filters.from ? toDateInput(filters.from) : ''}
              onChange={(e) => setFilters((f) => ({ ...f, from: e.target.value ? fromDateInput(e.target.value) : null }))}
            />
            <Input
              type="date"
              label={t('toDate')}
              value={filters.to ? toDateInput(filters.to) : ''}
              onChange={(e) => setFilters((f) => ({ ...f, to: e.target.value ? fromDateInput(e.target.value) : null }))}
            />
            <Select
              label={t('category')}
              value={filters.category ?? ''}
              onChange={(e) => setFilters((f) => ({ ...f, category: e.target.value }))}
            >
              <option value="">{t('all')}</option>
              {categories.map((c) => (
                <option key={c.id} value={c.name}>{c.name}</option>
              ))}
            </Select>
            <Select
              label={t('source')}
              value={filters.source ?? 'all'}
              onChange={(e) => setFilters((f) => ({ ...f, source: e.target.value as SourceFilter }))}
            >
              <option value="all">{t('allSources')}</option>
              <option value="manual">{t('sourceManual')}</option>
              <option value="pos">{t('sourcePos')}</option>
              <option value="scanned">{t('sourceScanned')}</option>
            </Select>
            <Select
              label={t('sort')}
              value={filters.sort ?? 'newest'}
              onChange={(e) => setFilters((f) => ({ ...f, sort: e.target.value as 'newest' | 'oldest' }))}
            >
              <option value="newest">{t('sortNewest')}</option>
              <option value="oldest">{t('sortOldest')}</option>
            </Select>
            <div className="flex items-end">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setFilters({ q: '', source: 'all', sort: 'newest' });
                  setYearFilter('all');
                  setMonthFilter('all');
                  setSelectedDay(null);
                }}
              >
                {t('clearFilters')}
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* المحتوى */}
      <div className="rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        {loading ? (
          <div className="p-4"><SkeletonRows rows={6} cols={3} /></div>
        ) : tab === 'today' ? (
          <>
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5 dark:border-slate-800">
              <p className="text-xs font-bold text-slate-600 dark:text-slate-300">
                {t('todayLog')} · {formatDate(Date.now(), lang)}
              </p>
              <p className="text-[11px] text-slate-400">
                {t('dayTotal')}: <span className="font-mono font-bold text-slate-600 dark:text-slate-300">{formatMoney(todaySummary.sales, settings.currency)}</span>
              </p>
            </div>
            {todayEntries.length === 0 ? (
              <EmptyState icon={<ShoppingBasket size={26} />} title={t('todayEmpty')} hint={t('todayEmptyHint')} />
            ) : (
              <div>{todayEntries.map(entryRow)}</div>
            )}
          </>
        ) : selectedDay ? (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-2.5 dark:border-slate-800">
              <button
                type="button"
                onClick={() => setSelectedDay(null)}
                className="flex items-center gap-1 text-xs font-semibold text-brand-600 hover:underline dark:text-brand-400"
              >
                <ChevronLeft size={14} className="rtl:rotate-180" />
                {t('backToArchive')}
              </button>
              <p className="text-[11px] text-slate-400">
                {formatDate(fromDateInput(selectedDay), lang)} · {t('dayTotal')}:{' '}
                <span className="font-mono font-bold text-slate-600 dark:text-slate-300">
                  {formatMoney(days.find((d) => d.key === selectedDay)?.sales ?? 0, settings.currency)}
                </span>
              </p>
              <Button
                size="sm"
                variant="ghost"
                icon={<Download size={14} />}
                onClick={() => exportEntries(selectedEntries, `sales-${selectedDay}`)}
              >
                {t('exportDay')}
              </Button>
            </div>
            {selectedEntries.length === 0 ? (
              <EmptyState icon={<CalendarDays size={26} />} title={t('noResults')} hint={t('archiveEmptyHint')} />
            ) : (
              <div>{selectedEntries.map(entryRow)}</div>
            )}
          </>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-2.5 dark:border-slate-800">
              <p className="text-xs font-bold text-slate-600 dark:text-slate-300">{t('archive')}</p>
              <div className="flex gap-2">
                <Select value={yearFilter} onChange={(e) => { setYearFilter(e.target.value); setMonthFilter('all'); }} className="h-8 w-28 text-xs">
                  <option value="all">{t('allYears')}</option>
                  {years.map((y) => <option key={y} value={y}>{y}</option>)}
                </Select>
                <Select
                  value={monthFilter}
                  onChange={(e) => setMonthFilter(e.target.value)}
                  className="h-8 w-28 text-xs"
                  disabled={yearFilter === 'all'}
                >
                  <option value="all">{t('allMonths')}</option>
                  {months.map((m) => (
                    <option key={m} value={m}>{new Date(2000, m - 1, 1).toLocaleDateString(lang === 'ar' ? 'ar-EG' : 'en-GB', { month: 'long' })}</option>
                  ))}
                </Select>
              </div>
            </div>
            {tree.length === 0 ? (
              <EmptyState icon={<Archive size={26} />} title={t('archiveEmpty')} hint={t('archiveEmptyHint')} />
            ) : (
              <div className="divide-y divide-slate-100 dark:divide-slate-800">
                {tree
                  .filter((y) => yearFilter === 'all' || String(y.year) === yearFilter)
                  .map((y) => (
                    <div key={y.year} className="px-4 py-3">
                      <p className="mb-2 flex items-center gap-2 text-xs font-bold text-slate-500 dark:text-slate-400">
                        <CalendarDays size={14} /> {y.year}
                        <span className="font-normal text-slate-400">
                          · {y.count} {t('processCount')} · {formatMoney(y.sales, settings.currency)}
                        </span>
                      </p>
                      <div className="space-y-3">
                        {y.months
                          .filter((m) => monthFilter === 'all' || String(m.month) === monthFilter)
                          .map((m) => (
                            <div key={m.month}>
                              <p className="mb-1.5 text-[11px] font-semibold text-slate-400">
                                {new Date(y.year, m.month - 1, 1).toLocaleDateString(lang === 'ar' ? 'ar-EG' : 'en-GB', { month: 'long' })}
                              </p>
                              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                                {m.days.map((day) => (
                                  <button
                                    key={day.key}
                                    type="button"
                                    onClick={() => setSelectedDay(day.key)}
                                    className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2 text-start transition-colors hover:border-brand-300 hover:bg-brand-50/50 dark:border-slate-700 dark:hover:border-brand-700 dark:hover:bg-brand-900/10"
                                  >
                                    <div>
                                      <p className="text-xs font-bold text-slate-700 dark:text-slate-200">
                                        {formatDate(day.start, lang)}
                                        {day.key === today && <span className="ms-1 text-[10px] font-medium text-brand-600">({t('today')})</span>}
                                      </p>
                                      <p className="mt-0.5 text-[10px] text-slate-400">
                                        {day.count} {t('processCount')} · {day.quantity} {t('quantity')}
                                      </p>
                                    </div>
                                    <p className="font-mono text-xs font-bold text-slate-700 dark:text-slate-200">{formatMoney(day.sales, settings.currency)}</p>
                                  </button>
                                ))}
                              </div>
                            </div>
                          ))}
                      </div>
                    </div>
                  ))}
              </div>
            )}
          </>
        )}
      </div>

      {searchActive && (
        <p className="text-[11px] text-slate-400">
          {t('resultsCount')}: {filtered.length}
        </p>
      )}

      {/* سجل المراجعة */}
      <div className="rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <button
          type="button"
          onClick={() => setShowAudit((v) => !v)}
          className="flex w-full items-center justify-between px-4 py-3 text-xs font-bold text-slate-600 dark:text-slate-300"
        >
          <span className="flex items-center gap-2"><History size={15} /> {t('auditLog')}</span>
          <span className="text-slate-400">{showAudit ? t('hide') : t('show')}</span>
        </button>
        {showAudit && (
          <div className="max-h-64 overflow-y-auto border-t border-slate-100 px-4 py-2 dark:border-slate-800">
            {(auditData ?? []).length === 0 ? (
              <p className="py-4 text-center text-[11px] text-slate-400">{t('noData')}</p>
            ) : (
              (auditData ?? []).map((a) => (
                <div key={a.id} className="border-b border-slate-100 py-2 text-[11px] last:border-0 dark:border-slate-800">
                  <p className="font-semibold text-slate-600 dark:text-slate-300">{a.summary}</p>
                  <p className="mt-0.5 text-slate-400">{formatDate(a.at, lang)} · {formatTime(a.at, lang)}</p>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {/* تفاصيل السجل */}
      <Modal
        open={Boolean(detail)}
        onClose={() => setDetail(null)}
        title={t('invoiceDetails')}
        size="lg"
        footer={<Button variant="secondary" onClick={() => setDetail(null)}>{t('close')}</Button>}
      >
        {detail && (
          <div className="space-y-3 text-xs">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              <div>
                <p className="text-[10px] text-slate-400">{t('invoiceNumber')}</p>
                <p className="font-mono font-bold text-slate-700 dark:text-slate-200">{detail.number}</p>
              </div>
              <div>
                <p className="text-[10px] text-slate-400">{t('date')}</p>
                <p className="font-bold text-slate-700 dark:text-slate-200">{formatDate(detail.date, lang)} · {formatTime(detail.date, lang)}</p>
              </div>
              <div>
                <p className="text-[10px] text-slate-400">{t('source')}</p>
                <p className="font-bold text-slate-700 dark:text-slate-200">
                  {t(detail.source === 'manual' ? 'sourceManual' : detail.source === 'scanned' ? 'sourceScanned' : 'sourcePos')}
                </p>
              </div>
              <div>
                <p className="text-[10px] text-slate-400">{t('buyer')}</p>
                <p className="font-bold text-slate-700 dark:text-slate-200">{detail.buyerName || '—'}</p>
              </div>
              <div>
                <p className="text-[10px] text-slate-400">{t('category')}</p>
                <p className="font-bold text-slate-700 dark:text-slate-200">{detail.category || '—'}</p>
              </div>
              <div>
                <p className="text-[10px] text-slate-400">{t('totalLabel')} / {t('paid')}</p>
                <p className="font-mono font-bold text-slate-700 dark:text-slate-200">
                  {formatMoney(detail.total, settings.currency)}
                  {detail.kind === 'manual' && manualSalesById.get(detail.id) ? ` / ${formatMoney(manualSalesById.get(detail.id)!.paid, settings.currency)}` : ''}
                </p>
              </div>
            </div>

            <div className="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700">
              <table className="w-full text-xs">
                <thead className="bg-slate-50 text-[10px] text-slate-400 dark:bg-slate-800/60">
                  <tr>
                    <th className="px-2 py-1.5 text-start">{t('itemName')}</th>
                    <th className="px-2 py-1.5 text-start">{t('quantity')}</th>
                    <th className="px-2 py-1.5 text-start">{t('unitPrice')}</th>
                    <th className="px-2 py-1.5 text-start">{t('lineTotal')}</th>
                    <th className="px-2 py-1.5 text-start">{t('unitCost')}</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.items.map((item, i) => (
                    <tr key={`${detail.id}-${i}`} className="border-t border-slate-100 dark:border-slate-800">
                      <td className="px-2 py-1.5">{item.name}</td>
                      <td className="px-2 py-1.5 font-mono">{item.quantity}</td>
                      <td className="px-2 py-1.5 font-mono">{formatMoney(item.unitPrice, settings.currency)}</td>
                      <td className="px-2 py-1.5 font-mono">{formatMoney(item.total, settings.currency)}</td>
                      <td className="px-2 py-1.5 font-mono text-slate-400">{item.unitCost === null ? '—' : formatMoney(item.unitCost, settings.currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex flex-wrap gap-4 text-[11px] text-slate-500 dark:text-slate-400">
              <span>{t('cogs')}: <span className="font-mono font-bold">{formatMoney(detail.cogs, settings.currency)}</span></span>
              <span>{t('grossProfit')}: <span className={`font-mono font-bold ${detail.profit >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{formatMoney(detail.profit, settings.currency)}</span></span>
              {detail.note && <span>{t('notes')}: {detail.note}</span>}
            </div>
          </div>
        )}
      </Modal>

      {/* نموذج تسجيل/تعديل بيع */}
      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editing ? t('editSale') : t('recordSale')}
        size="lg"
        footer={
          <>
            <Button variant="secondary" onClick={() => setFormOpen(false)}>{t('cancel')}</Button>
            <Button onClick={() => void submit()} loading={saving}>{t('save')}</Button>
          </>
        }
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Input
              label={t('productName')}
              required
              value={form.productName}
              onChange={(e) => onNameChange(e.target.value)}
              aria-label={t('productName')}
              list="sales-product-list"
              placeholder={t('productNameHint')}
              error={errors.productName}
              autoFocus
            />
            <datalist id="sales-product-list">
              {products.map((p) => (
                <option key={p.id} value={p.name} />
              ))}
            </datalist>
            {matchedProduct && (
              <p className="mt-1 text-[11px] text-slate-400">
                {t('inStock')}: <span className="font-bold">{matchedProduct.quantity}</span> · {t('wholesalePrice')}: {formatMoney(matchedProduct.purchasePrice, settings.currency)}
              </p>
            )}
          </div>

          <Input
            type="number"
            step="any"
            label={t('quantity')}
            required
            value={form.quantity}
            onChange={(e) => setForm((f) => ({ ...f, quantity: e.target.value }))}
            aria-label={t('quantity')}
            error={errors.quantity}
          />
          <Input
            type="number"
            step="0.01"
            label={t('unitSalePrice')}
            required
            value={form.unitPrice}
            onChange={(e) => setForm((f) => ({ ...f, unitPrice: e.target.value }))}
            aria-label={t('unitSalePrice')}
            error={errors.unitPrice}
          />
          <div className="flex flex-col justify-end rounded-lg bg-slate-50 px-3 py-2 dark:bg-slate-800/60">
            <span className="text-[11px] text-slate-400">{t('totalAuto')}</span>
            <span className="font-mono text-lg font-bold text-slate-800 dark:text-slate-100">{formatMoney(totalPreview, settings.currency)}</span>
          </div>
          <Input
            type="number"
            step="0.01"
            label={t('unitCost')}
            value={form.unitCost}
            onChange={(e) => setForm((f) => ({ ...f, unitCost: e.target.value }))}
            hint={t('unitCostHint')}
          />
          <Input
            label={t('buyer')}
            value={form.buyerName}
            onChange={(e) => setForm((f) => ({ ...f, buyerName: e.target.value }))}
            aria-label={t('buyer')}
            placeholder={t('optional')}
          />
          <div>
            <span className="mb-1.5 block text-xs font-semibold text-slate-600 dark:text-slate-300">{t('category')}</span>
            <div className="flex gap-2">
              <Select value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}>
                <option value="">—</option>
                {categories.map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}
              </Select>
              <Button type="button" variant="secondary" size="sm" onClick={() => setCategoryPicker(true)} aria-label={t('newCategory')}>
                <Plus size={14} />
              </Button>
            </div>
          </div>
          <Input
            type="datetime-local"
            label={t('saleDateTime')}
            value={form.dateTime}
            onChange={(e) => setForm((f) => ({ ...f, dateTime: e.target.value }))}
            error={errors.dateTime}
          />
          <Select
            label={t('paymentMethod')}
            value={form.paymentMethod}
            onChange={(e) => setForm((f) => ({ ...f, paymentMethod: e.target.value as SaleForm['paymentMethod'] }))}
          >
            <option value="cash">{t('cash')}</option>
            <option value="bank">{t('bank')}</option>
            <option value="credit">{t('credit')}</option>
          </Select>
          <Input
            type="number"
            step="0.01"
            label={t('paid')}
            value={form.paid}
            onChange={(e) => setForm((f) => ({ ...f, paid: e.target.value }))}
            hint={t('paidHint')}
          />
          <div className="sm:col-span-2">
            <Textarea
              label={t('notes')}
              value={form.note}
              onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
              rows={2}
            />
          </div>

          <label className="flex items-start gap-2 rounded-lg border border-slate-200 p-3 sm:col-span-2 dark:border-slate-700">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 rounded border-slate-300 text-brand-600"
              checked={form.stockApplied}
              onChange={(e) => setForm((f) => ({ ...f, stockApplied: e.target.checked }))}
              aria-label={t('stockDeduct')}
              disabled={!form.productId && !form.createNew}
            />
            <span className="text-xs">
              <span className="block font-semibold text-slate-700 dark:text-slate-200">{t('stockDeduct')}</span>
              <span className="block text-slate-400">{t('stockDeductHint')}</span>
            </span>
          </label>

          {!form.productId && !editing && (
            <div className="space-y-2 rounded-lg border border-dashed border-slate-300 p-3 sm:col-span-2 dark:border-slate-600">
              <label className="flex items-center gap-2 text-xs font-semibold text-slate-700 dark:text-slate-200">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-slate-300 text-brand-600"
                  checked={form.createNew}
                  onChange={(e) => setForm((f) => ({ ...f, createNew: e.target.checked }))}
                  aria-label={t('createAsNewProduct')}
                />
                {t('createAsNewProduct')}
              </label>
              {form.createNew && (
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <Input
                    type="number"
                    step="any"
                    label={t('initialStock')}
                    value={form.initialStock}
                    onChange={(e) => setForm((f) => ({ ...f, initialStock: e.target.value }))}
                    error={errors.initialStock}
                  />
                  <div>
                    <span className="mb-1.5 block text-xs font-semibold text-slate-600 dark:text-slate-300">{t('category')}</span>
                    <Select value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}>
                      <option value="">{t('chooseCategory')}</option>
                      {categories.map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}
                    </Select>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </Modal>

      <CategoryPicker
        open={categoryPicker}
        categories={categories}
        value={form.category}
        onClose={() => setCategoryPicker(false)}
        onSelect={(name) => setForm((f) => ({ ...f, category: name }))}
        onCreated={reloadCategories}
      />

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title={t('deleteSale')}
        message={t('deleteSaleMsg')}
        confirmLabel={t('delete')}
        danger
        loading={deleting}
        onConfirm={() => void confirmDelete()}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
