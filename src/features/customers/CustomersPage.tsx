import { useMemo, useState } from 'react';
import { AlertTriangle, Eye, Pencil, Plus, Search, User, Wallet } from 'lucide-react';
import type { Customer } from '../../types';
import {
  createCustomer,
  getCustomerStatement,
  listCustomersWithBalance,
  listCustomerPayments,
  updateCustomer,
} from '../../services/customers';
import { recordCustomerPayment, PaymentError } from '../../services/payments';
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
  creditDays: string;
  notes: string;
}

const empty: FormState = { name: '', phone: '', address: '', creditDays: '0', notes: '' };

export function CustomersPage() {
  const { t, lang } = useI18n();
  const { settings, toast } = useApp();
  const { data, loading, reload } = useAsync(() => listCustomersWithBalance(), []);

  const [search, setSearch] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Customer | null>(null);
  const [form, setForm] = useState<FormState>(empty);
  const [errors, setErrors] = useState<Partial<Record<keyof FormState, string>>>({});
  const [saving, setSaving] = useState(false);

  const [payTarget, setPayTarget] = useState<{ id: string; name: string; balance: number } | null>(null);
  const [payAmount, setPayAmount] = useState('');
  const [payMethod, setPayMethod] = useState<'cash' | 'bank'>('cash');
  const [payNotes, setPayNotes] = useState('');
  const [payBusy, setPayBusy] = useState(false);

  const [statementFor, setStatementFor] = useState<Customer | null>(null);
  const [statement, setStatement] = useState<Awaited<ReturnType<typeof getCustomerStatement>> | null>(null);
  const [paymentsFor, setPaymentsFor] = useState<Customer | null>(null);
  const [customerPayments, setCustomerPayments] = useState<Awaited<ReturnType<typeof listCustomerPayments>> | null>(null);

  const rows = data ?? [];
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((c) => `${c.name} ${c.phone}`.toLowerCase().includes(q));
  }, [rows, search]);

  const totalDebts = useMemo(() => rows.reduce((a, c) => a + c.balance, 0), [rows]);

  const openAdd = () => {
    setEditing(null);
    setForm(empty);
    setErrors({});
    setFormOpen(true);
  };

  const openEdit = (c: Customer) => {
    setEditing(c);
    setForm({
      name: c.name,
      phone: c.phone,
      address: c.address,
      creditDays: String(c.creditDays),
      notes: c.notes,
    });
    setErrors({});
    setFormOpen(true);
  };

  const submit = async () => {
    const e: typeof errors = {};
    if (!form.name.trim()) e.name = t('required');
    setErrors(e);
    if (Object.keys(e).length > 0) return;
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        phone: form.phone.trim(),
        address: form.address.trim(),
        creditDays: Number(form.creditDays) || 0,
        notes: form.notes.trim(),
      };
      if (editing) await updateCustomer(editing.id, payload);
      else await createCustomer(payload);
      toast(t('success'));
      setFormOpen(false);
      reload();
    } catch {
      toast(t('error'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const openPay = (c: { id: string; name: string; balance: number }) => {
    setPayTarget(c);
    setPayAmount('');
    setPayMethod('cash');
    setPayNotes('');
  };

  const submitPayment = async () => {
    if (!payTarget) return;
    const amount = round2(Number(payAmount));
    if (!Number.isFinite(amount) || amount <= 0) {
      toast(t('required'), 'error');
      return;
    }
    if (amount > payTarget.balance + 0.001) {
      toast(`${t('remaining')}: ${formatMoney(payTarget.balance)}`, 'error');
      return;
    }
    setPayBusy(true);
    try {
      await recordCustomerPayment({
        customerId: payTarget.id,
        customerName: payTarget.name,
        amount,
        method: payMethod,
        notes: payNotes.trim(),
      });
      toast(t('success'));
      setPayTarget(null);
      reload();
    } catch (err) {
      if (err instanceof PaymentError) toast(t('errGeneric'), 'error');
      else toast(t('error'), 'error');
    } finally {
      setPayBusy(false);
    }
  };

  const openStatement = async (c: Customer) => {
    setStatementFor(c);
    setStatement(null);
    const entries = await getCustomerStatement(c.id);
    setStatement(entries);
  };

  const openPayments = async (c: Customer) => {
    setPaymentsFor(c);
    setCustomerPayments(null);
    const pays = await listCustomerPayments(c.id);
    setCustomerPayments(pays);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-extrabold text-slate-800 dark:text-white">{t('customersTitle')}</h1>
          <p className="mt-0.5 text-xs text-slate-400">
            {rows.length} · {t('totalDebts')}: {formatMoney(totalDebts, settings.currency)}
          </p>
        </div>
        <Button icon={<Plus size={16} />} onClick={openAdd}>
          {t('addCustomer')}
        </Button>
      </div>

      <div className="card p-3">
        <Input
          placeholder={t('searchCustomers')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          icon={<Search size={15} />}
        />
      </div>

      <div className="card overflow-hidden">
        {loading ? (
          <SkeletonRows rows={6} cols={5} />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={<User size={26} />}
            title={t('noCustomers')}
            hint={t('noCustomersHint')}
            action={
              <Button size="sm" icon={<Plus size={15} />} onClick={openAdd}>
                {t('addCustomer')}
              </Button>
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th>{t('customerName')}</th>
                  <th>{t('phone')}</th>
                  <th className="th-numeric">{t('dueInvoices')}</th>
                  <th className="th-numeric">{t('balance')}</th>
                  <th className="text-end">{t('actions')}</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <div className="font-bold text-slate-800 dark:text-slate-100">{c.name}</div>
                      {c.address && <div className="text-[11px] text-slate-400">{c.address}</div>}
                      {c.overdue && (
                        <span className="mt-0.5 inline-flex items-center gap-1 rounded bg-rose-100 px-1.5 py-0.5 text-[10px] font-bold text-rose-600 dark:bg-rose-950 dark:text-rose-400">
                          <AlertTriangle size={9} />
                          {t('overdue')} · {c.oldestUnpaidDays} {t('days')}
                        </span>
                      )}
                    </td>
                    <td className="text-xs" dir="ltr">
                      {c.phone || '—'}
                    </td>
                    <td className="td-numeric text-slate-500">{c.invoiceCount}</td>
                    <td className="td-numeric">
                      {c.balance > 0 ? (
                        <span className="font-bold text-rose-600">{formatMoney(c.balance, settings.currency)}</span>
                      ) : (
                        <Badge tone="green">0</Badge>
                      )}
                    </td>
                    <td>
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => openPay({ id: c.id, name: c.name, balance: c.balance })}
                          disabled={c.balance <= 0}
                          className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-emerald-50 hover:text-emerald-600 disabled:opacity-30 dark:hover:bg-emerald-950"
                          title={t('recordPayment')}
                        >
                          <Wallet size={15} />
                        </button>
                        <button
                          onClick={() => void openStatement(c)}
                          className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-brand-50 hover:text-brand-600 dark:hover:bg-slate-800"
                          title={t('statement')}
                        >
                          <Eye size={15} />
                        </button>
                        <button
                          onClick={() => openEdit(c)}
                          className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800"
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

      {/* نموذج العميل */}
      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editing ? t('editCustomer') : t('addCustomer')}
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
            label={t('customerName')}
            required
            value={form.name}
            error={errors.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="sm:col-span-2"
          />
          <Input label={t('phone')} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} dir="ltr" />
          <Input
            label={t('creditDays')}
            type="number"
            min="0"
            value={form.creditDays}
            onChange={(e) => setForm({ ...form, creditDays: e.target.value })}
          />
          <Input
            label={t('address')}
            value={form.address}
            onChange={(e) => setForm({ ...form, address: e.target.value })}
            className="sm:col-span-2"
          />
          <Textarea
            label={t('notes')}
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
            className="sm:col-span-2"
          />
        </div>
      </Modal>

      {/* تسجيل دفعة */}
      <Modal
        open={!!payTarget}
        onClose={() => setPayTarget(null)}
        title={`${t('recordPayment')} — ${payTarget?.name ?? ''}`}
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
              {t('balance')}: {formatMoney(payTarget.balance, settings.currency)}
              <p className="mt-0.5 text-[10px] font-normal text-rose-400">{t('balanceMustMatch')}</p>
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
            <p className="text-[11px] leading-relaxed text-slate-400">
              {t('totalDebts')} → {t('netProfit')}: التحصيل يُسجَّل في الصندوق ولا يُضاف كدخل جديد.
            </p>
          </div>
        )}
      </Modal>

      {/* كشف حساب */}
      <Modal
        open={!!statementFor}
        onClose={() => setStatementFor(null)}
        title={`${t('statement')} — ${statementFor?.name ?? ''}`}
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
        {statement === null ? (
          <SkeletonRows rows={5} cols={4} />
        ) : statement.length === 0 ? (
          <EmptyState icon={<Wallet size={24} />} title={t('noData')} hint={t('emptyHint')} />
        ) : (
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th>{t('date')}</th>
                  <th>{t('details')}</th>
                  <th className="th-numeric">{t('amount')}</th>
                  <th className="th-numeric">{t('balance')}</th>
                </tr>
              </thead>
              <tbody>
                {statement.map((e, i) => (
                  <tr key={`${e.refId}-${i}`}>
                    <td className="text-xs text-slate-500">{formatDate(e.date, lang)}</td>
                    <td>
                      <span className="text-xs font-semibold">{e.label}</span>
                      <span className="ms-1.5 text-[11px] text-slate-400" dir="ltr">
                        {e.reference}
                      </span>
                    </td>
                    <td className="td-numeric">
                      {e.debit > 0 && <span className="text-rose-500">+{formatMoney(e.debit)}</span>}
                      {e.credit > 0 && <span className="text-emerald-600">−{formatMoney(e.credit)}</span>}
                    </td>
                    <td className="td-numeric font-bold">{formatMoney(e.balanceAfter, settings.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
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
        {customerPayments === null ? (
          <SkeletonRows rows={4} cols={3} />
        ) : customerPayments.length === 0 ? (
          <EmptyState icon={<Wallet size={24} />} title={t('noData')} hint={t('emptyHint')} />
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {customerPayments.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-3 py-2.5 text-xs">
                <div>
                  <p className="font-bold text-slate-700 dark:text-slate-200">
                    {formatMoney(p.amount, settings.currency)}{' '}
                    <span className="font-normal text-slate-400">· {t(p.method === 'bank' ? 'bank' : 'cash')}</span>
                  </p>
                  <p className="text-[11px] text-slate-400">{formatDateTime(p.date, lang)}</p>
                  {p.notes && <p className="text-[11px] text-slate-400">{p.notes}</p>}
                </div>
                <Badge tone="green">{t('recordPayment')}</Badge>
              </li>
            ))}
          </ul>
        )}
      </Modal>
    </div>
  );
}
