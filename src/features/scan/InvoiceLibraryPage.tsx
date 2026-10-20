import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  Camera,
  CheckCircle2,
  Download,
  FileText,
  Image as ImageIcon,
  Minus,
  Search,
  Trash2,
} from 'lucide-react';
import type { ScannedInvoice } from '../../types';
import { useAsync } from '../../hooks/useAsync';
import { useApp } from '../../context/AppContext';
import { useI18n } from '../../i18n';
import { Button } from '../../components/Button';
import { Input, Select } from '../../components/Form';
import { ConfirmDialog, Modal } from '../../components/Modal';
import { Badge, EmptyState, SkeletonRows } from '../../components/UI';
import { formatDate, fromDateInput } from '../../utils/dates';
import { formatMoney } from '../../utils/money';
import { downloadCSV } from '../../utils/csv';
import {
  deleteScannedInvoice,
  filterInvoiceLibrary,
  getInvoiceImage,
  listScannedInvoices,
} from '../../services/scannedInvoices';
import { listProducts } from '../../services/products';

function useImageUrl(imageId: string | null): { url: string; loading: boolean; error: boolean } {
  const [state, setState] = useState<{ url: string; loading: boolean; error: boolean }>({
    url: '',
    loading: Boolean(imageId),
    error: false,
  });
  useEffect(() => {
    let alive = true;
    let created = '';
    if (!imageId) {
      setState({ url: '', loading: false, error: false });
      return;
    }
    setState({ url: '', loading: true, error: false });
    getInvoiceImage(imageId)
      .then((img) => {
        if (!alive) return;
        if (!img) {
          setState({ url: '', loading: false, error: true });
          return;
        }
        created = URL.createObjectURL(img.blob);
        setState({ url: created, loading: false, error: false });
      })
      .catch(() => {
        if (alive) setState({ url: '', loading: false, error: true });
      });
    return () => {
      alive = false;
      if (created) URL.revokeObjectURL(created);
    };
  }, [imageId]);
  return state;
}

export function InvoiceLibraryPage() {
  const { t, lang } = useI18n();
  const { settings, toast } = useApp();
  const { data, loading, reload } = useAsync(() => listScannedInvoices(), []);
  const { data: productData } = useAsync(() => listProducts(), []);
  const invoices = useMemo(() => data ?? [], [data]);
  const products = productData ?? [];

  const [q, setQ] = useState('');
  const [supplier, setSupplier] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [minTotal, setMinTotal] = useState('');
  const [maxTotal, setMaxTotal] = useState('');
  const [selected, setSelected] = useState<ScannedInvoice | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ScannedInvoice | null>(null);
  const [deleting, setDeleting] = useState(false);

  const suppliers = useMemo(
    () => [...new Set(invoices.map((i) => i.supplierName).filter(Boolean))].sort(),
    [invoices],
  );

  const filtered = useMemo(
    () =>
      filterInvoiceLibrary(invoices, {
        q,
        supplier,
        from: from ? fromDateInput(from) : null,
        to: to ? fromDateInput(to) : null,
        minTotal: minTotal === '' ? null : Number(minTotal),
        maxTotal: maxTotal === '' ? null : Number(maxTotal),
      }),
    [invoices, q, supplier, from, to, minTotal, maxTotal],
  );

  const totalValue = useMemo(() => filtered.reduce((a, i) => a + i.total, 0), [filtered]);
  const image = useImageUrl(selected?.imageId ?? null);

  const exportLibrary = () => {
    const stamp = new Date().toISOString().slice(0, 10);
    downloadCSV(
      `invoice-library-${stamp}`,
      [t('invoiceNumber'), t('supplier'), t('invoiceDateCol'), t('scanDate'), t('itemsCol'), t('totalLabel'), t('fieldConfidence')],
      filtered.map((inv) => [
        inv.invoiceNumber,
        inv.supplierName,
        formatDate(inv.invoiceDate, lang),
        formatDate(inv.scanDate, lang),
        inv.items.filter((i) => i.matchState !== 'ignored').length,
        inv.total,
        `${Math.round(inv.ocrConfidence)}%`,
      ]),
    );
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteScannedInvoice(deleteTarget.id);
      toast(t('success'));
      setDeleteTarget(null);
      setSelected(null);
      reload();
    } catch {
      toast(t('error'), 'error');
    } finally {
      setDeleting(false);
    }
  };

  const productName = (id: string | null, fallback: string): string => {
    const p = products.find((x) => x.id === id);
    return p?.name ?? fallback;
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-extrabold text-slate-800 dark:text-white">{t('libraryTitle')}</h1>
          <p className="mt-0.5 text-xs text-slate-400">{t('librarySubtitle')}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="ghost" icon={<Download size={15} />} onClick={exportLibrary}>
            {t('exportCsv')}
          </Button>
          <Link to="/scan">
            <Button size="sm" icon={<Camera size={15} />}>{t('scanInvoice')}</Button>
          </Link>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-6">
          <div className="lg:col-span-2">
            <Input
              icon={<Search size={15} />}
              placeholder={t('searchInvoices')}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              aria-label={t('search')}
            />
          </div>
          <Select value={supplier} onChange={(e) => setSupplier(e.target.value)}>
            <option value="">{t('all')}</option>
            {suppliers.map((s) => <option key={s} value={s}>{s}</option>)}
          </Select>
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label={t('fromDate')} />
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label={t('toDate')} />
          <div className="flex gap-2">
            <Input type="number" placeholder={t('minPrice')} value={minTotal} onChange={(e) => setMinTotal(e.target.value)} />
            <Input type="number" placeholder={t('maxPrice')} value={maxTotal} onChange={(e) => setMaxTotal(e.target.value)} />
          </div>
        </div>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-400">
          <span>
            {t('resultsCount')}: {filtered.length} · {t('totalLabel')}: <span className="font-mono font-bold">{formatMoney(totalValue, settings.currency)}</span>
          </span>
          {(q || supplier || from || to || minTotal || maxTotal) && (
            <button
              type="button"
              className="font-semibold text-brand-600 hover:underline dark:text-brand-400"
              onClick={() => { setQ(''); setSupplier(''); setFrom(''); setTo(''); setMinTotal(''); setMaxTotal(''); }}
            >
              {t('clearFilters')}
            </button>
          )}
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        {loading ? (
          <div className="p-4"><SkeletonRows rows={5} cols={6} /></div>
        ) : filtered.length === 0 ? (
          <EmptyState icon={<FileText size={26} />} title={invoices.length === 0 ? t('noInvoices') : t('noResults')} hint={invoices.length === 0 ? t('noInvoicesHint') : t('noInvoicesHint')} />
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {filtered.map((inv) => {
              const updated = inv.priceUpdates.filter((p) => p.action === 'updated').length;
              return (
                <button
                  key={inv.id}
                  type="button"
                  onClick={() => setSelected(inv)}
                  className="flex w-full items-start justify-between gap-3 px-4 py-3 text-start transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/50"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold text-slate-800 dark:text-slate-100">
                      {inv.supplierName || t('unknownSupplier')}
                      {inv.invoiceNumber && <span className="ms-2 font-mono text-[11px] text-slate-400">#{inv.invoiceNumber}</span>}
                    </p>
                    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-slate-400">
                      <span>{t('invoiceDateCol')}: {formatDate(inv.invoiceDate, lang)}</span>
                      <span>·</span>
                      <span>{inv.items.filter((i) => i.matchState !== 'ignored').length} {t('itemsCount')}</span>
                      <span>·</span>
                      <span>{t('scanDate')}: {formatDate(inv.scanDate, lang)}</span>
                      {updated > 0 && <Badge tone="amber">{updated} {t('pricesUpdated')}</Badge>}
                      {inv.duplicateOf && <Badge tone="rose">{t('duplicateInvoice')}</Badge>}
                    </div>
                  </div>
                  <div className="shrink-0 text-end">
                    <p className="font-mono text-sm font-bold text-slate-800 dark:text-slate-100">{formatMoney(inv.total, settings.currency)}</p>
                    <p className="text-[10px] text-slate-400">{formatMoney(inv.subtotal, settings.currency)} + {t('taxLabel')}</p>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      <Modal
        open={Boolean(selected)}
        onClose={() => setSelected(null)}
        title={t('invoiceDetails')}
        size="xl"
        footer={
          selected ? (
            <>
              <Button variant="danger" size="sm" icon={<Trash2 size={14} />} onClick={() => setDeleteTarget(selected)}>
                {t('deleteInvoice')}
              </Button>
              <Button variant="secondary" onClick={() => setSelected(null)}>{t('close')}</Button>
            </>
          ) : null
        }
      >
        {selected && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
              <div>
                <p className="text-[10px] text-slate-400">{t('supplier')}</p>
                <p className="font-bold text-slate-700 dark:text-slate-200">{selected.supplierName || t('unknownSupplier')}</p>
              </div>
              <div>
                <p className="text-[10px] text-slate-400">{t('invoiceNumber')}</p>
                <p className="font-mono font-bold text-slate-700 dark:text-slate-200">{selected.invoiceNumber || '—'}</p>
              </div>
              <div>
                <p className="text-[10px] text-slate-400">{t('invoiceDateCol')}</p>
                <p className="font-bold text-slate-700 dark:text-slate-200">{formatDate(selected.invoiceDate, lang)}</p>
              </div>
              <div>
                <p className="text-[10px] text-slate-400">{t('scanDate')}</p>
                <p className="font-bold text-slate-700 dark:text-slate-200">{formatDate(selected.scanDate, lang)}</p>
              </div>
              <div>
                <p className="text-[10px] text-slate-400">{t('ocrConfidenceLabel')}</p>
                <p className="font-bold text-slate-700 dark:text-slate-200">{selected.ocrConfidence}%</p>
              </div>
              <div>
                <p className="text-[10px] text-slate-400">{t('engine')}</p>
                <p className="text-[10px] text-slate-500 dark:text-slate-400">{selected.engine}</p>
              </div>
              <div>
                <p className="text-[10px] text-slate-400">{t('totalLabel')}</p>
                <p className="font-mono font-bold text-slate-700 dark:text-slate-200">{formatMoney(selected.total, settings.currency)}</p>
              </div>
              <div>
                <p className="text-[10px] text-slate-400">{t('discountLabel')} / {t('taxLabel')}</p>
                <p className="font-mono text-slate-600 dark:text-slate-300">
                  {formatMoney(selected.discount, settings.currency)} / {formatMoney(selected.tax, settings.currency)}
                </p>
              </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <div>
                <p className="mb-1.5 text-xs font-bold text-slate-700 dark:text-slate-200">{t('originalImage')}</p>
                <div className="overflow-hidden rounded-lg border border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800">
                  {image.loading ? (
                    <div className="flex h-48 items-center justify-center"><SkeletonRows rows={2} cols={2} /></div>
                  ) : image.url ? (
                    <img src={image.url} alt={selected.imageName} className="max-h-80 w-full object-contain" />
                  ) : (
                    <div className="flex h-40 flex-col items-center justify-center gap-1 text-slate-400">
                      <ImageIcon size={22} />
                      <span className="text-[11px]">{t('imageUnavailable')}</span>
                    </div>
                  )}
                </div>
                <p className="mt-1 truncate text-[10px] text-slate-400">{selected.imageName}</p>
              </div>

              <div>
                <p className="mb-1.5 text-xs font-bold text-slate-700 dark:text-slate-200">{t('extractedText')}</p>
                <pre className="max-h-52 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-900 p-3 text-[10px] leading-relaxed text-slate-200" dir="auto">
                  {selected.rawText || '—'}
                </pre>
                <div className="mt-2">
                  <p className="text-xs font-bold text-slate-700 dark:text-slate-200">{t('corrections')}</p>
                  {selected.edits.length === 0 ? (
                    <p className="mt-0.5 text-[11px] text-slate-400">{t('noCorrections')}</p>
                  ) : (
                    <ul className="mt-1 space-y-1 text-[11px]">
                      {selected.edits.map((edit, i) => (
                        <li key={i} className="rounded border border-slate-100 px-2 py-1 text-slate-500 dark:border-slate-700 dark:text-slate-400">
                          <span className="font-semibold">{edit.field}</span>: <span className="line-through">{edit.from || '—'}</span> → <span className="text-emerald-600 dark:text-emerald-400">{edit.to || '—'}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </div>

            <div>
              <p className="mb-1.5 text-xs font-bold text-slate-700 dark:text-slate-200">{t('reviewItems')}</p>
              <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
                <table className="w-full min-w-[520px] text-xs">
                  <thead className="bg-slate-50 text-[10px] text-slate-400 dark:bg-slate-800/60">
                    <tr>
                      <th className="px-2 py-1.5 text-start">{t('itemName')}</th>
                      <th className="px-2 py-1.5 text-start">{t('quantity')}</th>
                      <th className="px-2 py-1.5 text-start">{t('unitPrice')}</th>
                      <th className="px-2 py-1.5 text-start">{t('lineTotal')}</th>
                      <th className="px-2 py-1.5 text-start">{t('linkProduct')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selected.items.map((item) => (
                      <tr key={item.id} className={`border-t border-slate-100 dark:border-slate-800 ${item.matchState === 'ignored' ? 'opacity-40' : ''}`}>
                        <td className="px-2 py-1.5">
                          {item.name}
                          {item.needsReview && <span className="ms-1 text-[10px] text-amber-600">({t('needsReview')})</span>}
                        </td>
                        <td className="px-2 py-1.5 font-mono">{item.quantity}</td>
                        <td className="px-2 py-1.5 font-mono">{formatMoney(item.unitPrice, settings.currency)}</td>
                        <td className="px-2 py-1.5 font-mono">{formatMoney(item.lineTotal, settings.currency)}</td>
                        <td className="px-2 py-1.5">
                          {item.productId ? (
                            <span className="text-emerald-600 dark:text-emerald-400">{productName(item.productId, item.name)}</span>
                          ) : item.matchState === 'new' ? (
                            <Badge tone="amber">{t('createAsNew')}</Badge>
                          ) : (
                            <span className="text-slate-400">{t('notLinked')}</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div>
              <p className="mb-1.5 text-xs font-bold text-slate-700 dark:text-slate-200">{t('archivedPrices')}</p>
              {selected.priceUpdates.length === 0 ? (
                <p className="text-[11px] text-slate-400">{t('noPriceChanges')}</p>
              ) : (
                <div className="space-y-1">
                  {selected.priceUpdates.map((p) => (
                    <div key={p.productId} className="flex flex-wrap items-center justify-between gap-2 rounded border border-slate-100 px-2 py-1 text-[11px] dark:border-slate-700">
                      <span className="font-semibold text-slate-600 dark:text-slate-300">{p.productName}</span>
                      <span className="flex items-center gap-2">
                        {p.action === 'updated' ? (
                          <>
                            {p.newPrice > p.oldPrice ? (
                              <ArrowUpRight size={13} className="text-rose-600" />
                            ) : (
                              <ArrowDownRight size={13} className="text-emerald-600" />
                            )}
                            <span className="font-mono text-slate-400">{formatMoney(p.oldPrice, settings.currency)} → {formatMoney(p.newPrice, settings.currency)}</span>
                          </>
                        ) : p.action === 'unchanged' ? (
                          <span className="flex items-center gap-1 text-slate-400"><Minus size={12} /> {t('pricesUnchanged')}</span>
                        ) : (
                          <span className="flex items-center gap-1 text-slate-400"><AlertTriangle size={12} /> {t('notLinked')}</span>
                        )}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {selected.notes && (
              <p className="rounded bg-amber-50 px-2 py-1.5 text-[11px] text-amber-700 dark:bg-amber-900/20 dark:text-amber-300">
                {selected.notes}
              </p>
            )}

            <p className="flex items-center gap-1 text-[10px] text-slate-400">
              <CheckCircle2 size={12} /> {t('scanDate')}: {new Date(selected.createdAt).toLocaleString(lang === 'ar' ? 'ar-EG' : 'en-GB')}
            </p>
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title={t('deleteInvoice')}
        message={t('confirmDeleteInvoice')}
        confirmLabel={t('delete')}
        danger
        loading={deleting}
        onConfirm={() => void confirmDelete()}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
