import { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Eye, Printer, Receipt, Search, XCircle } from 'lucide-react';
import type { Invoice } from '../../types';
import { cancelInvoice, listInvoices } from '../../services/sales';
import { useAsync } from '../../hooks/useAsync';
import { useApp } from '../../context/AppContext';
import { useI18n } from '../../i18n';
import { Button } from '../../components/Button';
import { Input, Select, Textarea } from '../../components/Form';
import { Modal } from '../../components/Modal';
import { Badge, EmptyState, SkeletonRows } from '../../components/UI';
import { InvoicePrintView } from './InvoicePrintView';
import { formatDate } from '../../utils/dates';
import { formatMoney } from '../../utils/money';

function statusBadge(inv: Invoice, t: (k: Parameters<ReturnType<typeof useI18n>['t']>[0]) => string) {
  switch (inv.status) {
    case 'paid':
      return <Badge tone="green">{t('statusPaid')}</Badge>;
    case 'partial':
      return <Badge tone="amber">{t('statusPartial')}</Badge>;
    case 'unpaid':
      return <Badge tone="blue">{t('statusUnpaid')}</Badge>;
    case 'cancelled':
      return <Badge tone="rose">{t('statusCancelled')}</Badge>;
  }
}

export function InvoicesPage() {
  const { t, lang } = useI18n();
  const { settings, toast } = useApp();
  const location = useLocation();
  const { data, loading, reload } = useAsync(() => listInvoices(), []);

  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<'all' | Invoice['status']>('all');
  const [selected, setSelected] = useState<Invoice | null>(null);
  const [cancelTarget, setCancelTarget] = useState<Invoice | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [printMode, setPrintMode] = useState(false);

  const invoices = data ?? [];

  // فتح تفاصيل فاتورة بعد تنفيذ بيع من نقطة البيع
  const targetId = (location.state as { openInvoice?: string } | null)?.openInvoice;
  useEffect(() => {
    if (!targetId || !data) return;
    const found = data.find((i) => i.id === targetId);
    if (found) setSelected(found);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetId, data]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return invoices.filter((inv) => {
      if (status !== 'all' && inv.status !== status) return false;
      if (q && !`${inv.number} ${inv.customerName}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [invoices, search, status]);

  const summary = useMemo(() => {
    const active = filtered.filter((i) => i.status !== 'cancelled');
    return {
      count: filtered.length,
      total: active.reduce((a, i) => a + i.total, 0),
      paid: active.reduce((a, i) => a + i.paid, 0),
      remaining: active.reduce((a, i) => a + i.remaining, 0),
    };
  }, [filtered]);

  const doCancel = async () => {
    if (!cancelTarget) return;
    setBusy(true);
    try {
      const updated = await cancelInvoice(cancelTarget.id, cancelReason.trim());
      setSelected((s) => (s && s.id === updated.id ? updated : s));
      toast(t('success'));
      setCancelTarget(null);
      setCancelReason('');
      reload();
    } catch {
      toast(t('error'), 'error');
    } finally {
      setBusy(false);
    }
  };

  const openPrint = (inv: Invoice) => {
    setSelected(inv);
    setPrintMode(true);
    setTimeout(() => {
      window.print();
      setPrintMode(false);
    }, 120);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-extrabold text-slate-800 dark:text-white">{t('invoicesTitle')}</h1>
          <p className="mt-0.5 text-xs text-slate-400">
            {t('invoiceCount')}: {summary.count} · {t('total')}: {formatMoney(summary.total, settings.currency)} ·{' '}
            {t('paid')}: {formatMoney(summary.paid, settings.currency)} · {t('remaining')}:{' '}
            {formatMoney(summary.remaining, settings.currency)}
          </p>
        </div>
      </div>

      <div className="card flex flex-wrap items-center gap-2 p-3">
        <div className="min-w-[200px] flex-1">
          <Input
            placeholder={t('searchInvoices')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            icon={<Search size={15} />}
          />
        </div>
        <Select value={status} onChange={(e) => setStatus(e.target.value as typeof status)} className="w-40">
          <option value="all">{t('all')}</option>
          <option value="paid">{t('statusPaid')}</option>
          <option value="partial">{t('statusPartial')}</option>
          <option value="unpaid">{t('statusUnpaid')}</option>
          <option value="cancelled">{t('statusCancelled')}</option>
        </Select>
      </div>

      <div className="card overflow-hidden">
        {loading ? (
          <SkeletonRows rows={8} cols={6} />
        ) : filtered.length === 0 ? (
          <EmptyState icon={<Receipt size={26} />} title={t('noInvoices')} hint={t('noInvoicesHint')} />
        ) : (
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th>{t('invoiceNumber')}</th>
                  <th>{t('date')}</th>
                  <th>{t('customer')}</th>
                  <th className="th-numeric">{t('total')}</th>
                  <th className="th-numeric">{t('paid')}</th>
                  <th className="th-numeric">{t('remaining')}</th>
                  <th>{t('status')}</th>
                  <th className="text-end">{t('actions')}</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((inv) => (
                  <tr
                    key={inv.id}
                    onClick={() => setSelected(inv)}
                    className={`cursor-pointer ${inv.status === 'cancelled' ? 'opacity-60' : ''}`}
                  >
                    <td className="font-bold text-brand-600 dark:text-brand-400" dir="ltr">
                      {inv.number}
                    </td>
                    <td className="text-xs text-slate-500">{formatDate(inv.date, lang)}</td>
                    <td className="text-xs font-semibold">{inv.customerName || t('walkInCustomer')}</td>
                    <td className="td-numeric font-bold">{formatMoney(inv.total)}</td>
                    <td className="td-numeric text-emerald-600">{formatMoney(inv.paid)}</td>
                    <td className={`td-numeric ${inv.remaining > 0 ? 'font-bold text-rose-500' : 'text-slate-400'}`}>
                      {formatMoney(inv.remaining)}
                    </td>
                    <td>{statusBadge(inv, t)}</td>
                    <td>
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelected(inv);
                          }}
                          className="rounded-lg p-1.5 text-slate-400 hover:bg-brand-50 hover:text-brand-600 dark:hover:bg-slate-800"
                          title={t('details')}
                        >
                          <Eye size={15} />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            openPrint(inv);
                          }}
                          className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800"
                          title={t('print')}
                        >
                          <Printer size={15} />
                        </button>
                        {inv.status !== 'cancelled' && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setCancelTarget(inv);
                            }}
                            className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950"
                            title={t('cancelInvoice')}
                          >
                            <XCircle size={15} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* تفاصيل الفاتورة */}
      <Modal
        open={!!selected}
        onClose={() => setSelected(null)}
        title={selected ? `${t('invoiceDetails')} — ${selected.number}` : ''}
        size="lg"
        footer={
          selected && (
            <>
              {selected.status !== 'cancelled' && (
                <Button
                  variant="danger"
                  icon={<XCircle size={15} />}
                  onClick={() => {
                    setCancelTarget(selected);
                  }}
                >
                  {t('cancelInvoice')}
                </Button>
              )}
              <Button variant="secondary" icon={<Printer size={15} />} onClick={() => openPrint(selected)}>
                {t('print')}
              </Button>
              <Button onClick={() => setSelected(null)}>{t('close')}</Button>
            </>
          )
        }
      >
        {selected && (
          <div className="space-y-4">
            <div className={`rounded-lg border p-3 text-xs ${selected.status === 'cancelled' ? 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-400' : 'border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800/60'}`}>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Meta label={t('date')} value={formatDate(selected.date, lang)} />
                <Meta label={t('customer')} value={selected.customerName || t('walkInCustomer')} />
                <Meta label={t('paymentMethod')} value={t(selected.paymentMethod === 'bank' ? 'bank' : selected.paymentMethod === 'credit' ? 'credit' : 'cash')} />
                <Meta label={t('status')} value={statusBadge(selected, t)} />
              </div>
              {selected.status === 'cancelled' && (
                <p className="mt-2 border-t border-rose-200 pt-2 dark:border-rose-900">
                  {t('cancelReason')}: {selected.cancelReason || '—'}
                </p>
              )}
            </div>

            <div className="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700">
              <table className="table-base">
                <thead>
                  <tr>
                    <th>{t('productName')}</th>
                    <th className="th-numeric">{t('quantity')}</th>
                    <th className="th-numeric">{t('price')}</th>
                    <th className="th-numeric">{t('cogs')}</th>
                    <th className="th-numeric">{t('total')}</th>
                  </tr>
                </thead>
                <tbody>
                  {selected.items.map((it, i) => (
                    <tr key={`${it.productId}-${i}`}>
                      <td className="text-xs font-semibold">{it.name}</td>
                      <td className="td-numeric">{it.quantity}</td>
                      <td className="td-numeric">{formatMoney(it.unitPrice)}</td>
                      <td className="td-numeric text-slate-400">{formatMoney(it.unitCost)}</td>
                      <td className="td-numeric font-bold">{formatMoney(it.lineTotal)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="ms-auto max-w-sm space-y-1.5 rounded-lg bg-slate-50 p-3 text-xs dark:bg-slate-800/60">
              <Line label={t('subtotal')} value={formatMoney(selected.subtotal, settings.currency)} />
              <Line label={t('discount')} value={`− ${formatMoney(selected.discount, settings.currency)}`} />
              <Line label={t('total')} value={formatMoney(selected.total, settings.currency)} strong />
              <Line label={t('paid')} value={formatMoney(selected.paid, settings.currency)} />
              <Line label={t('remaining')} value={formatMoney(selected.remaining, settings.currency)} />
              {selected.status !== 'cancelled' && (
                <div className="mt-1 border-t border-slate-200 pt-1.5 text-slate-500 dark:border-slate-700">
                  <Line
                    label={t('profit')}
                    value={formatMoney(selected.total - selected.cogs, settings.currency)}
                  />
                </div>
              )}
            </div>
          </div>
        )}
      </Modal>

      {/* طباعة */}
      {printMode && selected && (
        <div className="fixed inset-0 z-[60] overflow-auto bg-white">
          <InvoicePrintView invoice={selected} />
        </div>
      )}

      {/* تأكيد الإلغاء */}
      <Modal
        open={!!cancelTarget}
        onClose={() => setCancelTarget(null)}
        title={t('cancelInvoice')}
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setCancelTarget(null)}>
              {t('cancel')}
            </Button>
            <Button variant="danger" loading={busy} onClick={doCancel}>
              {t('confirm')}
            </Button>
          </>
        }
      >
        <p className="mb-3 text-sm leading-relaxed text-slate-600 dark:text-slate-300">{t('cancelInvoiceConfirm')}</p>
        <Textarea
          label={t('cancelReason')}
          value={cancelReason}
          onChange={(e) => setCancelReason(e.target.value)}
        />
      </Modal>
    </div>
  );
}

function Meta({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase text-slate-400">{label}</p>
      <p className="mt-0.5 font-bold text-slate-700 dark:text-slate-200">{value}</p>
    </div>
  );
}

function Line({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className={strong ? 'text-sm font-extrabold text-slate-700 dark:text-slate-200' : 'text-slate-500'}>{label}</span>
      <span className={`font-mono ${strong ? 'text-sm font-extrabold' : ''}`} dir="ltr">
        {value}
      </span>
    </div>
  );
}
