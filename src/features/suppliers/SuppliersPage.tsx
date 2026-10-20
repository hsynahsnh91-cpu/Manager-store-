import { useMemo, useState } from 'react';
import { Building2, Eye, Pencil, Plus, Search, Wallet } from 'lucide-react';
import type { Supplier } from '../../types';
import {
  createSupplier,
  listSuppliersWithBalance,
  listSupplierPayments,
  updateSupplier,
} from '../../services/suppliers';
import { paySupplier } from '../../services/purchases';
import { listPurchases } from '../../services/purchases';
import { useAsync } from '../../hooks/useAsync';
import { useApp } from '../../context/AppContext';
import { useI18n } from '../../i18n';
import { Button } from '../../components/Button';
import { Input, Select, Textarea } from '../../components/Form';
import { Modal } from '../../components/Modal';
import { Badge, EmptyState, SkeletonRows } from '../../components/UI';
import { formatDate, formatDateTime } from '../../utils/dates';
import { formatMoney, round2 } from '../../utils/money';

interface FormState {
  name: string;
  phone: string;
  address: string;
  notes: string;
}

const empty: FormState = { name: '', phone: '', address: '', notes: '' };

export function SuppliersPage() {
  const { t, lang } = useI18n();
  const { settings, toast } = useApp();
  const { data, loading, reload } = useAsync(() => listSuppliersWithBalance(), []);
  const { data: allPurchases } = useAsync(() => listPurchases(), []);

  const [search, setSearch] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Supplier | null>(null);
  const [form, setForm] = useState<FormState>(empty);
  const [errors, setErrors] = useState<{ name?: string }>({});
  const [saving, setSaving] = useState(false);

  const [payTarget, setPayTarget] = useState<{ id: string; name: string; balance: number } | null>(null);
  const [payAmount, setPayAmount] = useState('');
  const [payMethod, setPayMethod] = useState<'cash' | 'bank'>('cash');
  const [payNotes, setPayNotes] = useState('');
  const [payBusy, setPayBusy] = useState(false);

  const [statementFor, setStatementFor] = useState<Supplier | null>(null);
  const [paymentsFor, setPaymentsFor] = useState<Supplier | null>(null);
  const [supplierPayments, setSupplierPayments] = useState<Awaited<ReturnType<typeof listSupplierPayments>> | null>(null);

  const rows = data ?? [];
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((s) => `${s.name} ${s.phone}`.toLowerCase().includes(q));
  }, [rows, search]);

  const totalDues = useMemo(() => rows.reduce((a, s) => a + s.balance, 0), [rows]);

  const statementRows = useMemo(() => {
    if (!statementFor || !allPurchases) return [];
    const purchases = allPurchases
      .filter((p) => p.supplierId === statementFor.id && p.status !== 'cancelled')
      .sort((a, b) => a.date - b.date);
    return purchases;
  }, [statementFor, allPurchases]);

  const openAdd = () => {
    setEditing(null);
    setForm(empty);
    setErrors({});
    setFormOpen(true);
  };

  const openEdit = (s: Supplier) => {
    setEditing(s);
    setForm({ name: s.name, phone: s.phone, address: s.address, notes: s.notes });
    setErrors({});
    setFormOpen(true);
  };

  const submit = async () => {
    if (!form.name.trim()) {
      setErrors({ name: t('required') });
      return;
    }
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        phone: form.phone.trim(),
        address: form.address.trim(),
        notes: form.notes.trim(),
      };
      if (editing) await updateSupplier(editing.id, payload);
      else await createSupplier(payload);
      toast(t('success'));
      setFormOpen(false);
      reload();
    } catch {
      toast(t('error'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const submitPayment = async () => {
    if (!payTarget) return;
    const amount = round2(Number(payAmount));
    if (!Number.isFinite(amount) || amount <= 0) {
      toast(t('required'), 'error');
      return;
    }
    setPayBusy(true);
    try {
      const res = await paySupplier(payTarget.id, payTarget.name, amount, payMethod, Date.now(), payNotes.trim());
      toast(`${t('success')} — ${formatMoney(res.applied, settings.currency)}`);
      setPayTarget(null);
      reload();
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      if (msg === 'NO_OUTSTANDING') toast(t('noData'), 'error');
      else toast(t('error'), 'error');
    } finally {
      setPayBusy(false);
    }
  };

  const openPayments = async (s: Supplier) => {
    setPaymentsFor(s);
    setSupplierPayments(null);
    const pays = await listSupplierPayments(s.id);
    setSupplierPayments(pays);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-extrabold text-slate-800 dark:text-white">{t('suppliersTitle')}</h1>
          <p className="mt-0.5 text-xs text-slate-400">
            {rows.length} · {t('dues')}: {formatMoney(totalDues, settings.currency)}
          </p>
        </div>
        <Button icon={<Plus size={16} />} onClick={openAdd}>
          {t('addSupplier')}
        </Button>
      </div>

      <div className="card p-3">
        <Input placeholder={t('searchSuppliers')} value={search} onChange={(e) => setSearch(e.target.value)} icon={<Search size={15} />} />
      </div>

      <div className="card overflow-hidden">
        {loading ? (
          <SkeletonRows rows={5} cols={5} />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={<Building2 size={26} />}
            title={t('noSuppliers')}
            hint={t('noSuppliersHint')}
            action={
              <Button size="sm" icon={<Plus size={15} />} onClick={openAdd}>
                {t('addSupplier')}
              </Button>
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th>{t('supplierName')}</th>
                  <th>{t('phone')}</th>
                  <th className="th-numeric">{t('purchasesTitle')}</th>
                  <th className="th-numeric">{t('dues')}</th>
                  <th className="text-end">{t('actions')}</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((s) => (
                  <tr key={s.id}>
                    <td>
                      <div className="font-bold text-slate-800 dark:text-slate-100">{s.name}</div>
                      {s.address && <div className="text-[11px] text-slate-400">{s.address}</div>}
                    </td>
                    <td className="text-xs" dir="ltr">
                      {s.phone || '—'}
                    </td>
                    <td className="td-numeric text-slate-500">{s.purchaseCount}</td>
                    <td className="td-numeric">
                      {s.balance > 0 ? (
                        <span className="font-bold text-rose-600">{formatMoney(s.balance, settings.currency)}</span>
                      ) : (
                        <Badge tone="green">0</Badge>
                      )}
                    </td>
                    <td>
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => setPayTarget({ id: s.id, name: s.name, balance: s.balance })}
                          disabled={s.balance <= 0}
                          className="rounded-lg p-1.5 text-slate-400 hover:bg-emerald-50 hover:text-emerald-600 disabled:opacity-30 dark:hover:bg-emerald-950"
                          title={t('paySupplier')}
                        >
                          <Wallet size={15} />
                        </button>
                        <button
                          onClick={() => setStatementFor(s)}
                          className="rounded-lg p-1.5 text-slate-400 hover:bg-brand-50 hover:text-brand-600 dark:hover:bg-slate-800"
                          title={t('supplierStatement')}
                        >
                          <Eye size={15} />
                        </button>
                        <button
                          onClick={() => openEdit(s)}
                          className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800"
                          title={t('edit')}
                        >
                          <Pencil size={15} />
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

      {/* نموذج المورد */}
      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editing ? t('editSupplier') : t('addSupplier')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setFormOpen(false)}>
              {t('cancel')}
            </Button>
            <Button onClick={submit} loading={saving}>
              {t('save')}
            </Button>
          </>
        }
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Input
            label={t('supplierName')}
            required
            value={form.name}
            error={errors.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="sm:col-span-2"
          />
          <Input label={t('phone')} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} dir="ltr" />
          <Input label={t('address')} value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
          <Textarea label={t('notes')} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className="sm:col-span-2" />
        </div>
      </Modal>

      {/* تسديد دفعة */}
      <Modal
        open={!!payTarget}
        onClose={() => setPayTarget(null)}
        title={`${t('paySupplier')} — ${payTarget?.name ?? ''}`}
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setPayTarget(null)}>
              {t('cancel')}
            </Button>
            <Button variant="success" loading={payBusy} onClick={submitPayment}>
              {t('confirm')}
            </Button>
          </>
        }
      >
        {payTarget && (
          <div className="space-y-3">
            <div className="rounded-lg bg-rose-50 px-3 py-2 text-xs font-bold text-rose-600 dark:bg-rose-950 dark:text-rose-400">
              {t('dues')}: {formatMoney(payTarget.balance, settings.currency)}
            </div>
            <Input
              label={t('paymentAmount')}
              required
              type="number"
              min="0"
              step="0.01"
              value={payAmount}
              onChange={(e) => setPayAmount(e.target.value)}
              placeholder={String(payTarget.balance)}
            />
            <Select label={t('paymentMethod')} value={payMethod} onChange={(e) => setPayMethod(e.target.value as 'cash' | 'bank')}>
              <option value="cash">{t('cash')}</option>
              <option value="bank">{t('bank')}</option>
            </Select>
            <Textarea label={t('notes')} value={payNotes} onChange={(e) => setPayNotes(e.target.value)} />
          </div>
        )}
      </Modal>

      {/* كشف حساب المورد */}
      <Modal
        open={!!statementFor}
        onClose={() => setStatementFor(null)}
        title={`${t('supplierStatement')} — ${statementFor?.name ?? ''}`}
        size="lg"
        footer={
          <>
            <Button variant="secondary" onClick={() => statementFor && void openPayments(statementFor)}>
              {t('paymentsHistory')}
            </Button>
            <Button onClick={() => setStatementFor(null)}>{t('close')}</Button>
          </>
        }
      >
        {statementRows.length === 0 ? (
          <EmptyState icon={<Building2 size={24} />} title={t('noData')} hint={t('emptyHint')} />
        ) : (
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th>{t('purchaseNumber')}</th>
                  <th>{t('date')}</th>
                  <th className="th-numeric">{t('total')}</th>
                  <th className="th-numeric">{t('paid')}</th>
                  <th className="th-numeric">{t('remaining')}</th>
                  <th>{t('status')}</th>
                </tr>
              </thead>
              <tbody>
                {statementRows.map((p) => (
                  <tr key={p.id}>
                    <td className="font-bold" dir="ltr">
                      {p.number}
                    </td>
                    <td className="text-xs text-slate-500">{formatDate(p.date, lang)}</td>
                    <td className="td-numeric">{formatMoney(p.total)}</td>
                    <td className="td-numeric text-emerald-600">{formatMoney(p.paid)}</td>
                    <td className="td-numeric font-bold text-rose-500">{formatMoney(p.remaining)}</td>
                    <td>
                      {p.status === 'received' ? (
                        <Badge tone="green">{t('received')}</Badge>
                      ) : p.status === 'ordered' ? (
                        <Badge tone="amber">{t('ordered')}</Badge>
                      ) : (
                        <Badge tone="rose">{t('statusCancelled')}</Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-3 rounded-lg bg-slate-50 p-3 text-xs font-bold dark:bg-slate-800/60">
              {t('dues')}:{' '}
              {formatMoney(
                (data ?? []).find((s) => s.id === statementFor?.id)?.balance ?? 0,
                settings.currency,
              )}
            </p>
          </div>
        )}
      </Modal>

      {/* سجل المدفوعات */}
      <Modal
        open={!!paymentsFor}
        onClose={() => setPaymentsFor(null)}
        title={`${t('paymentsHistory')} — ${paymentsFor?.name ?? ''}`}
        size="md"
        footer={<Button onClick={() => setPaymentsFor(null)}>{t('close')}</Button>}
      >
        {supplierPayments === null ? (
          <SkeletonRows rows={3} cols={3} />
        ) : supplierPayments.length === 0 ? (
          <EmptyState icon={<Wallet size={24} />} title={t('noData')} hint={t('emptyHint')} />
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {supplierPayments.map((p) => (
              <li key={p.id} className="flex items-center justify-between py-2.5 text-xs">
                <div>
                  <p className="font-bold text-slate-700 dark:text-slate-200">{formatMoney(p.amount, settings.currency)}</p>
                  <p className="text-[11px] text-slate-400">{formatDateTime(p.date, lang)}</p>
                </div>
                <Badge tone="blue">{t(p.method === 'bank' ? 'bank' : 'cash')}</Badge>
              </li>
            ))}
          </ul>
        )}
      </Modal>
    </div>
  );
}
