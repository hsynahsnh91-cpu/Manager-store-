import { useMemo, useRef, useState } from 'react';
import { CheckCircle2, Eye, PackagePlus, Plus, Search, Trash2, XCircle } from 'lucide-react';
import type { Purchase, PurchaseItem } from '../../types';
import {
  cancelPurchase,
  computePurchaseTotals,
  createPurchase,
  getNextPurchaseNumber,
  listPurchases,
  receivePurchase,
} from '../../services/purchases';
import { listProducts } from '../../services/products';
import { listSuppliers } from '../../services/suppliers';
import { useAsync } from '../../hooks/useAsync';
import { useApp } from '../../context/AppContext';
import { useI18n } from '../../i18n';
import { Button } from '../../components/Button';
import { Input, Select, Textarea } from '../../components/Form';
import { Modal } from '../../components/Modal';
import { Badge, EmptyState, SkeletonRows } from '../../components/UI';
import { formatDate } from '../../utils/dates';
import { formatMoney, round2 } from '../../utils/money';
import { uid } from '../../utils/id';

interface DraftLine {
  productId: string;
  name: string;
  code: string;
  quantity: string;
  unitCost: string;
}

export function PurchasesPage() {
  const { t, lang } = useI18n();
  const { settings, toast } = useApp();
  const { data, loading, reload } = useAsync(() => listPurchases(), []);
  const { data: products } = useAsync(() => listProducts(), []);
  const { data: suppliers } = useAsync(() => listSuppliers(), []);

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | Purchase['status']>('all');
  const [formOpen, setFormOpen] = useState(false);
  const [selected, setSelected] = useState<Purchase | null>(null);

  // نموذج الفاتورة الجديدة
  const [supplierId, setSupplierId] = useState('');
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [discount, setDiscount] = useState('0');
  const [paidStr, setPaidStr] = useState('0');
  const [method, setMethod] = useState<'cash' | 'bank' | 'credit'>('cash');
  const [notes, setNotes] = useState('');
  const [productPick, setProductPick] = useState('');
  const [saving, setSaving] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<Purchase | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const tokenRef = useRef<string>(uid('tok'));

  const purchases = data ?? [];
  const activeProducts = useMemo(() => (products ?? []).filter((p) => !p.archived), [products]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return purchases.filter((p) => {
      if (statusFilter !== 'all' && p.status !== statusFilter) return false;
      if (q && !`${p.number} ${p.supplierName}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [purchases, search, statusFilter]);

  const draftLines = lines
    .map((l) => ({
      productId: l.productId,
      name: l.name,
      code: l.code,
      quantity: Number(l.quantity) || 0,
      unitCost: Number(l.unitCost) || 0,
    }))
    .filter((l) => l.productId && l.quantity > 0);

  const totals = computePurchaseTotals(draftLines, Number(discount) || 0);
  const paid = method === 'credit' ? 0 : Number(paidStr) || 0;
  const remaining = Math.max(0, round2(totals.total - Math.min(paid, totals.total)));

  const resetForm = () => {
    setSupplierId('');
    setLines([]);
    setDiscount('0');
    setPaidStr('0');
    setMethod('cash');
    setNotes('');
    setProductPick('');
    tokenRef.current = uid('tok');
  };

  const openForm = () => {
    resetForm();
    setFormOpen(true);
  };

  const addLine = (productId: string) => {
    const p = (products ?? []).find((x) => x.id === productId);
    if (!p) return;
    setLines((prev) => {
      if (prev.some((l) => l.productId === productId)) return prev;
      return [
        ...prev,
        {
          productId: p.id,
          name: p.name,
          code: p.code,
          quantity: '1',
          unitCost: String(p.purchasePrice),
        },
      ];
    });
    setProductPick('');
  };

  const submit = async (receiveNow: boolean) => {
    if (draftLines.length === 0) {
      toast(t('required'), 'error');
      return;
    }
    setSaving(true);
    try {
      const number = await getNextPurchaseNumber(settings.purchasePrefix);
      const supplier = (suppliers ?? []).find((s) => s.id === supplierId);
      const purchase = await createPurchase({
        items: draftLines.map((l) => ({ productId: l.productId, name: l.name, code: l.code, quantity: l.quantity, unitCost: l.unitCost })),
        supplierId: supplierId || null,
        supplierName: supplier?.name ?? '',
        discount: Number(discount) || 0,
        paid: method === 'credit' ? 0 : Number(paidStr) || 0,
        paymentMethod: method,
        status: 'ordered',
        notes,
        date: Date.now(),
        number,
        clientToken: tokenRef.current,
      });
      if (receiveNow) {
        await receivePurchase(purchase.id);
      }
      toast(t('success'));
      setFormOpen(false);
      reload();
    } catch {
      toast(t('error'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const doReceive = async (p: Purchase) => {
    try {
      await receivePurchase(p.id);
      toast(t('success'));
      setSelected(null);
      reload();
    } catch {
      toast(t('error'), 'error');
    }
  };

  const doCancel = async () => {
    if (!cancelTarget) return;
    try {
      await cancelPurchase(cancelTarget.id, cancelReason.trim());
      toast(t('success'));
      setCancelTarget(null);
      setCancelReason('');
      setSelected(null);
      reload();
    } catch {
      toast(t('error'), 'error');
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-extrabold text-slate-800 dark:text-white">{t('purchasesTitle')}</h1>
          <p className="mt-0.5 text-xs text-slate-400">{t('costPolicy')}</p>
        </div>
        <Button icon={<Plus size={16} />} onClick={openForm}>
          {t('newPurchase')}
        </Button>
      </div>

      <div className="card flex flex-wrap items-center gap-2 p-3">
        <div className="min-w-[200px] flex-1">
          <Input placeholder={t('searchPurchases')} value={search} onChange={(e) => setSearch(e.target.value)} icon={<Search size={15} />} />
        </div>
        <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)} className="w-36">
          <option value="all">{t('all')}</option>
          <option value="ordered">{t('ordered')}</option>
          <option value="received">{t('received')}</option>
          <option value="cancelled">{t('statusCancelled')}</option>
        </Select>
      </div>

      <div className="card overflow-hidden">
        {loading ? (
          <SkeletonRows rows={6} cols={6} />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={<PackagePlus size={26} />}
            title={t('noPurchases')}
            hint={t('noPurchasesHint')}
            action={
              <Button size="sm" icon={<Plus size={15} />} onClick={openForm}>
                {t('newPurchase')}
              </Button>
            }
          />
        ) : (
          <div className="overflow-x-auto">
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
                  <th className="text-end">{t('actions')}</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((p) => (
                  <tr key={p.id} className={p.status === 'cancelled' ? 'opacity-60' : ''} onClick={() => setSelected(p)}>
                    <td className="cursor-pointer font-bold text-brand-600 dark:text-brand-400" dir="ltr">
                      {p.number}
                    </td>
                    <td className="text-xs text-slate-500">{formatDate(p.date, lang)}</td>
                    <td className="text-xs font-semibold">{p.supplierName || '—'}</td>
                    <td className="td-numeric font-bold">{formatMoney(p.total)}</td>
                    <td className="td-numeric text-emerald-600">{formatMoney(p.paid)}</td>
                    <td className="td-numeric text-rose-500">{formatMoney(p.remaining)}</td>
                    <td>
                      {p.status === 'received' && <Badge tone="green">{t('received')}</Badge>}
                      {p.status === 'ordered' && <Badge tone="amber">{t('ordered')}</Badge>}
                      {p.status === 'cancelled' && <Badge tone="rose">{t('statusCancelled')}</Badge>}
                    </td>
                    <td>
                      <div className="flex items-center justify-end gap-1">
                        {p.status === 'ordered' && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              void doReceive(p);
                            }}
                            className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-2 py-1.5 text-[11px] font-bold text-white transition-colors hover:bg-emerald-700"
                          >
                            <CheckCircle2 size={13} /> {t('receivePurchase')}
                          </button>
                        )}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelected(p);
                          }}
                          className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800"
                          title={t('details')}
                        >
                          <Eye size={15} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* نموذج فاتورة شراء جديدة */}
      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={t('newPurchase')}
        size="lg"
        footer={
          <>
            <Button variant="secondary" onClick={() => setFormOpen(false)}>
              {t('cancel')}
            </Button>
            <Button variant="secondary" loading={saving} onClick={() => void submit(false)}>
              {t('save')}
            </Button>
            <Button variant="success" loading={saving} icon={<CheckCircle2 size={15} />} onClick={() => void submit(true)}>
              {t('receivePurchase')}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Select
              label={t('supplier')}
              value={supplierId}
              onChange={(e) => setSupplierId(e.target.value)}
              placeholder={t('none')}
            >
              {(suppliers ?? []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
            <Select
              label={t('paymentMethod')}
              value={method}
              onChange={(e) => {
                const m = e.target.value as typeof method;
                setMethod(m);
                if (m === 'credit') setPaidStr('0');
                else setPaidStr(String(totals.total));
              }}
            >
              <option value="cash">{t('cash')}</option>
              <option value="bank">{t('bank')}</option>
              <option value="credit">{t('credit')}</option>
            </Select>
          </div>

          {/* إضافة منتج */}
          <Select
            value={productPick}
            onChange={(e) => addLine(e.target.value)}
            placeholder={`${t('add')}…`}
          >
            {activeProducts
              .filter((p) => !lines.some((l) => l.productId === p.id))
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.code})
                </option>
              ))}
          </Select>

          {lines.length > 0 && (
            <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
              <table className="table-base">
                <thead>
                  <tr>
                    <th>{t('productName')}</th>
                    <th className="w-24">{t('quantity')}</th>
                    <th className="w-32">{t('unitCost')}</th>
                    <th className="th-numeric w-28">{t('total')}</th>
                    <th className="w-10" />
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l) => (
                    <tr key={l.productId}>
                      <td className="text-xs font-semibold">
                        {l.name}
                        <span className="ms-1 text-[10px] text-slate-400" dir="ltr">
                          {l.code}
                        </span>
                      </td>
                      <td>
                        <input
                          type="number"
                          min="1"
                          value={l.quantity}
                          onChange={(e) =>
                            setLines((prev) => prev.map((x) => (x.productId === l.productId ? { ...x, quantity: e.target.value } : x)))
                          }
                          className="w-full rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-mono dark:border-slate-600 dark:bg-slate-800"
                        />
                      </td>
                      <td>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={l.unitCost}
                          onChange={(e) =>
                            setLines((prev) => prev.map((x) => (x.productId === l.productId ? { ...x, unitCost: e.target.value } : x)))
                          }
                          className="w-full rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-mono dark:border-slate-600 dark:bg-slate-800"
                        />
                      </td>
                      <td className="td-numeric font-bold">
                        {formatMoney((Number(l.quantity) || 0) * (Number(l.unitCost) || 0))}
                      </td>
                      <td>
                        <button
                          onClick={() => setLines((prev) => prev.filter((x) => x.productId !== l.productId))}
                          className="rounded p-1 text-slate-400 hover:text-rose-500"
                        >
                          <Trash2 size={14} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Input label={t('discount')} type="number" min="0" step="0.01" value={discount} onChange={(e) => setDiscount(e.target.value)} />
            <Input
              label={t('amountPaid')}
              type="number"
              min="0"
              step="0.01"
              value={paidStr}
              disabled={method === 'credit'}
              onChange={(e) => setPaidStr(e.target.value)}
            />
            <Input label={t('notes')} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>

          <div className="space-y-1 rounded-lg bg-slate-50 p-3 text-xs dark:bg-slate-800/70">
            <SummaryRow label={t('subtotal')} value={formatMoney(totals.subtotal, settings.currency)} />
            <SummaryRow label={t('discount')} value={`− ${formatMoney(totals.discount, settings.currency)}`} />
            <SummaryRow label={t('total')} value={formatMoney(totals.total, settings.currency)} strong />
            <SummaryRow label={t('paid')} value={formatMoney(Math.min(paid, totals.total), settings.currency)} />
            <SummaryRow label={t('remaining')} value={formatMoney(remaining, settings.currency)} strong />
          </div>
        </div>
      </Modal>

      {/* تفاصيل فاتورة الشراء */}
      <Modal
        open={!!selected}
        onClose={() => setSelected(null)}
        title={selected ? `${t('purchaseNumber')} ${selected.number}` : ''}
        size="lg"
        footer={
          selected && (
            <>
              {selected.status === 'ordered' && (
                <Button variant="success" icon={<CheckCircle2 size={15} />} onClick={() => void doReceive(selected)}>
                  {t('receivePurchase')}
                </Button>
              )}
              {selected.status !== 'cancelled' && (
                <Button
                  variant="danger"
                  icon={<XCircle size={15} />}
                  onClick={() => {
                    setCancelTarget(selected);
                  }}
                >
                  {t('cancel')}
                </Button>
              )}
              <Button onClick={() => setSelected(null)}>{t('close')}</Button>
            </>
          )
        }
      >
        {selected && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2 rounded-lg bg-slate-50 p-3 text-xs sm:grid-cols-4 dark:bg-slate-800/60">
              <Meta label={t('date')} value={formatDate(selected.date, lang)} />
              <Meta label={t('supplier')} value={selected.supplierName || '—'} />
              <Meta
                label={t('status')}
                value={
                  selected.status === 'received' ? t('received') : selected.status === 'ordered' ? t('ordered') : t('statusCancelled')
                }
              />
              <Meta label={t('remaining')} value={formatMoney(selected.remaining, settings.currency)} />
            </div>
            <table className="table-base">
              <thead>
                <tr>
                  <th>{t('productName')}</th>
                  <th className="th-numeric">{t('quantity')}</th>
                  <th className="th-numeric">{t('unitCost')}</th>
                  <th className="th-numeric">{t('total')}</th>
                </tr>
              </thead>
              <tbody>
                {selected.items.map((it: PurchaseItem) => (
                  <tr key={it.productId}>
                    <td className="text-xs font-semibold">{it.name}</td>
                    <td className="td-numeric">{it.quantity}</td>
                    <td className="td-numeric">{formatMoney(it.unitCost)}</td>
                    <td className="td-numeric font-bold">{formatMoney(it.lineTotal)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="ms-auto max-w-xs space-y-1 text-xs">
              <SummaryRow label={t('subtotal')} value={formatMoney(selected.subtotal, settings.currency)} />
              <SummaryRow label={t('discount')} value={`− ${formatMoney(selected.discount, settings.currency)}`} />
              <SummaryRow label={t('total')} value={formatMoney(selected.total, settings.currency)} strong />
              <SummaryRow label={t('paid')} value={formatMoney(selected.paid, settings.currency)} />
              <SummaryRow label={t('remaining')} value={formatMoney(selected.remaining, settings.currency)} strong />
            </div>
            {selected.status === 'received' && (
              <p className="rounded-lg bg-brand-50 px-3 py-2 text-[11px] text-brand-700 dark:bg-brand-950 dark:text-brand-300">
                {t('costPolicy')}
              </p>
            )}
          </div>
        )}
      </Modal>

      {/* إلغاء فاتورة شراء */}
      <Modal
        open={!!cancelTarget}
        onClose={() => setCancelTarget(null)}
        title={t('cancel')}
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setCancelTarget(null)}>
              {t('cancel')}
            </Button>
            <Button variant="danger" onClick={() => void doCancel()}>
              {t('confirm')}
            </Button>
          </>
        }
      >
        <p className="mb-3 text-sm text-slate-600 dark:text-slate-300">{t('receiveConfirm')}</p>
        <Textarea label={t('cancelReason')} value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} />
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

function SummaryRow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className={strong ? 'font-extrabold text-slate-700 dark:text-slate-200' : 'text-slate-500'}>{label}</span>
      <span className={`font-mono ${strong ? 'font-extrabold' : ''}`} dir="ltr">
        {value}
      </span>
    </div>
  );
}
