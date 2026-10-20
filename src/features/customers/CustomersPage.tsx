import { useMemo, useState } from 'react';
import { AlertTriangle, Download, Eye, Pencil, Plus, Search, ShoppingCart, User, Wallet } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import type { Customer } from '../../types';
import {
  createCustomer,
  getCustomerOpenDebts,
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
import { downloadCSV } from '../../utils/csv';
import { uid } from '../../utils/id';

interface FormState {
  name: string;
  reference: string;
  phone: string;
  address: string;
  creditDays: string;
  openingBalance: string;
  notes: string;
}

const empty: FormState = {
  name: '',
  reference: '',
  phone: '',
  address: '',
  creditDays: '0',
  openingBalance: '0',
  notes: '',
};

type OpenDebt = Awaited<ReturnType<typeof getCustomerOpenDebts>>[number];

export function CustomersPage() {
  const { t, lang } = useI18n();
  const { settings, toast } = useApp();
  const navigate = useNavigate();
  const { data, loading, reload } = useAsync(() => listCustomersWithBalance(), []);

  const [search, setSearch] = useState('');
  const [overdueOnly, setOverdueOnly] = useState(false);
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
  const [openDebts, setOpenDebts] = useState<OpenDebt[] | null>(null);
  const [selectedDebts, setSelectedDebts] = useState<string[]>([]);
  const tokenRef = useState(() => uid('pay'))[0];

  const [statementFor, setStatementFor] = useState<Customer | null>(null);
  const [statement, setStatement] = useState<Awaited<ReturnType<typeof getCustomerStatement>> | null>(null);
  const [rangeFrom, setRangeFrom] = useState('');
  const [rangeTo, setRangeTo] = useState('');
  const [paymentsFor, setPaymentsFor] = useState<Customer | null>(null);
  const [customerPayments, setCustomerPayments] = useState<Awaited<ReturnType<typeof listCustomerPayments>> | null>(null);

  const rows = data ?? [];
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((c) => {
      if (overdueOnly && !c.overdue) return false;
      if (!q) return true;
      return `${c.name} ${c.phone} ${c.reference ?? ''}`.toLowerCase().includes(q);
    });
  }, [rows, search, overdueOnly]);

  const totalDebts = useMemo(() => rows.reduce((a, c) => a + c.balance, 0), [rows]);
  const overdueCount = useMemo(() => rows.filter((c) => c.overdue && c.balance > 0).length, [rows]);

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
      reference: c.reference ?? '',
      phone: c.phone,
      address: c.address,
      creditDays: String(c.creditDays),
      openingBalance: String(c.openingBalance ?? 0),
      notes: c.notes,
    });
    setErrors({});
    setFormOpen(true);
  };

  const submit = async () => {
    const e: typeof errors = {};
    if (!form.name.trim()) e.name = t('required');
    if (form.openingBalance !== '' && (!Number.isFinite(Number(form.openingBalance)) || Number(form.openingBalance) < 0)) {
      e.openingBalance = t('required');
    }
    setErrors(e);
    if (Object.keys(e).length > 0) return;
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        reference: form.reference.trim(),
        phone: form.phone.trim(),
        address: form.address.trim(),
        creditDays: Number(form.creditDays) || 0,
        notes: form.notes.trim(),
        openingBalance: round2(Number(form.openingBalance) || 0),
      };
      if (editing) await updateCustomer(editing.id, payload);
      else await createCustomer(payload);
      toast(t('saved'));
      setFormOpen(false);
      reload();
    } catch {
      toast(t('error'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const openPay = async (c: { id: string; name: string; balance: number }) => {
    setPayTarget(c);
    setPayAmount('');
    setPayMethod('cash');
    setPayNotes('');
    setSelectedDebts([]);
    setOpenDebts(null);
    const debts = await getCustomerOpenDebts(c.id);
    setOpenDebts(debts);
  };

  const selectedTotal = useMemo(
    () =>
      (openDebts ?? [])
        .filter((d) => selectedDebts.includes(d.id))
        .reduce((a, d) => a + d.remaining, 0),
    [openDebts, selectedDebts],
  );

  const submitPayment = async () => {
    if (!payTarget) return;
    const amount = round2(Number(payAmount));
    if (!Number.isFinite(amount) || amount <= 0) {
      toast(t('required'), 'error');
      return;
    }
    if (amount > payTarget.balance + 0.001) {
      toast(`${t('remaining')}: ${formatMoney(payTarget.balance, settings.currency)}`, 'error');
      return;
    }
    setPayBusy(true);
    try {
      const chosen = (openDebts ?? []).filter((d) => selectedDebts.includes(d.id));
      await recordCustomerPayment({
        customerId: payTarget.id,
        customerName: payTarget.name,
        amount,
        method: payMethod,
        notes: payNotes.trim(),
        specificInvoiceIds: chosen.filter((d) => d.kind === 'invoice').map((d) => d.id),
        specificManualSaleIds: chosen.filter((d) => d.kind === 'manual').map((d) => d.id),
        clientToken: `${tokenRef}-${payTarget.id}-${amount}-${payNotes.length}`,
      });
      toast(t('paymentSaved'));
      setPayTarget(null);
      reload();
    } catch (err) {
      if (err instanceof PaymentError && err.code === 'NO_OUTSTANDING') toast(t('noTransactions'), 'error');
      else if (err instanceof PaymentError) toast(t('errGeneric'), 'error');
      else toast(t('errGeneric'), 'error');
    } finally {
      setPayBusy(false);
    }
  };

  const openStatement = async (c: Customer) => {
    setStatementFor(c);
    setStatement(null);
    setRangeFrom('');
    setRangeTo('');
    const entries = await getCustomerStatement(c.id);
    setStatement(entries);
  };

  const filteredStatement = useMemo(() => {
    if (!statement) return null;
    const from = rangeFrom ? new Date(`${rangeFrom}T00:00:00`).getTime() : null;
    const to = rangeTo ? new Date(`${rangeTo}T23:59:59`).getTime() : null;
    return statement.filter((e) => (from === null || e.date >= from) && (to === null || e.date <= to));
  }, [statement, rangeFrom, rangeTo]);

  const exportStatement = () => {
    if (!statementFor || !filteredStatement) return;
    downloadCSV(
      `statement-${statementFor.name}`,
      [t('date'), t('details'), t('debit'), t('credit'), t('runningBalance')],
      filteredStatement.map((e) => [
        formatDateTime(e.date, lang),
        `${e.label} ${e.reference}`,
        e.debit,
        e.credit,
        e.balanceAfter,
      ]),
    );
  };

  const openPayments = async (c: Customer) => {
    setPaymentsFor(c);
    setCustomerPayments(null);
    const pays = await listCustomerPayments(c.id);
    setCustomerPayments(pays);
  };

  const ledgerTitle = settings.debtLedgerTitle?.trim() || t('customersTitle');

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-extrabold text-slate-800 dark:text-white">{ledgerTitle}</h1>
          <p className="mt-0.5 text-xs text-slate-400">
            {rows.length} · {t('totalDebts')}: {formatMoney(totalDebts, settings.currency)}
            {overdueCount > 0 ? ` · ${t('overdue')}: ${overdueCount}` : ''}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" icon={<ShoppingCart size={16} />} onClick={() => navigate('/pos?credit=1')}>
            {t('credit')}
          </Button>
          <Button icon={<Plus size={16} />} onClick={openAdd}>
            {t('addCustomer')}
          </Button>
        </div>
      </div>

      <div className="card flex flex-wrap items-center gap-2 p-3">
        <div className="min-w-[200px] flex-1">
          <Input
            placeholder={t('searchCustomer')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            icon={<Search size={15} />}
          />
        </div>
        <Button
          variant={overdueOnly ? 'primary' : 'secondary'}
          size="sm"
          icon={<AlertTriangle size={14} />}
          onClick={() => setOverdueOnly((v) => !v)}
        >
          {t('overdueReport')}
        </Button>
      </div>

      <div className="card overflow-hidden">
        {loading ? (
          <SkeletonRows rows={6} cols={5} />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={<User size={26} />}
            title={overdueOnly ? t('noOverdue') : t('noCustomers')}
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
                  <th>{t('lastActivity')}</th>
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
                      {c.reference && <div className="text-[11px] text-slate-400" dir="ltr">{c.reference}</div>}
                      {c.overdue && c.balance > 0 && (
                        <span className="mt-0.5 inline-flex items-center gap-1 rounded bg-rose-100 px-1.5 py-0.5 text-[10px] font-bold text-rose-600 dark:bg-rose-950 dark:text-rose-400">
                          <AlertTriangle size={9} />
                          {t('overdue')} · {c.oldestUnpaidDays} {t('days')}
                          {c.creditDays > 0 ? ` / ${c.creditDays}` : ''}
                        </span>
                      )}
                    </td>
                    <td className="text-xs" dir="ltr">
                      {c.phone || '—'}
                    </td>
                    <td className="text-xs text-slate-500">
                      {c.lastActivity ? formatDate(c.lastActivity, lang) : '—'}
                    </td>
                    <td className="td-numeric text-slate-500">{c.invoiceCount + c.manualSaleCount}</td>
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
                          onClick={() => void openPay({ id: c.id, name: c.name, balance: c.balance })}
                          disabled={c.balance <= 0}
                          className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-emerald-50 hover:text-emerald-600 disabled:opacity-30 dark:hover:bg-emerald-950"
                          title={t('collectPayment')}
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
        size="lg"
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
          <Input label={t('internalCode')} value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} dir="ltr" />
          <Input label={t('phone')} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} dir="ltr" />
          <Input
            label={t('openingBalance')}
            type="number"
            min="0"
            step="0.01"
            value={form.openingBalance}
            error={errors.openingBalance}
            onChange={(e) => setForm({ ...form, openingBalance: e.target.value })}
            hint={t('openingBalance')}
          />
          <Input
            label={t('creditTerm')}
            type="number"
            min="0"
            step="1"
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

      {/* تسجيل دفعة / توزيع */}
      <Modal
        open={!!payTarget}
        onClose={() => setPayTarget(null)}
        title={`${t('collectPayment')} — ${payTarget?.name ?? ''}`}
        size="md"
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
            </div>
            <div className="flex items-end gap-2">
              <Input
                label={t('paymentAmount')}
                required
                type="number"
                min="0"
                step="0.01"
                value={payAmount}
                onChange={(e) => setPayAmount(e.target.value)}
                placeholder={String(payTarget.balance)}
                className="flex-1"
              />
              <Button
                variant="secondary"
                size="md"
                onClick={() => setPayAmount(String(payTarget.balance))}
              >
                {t('payAll')}
              </Button>
            </div>
            <Select label={t('paymentMethodLabel')} value={payMethod} onChange={(e) => setPayMethod(e.target.value as 'cash' | 'bank')}>
              <option value="cash">{t('cash')}</option>
              <option value="bank">{t('bank')}</option>
            </Select>

            <div>
              <p className="mb-1.5 text-xs font-semibold text-slate-600 dark:text-slate-300">
                {t('allocate')} — {formatMoney(selectedTotal, settings.currency)}
              </p>
              <div className="max-h-52 space-y-1 overflow-y-auto rounded-lg border border-slate-200 p-2 dark:border-slate-700">
                {openDebts === null ? (
                  <SkeletonRows rows={3} cols={2} />
                ) : openDebts.length === 0 ? (
                  <p className="py-2 text-center text-xs text-slate-400">{t('noTransactions')}</p>
                ) : (
                  openDebts.map((d) => (
                    <label
                      key={d.id}
                      className="flex cursor-pointer items-center justify-between gap-2 rounded-md px-1.5 py-1 text-[11px] hover:bg-slate-50 dark:hover:bg-slate-800"
                    >
                      <span className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={selectedDebts.includes(d.id)}
                          onChange={(e) =>
                            setSelectedDebts((prev) =>
                              e.target.checked ? [...prev, d.id] : prev.filter((id) => id !== d.id),
                            )
                          }
                          className="h-3.5 w-3.5 rounded border-slate-300 text-brand-600"
                        />
                        <span className="font-semibold text-slate-600 dark:text-slate-300">
                          {d.kind === 'opening' ? t('openingBalance') : d.number}
                        </span>
                        <span className="text-slate-400">{formatDate(d.date, lang)}</span>
                      </span>
                      <span className="font-mono font-bold text-slate-600 dark:text-slate-300" dir="ltr">
                        {formatMoney(d.remaining, settings.currency)}
                      </span>
                    </label>
                  ))
                )}
              </div>
              <p className="mt-1 text-[10px] text-slate-400">
                {t('debtCollection')} · {t('notRevenue')}
              </p>
            </div>

            <Textarea label={t('notes')} value={payNotes} onChange={(e) => setPayNotes(e.target.value)} />
          </div>
        )}
      </Modal>

      {/* كشف حساب */}
      <Modal
        open={!!statementFor}
        onClose={() => setStatementFor(null)}
        title={`${t('statement')} — ${statementFor?.name ?? ''}`}
        size="xl"
        footer={
          <>
            <Button variant="secondary" icon={<Wallet size={15} />} onClick={() => statementFor && void openPayments(statementFor)}>
              {t('recentPayments')}
            </Button>
            <Button variant="secondary" icon={<Download size={15} />} onClick={exportStatement}>
              {t('exportCsv')}
            </Button>
            <Button onClick={() => setStatementFor(null)}>{t('close')}</Button>
          </>
        }
      >
        <div className="mb-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
          <Input label={t('statementFrom')} type="date" value={rangeFrom} onChange={(e) => setRangeFrom(e.target.value)} />
          <Input label={t('statementTo')} type="date" value={rangeTo} onChange={(e) => setRangeTo(e.target.value)} />
        </div>
        {statement === null ? (
          <SkeletonRows rows={5} cols={4} />
        ) : (filteredStatement ?? []).length === 0 ? (
          <EmptyState icon={<Wallet size={24} />} title={t('noData')} hint={t('emptyHint')} />
        ) : (
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th>{t('date')}</th>
                  <th>{t('details')}</th>
                  <th className="th-numeric">{t('debit')}</th>
                  <th className="th-numeric">{t('credit')}</th>
                  <th className="th-numeric">{t('runningBalance')}</th>
                </tr>
              </thead>
              <tbody>
                {(filteredStatement ?? []).map((e, i) => (
                  <tr key={`${e.refId}-${i}`}>
                    <td className="whitespace-nowrap text-xs text-slate-500">{formatDateTime(e.date, lang)}</td>
                    <td>
                      <span className="text-xs font-semibold">{e.label}</span>
                      <span className="ms-1.5 text-[11px] text-slate-400" dir="ltr">
                        {e.reference}
                      </span>
                      {e.items && e.items.length > 0 && (
                        <p className="mt-0.5 text-[10px] leading-relaxed text-slate-400">
                          {e.items
                            .map((it) => `${it.name} × ${it.quantity}${it.unit ? ` ${it.unit}` : ''}`)
                            .join('، ')}
                        </p>
                      )}
                    </td>
                    <td className="td-numeric">
                      {e.debit > 0 && <span className="text-rose-500">+{formatMoney(e.debit)}</span>}
                    </td>
                    <td className="td-numeric">
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
        title={`${t('recentPayments')} — ${paymentsFor?.name ?? ''}`}
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
                <Badge tone="green">{t('collectPayment')}</Badge>
              </li>
            ))}
          </ul>
        )}
      </Modal>
    </div>
  );
}
