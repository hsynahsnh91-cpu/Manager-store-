import { useMemo, useState } from 'react';
import { CreditCard, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import type { Expense } from '../../types';
import { createExpense, deleteExpense, listExpenses, updateExpense } from '../../services/expenses';
import { useAsync } from '../../hooks/useAsync';
import { useApp } from '../../context/AppContext';
import { useI18n } from '../../i18n';
import { Button } from '../../components/Button';
import { Input, Select, Textarea } from '../../components/Form';
import { ConfirmDialog, Modal } from '../../components/Modal';
import { EmptyState, SkeletonRows } from '../../components/UI';
import { formatDate } from '../../utils/dates';
import { formatMoney, round2 } from '../../utils/money';
import { startOfMonth, endOfMonth } from '../../utils/dates';
import { toDateInput, fromDateInput } from '../../utils/dates';

interface FormState {
  amount: string;
  category: string;
  date: string;
  paymentMethod: 'cash' | 'bank';
  description: string;
}

const emptyForm = (currency?: string): FormState => {
  void currency;
  return {
    amount: '',
    category: '',
    date: toDateInput(Date.now()),
    paymentMethod: 'cash',
    description: '',
  };
};

export function ExpensesPage() {
  const { t, lang } = useI18n();
  const { settings, toast } = useApp();
  const { data, loading, reload } = useAsync(() => listExpenses(), []);

  const [search, setSearch] = useState('');
  const [from, setFrom] = useState(toDateInput(startOfMonth(Date.now())));
  const [to, setTo] = useState(toDateInput(endOfMonth(Date.now())));
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Expense | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [errors, setErrors] = useState<{ amount?: string; category?: string }>({});
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Expense | null>(null);

  const expenses = data ?? [];

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const fromTs = fromDateInput(from);
    const toTs = fromDateInput(to) + 24 * 3600 * 1000 - 1;
    return expenses.filter((e) => {
      if (e.date < fromTs || e.date > toTs) return false;
      if (q && !`${e.category} ${e.description}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [expenses, search, from, to]);

  const total = useMemo(() => round2(filtered.reduce((a, e) => a + e.amount, 0)), [filtered]);

  const openAdd = () => {
    setEditing(null);
    setForm(emptyForm());
    setErrors({});
    setFormOpen(true);
  };

  const openEdit = (e: Expense) => {
    setEditing(e);
    setForm({
      amount: String(e.amount),
      category: e.category,
      date: toDateInput(e.date),
      paymentMethod: e.paymentMethod,
      description: e.description,
    });
    setErrors({});
    setFormOpen(true);
  };

  const submit = async () => {
    const amount = round2(Number(form.amount));
    const e: typeof errors = {};
    if (!Number.isFinite(amount) || amount <= 0) e.amount = t('required');
    if (!form.category.trim()) e.category = t('required');
    setErrors(e);
    if (Object.keys(e).length > 0) return;

    setSaving(true);
    try {
      const payload = {
        amount,
        category: form.category.trim(),
        date: fromDateInput(form.date),
        paymentMethod: form.paymentMethod,
        description: form.description.trim(),
      };
      if (editing) await updateExpense(editing.id, payload);
      else await createExpense(payload);
      toast(t('success'));
      setFormOpen(false);
      reload();
    } catch {
      toast(t('error'), 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-extrabold text-slate-800 dark:text-white">{t('expensesTitle')}</h1>
          <p className="mt-0.5 text-xs text-slate-400">
            {t('totalExpenses')}: {formatMoney(total, settings.currency)}
          </p>
        </div>
        <Button icon={<Plus size={16} />} onClick={openAdd}>
          {t('addExpense')}
        </Button>
      </div>

      <div className="card flex flex-wrap items-end gap-2 p-3">
        <div className="min-w-[180px] flex-1">
          <Input placeholder={t('searchExpenses')} value={search} onChange={(e) => setSearch(e.target.value)} icon={<Search size={15} />} />
        </div>
        <label className="text-xs font-semibold text-slate-500">
          {t('from')}
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="ms-2 h-10 rounded-lg border border-slate-300 bg-white px-2 text-xs dark:border-slate-600 dark:bg-slate-800"
          />
        </label>
        <label className="text-xs font-semibold text-slate-500">
          {t('to')}
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="ms-2 h-10 rounded-lg border border-slate-300 bg-white px-2 text-xs dark:border-slate-600 dark:bg-slate-800"
          />
        </label>
      </div>

      <div className="card overflow-hidden">
        {loading ? (
          <SkeletonRows rows={6} cols={5} />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={<CreditCard size={26} />}
            title={t('noExpenses')}
            hint={t('noExpensesHint')}
            action={
              <Button size="sm" icon={<Plus size={15} />} onClick={openAdd}>
                {t('addExpense')}
              </Button>
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th>{t('date')}</th>
                  <th>{t('expenseCategory')}</th>
                  <th>{t('description')}</th>
                  <th>{t('paymentMethod')}</th>
                  <th className="th-numeric">{t('amount')}</th>
                  <th className="text-end">{t('actions')}</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((e) => (
                  <tr key={e.id}>
                    <td className="text-xs text-slate-500">{formatDate(e.date, lang)}</td>
                    <td className="text-xs font-bold">{e.category}</td>
                    <td className="max-w-[240px] truncate text-xs text-slate-500">{e.description || '—'}</td>
                    <td>
                      <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-bold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                        {t(e.paymentMethod === 'bank' ? 'bank' : 'cash')}
                      </span>
                    </td>
                    <td className="td-numeric font-bold text-rose-600">{formatMoney(e.amount, settings.currency)}</td>
                    <td>
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => openEdit(e)}
                          className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800"
                          title={t('edit')}
                        >
                          <Pencil size={15} />
                        </button>
                        <button
                          onClick={() => setDeleteTarget(e)}
                          className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950"
                          title={t('delete')}
                        >
                          <Trash2 size={15} />
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

      {/* نموذج المصروف */}
      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editing ? t('edit') : t('addExpense')}
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
            label={t('amount')}
            required
            type="number"
            min="0"
            step="0.01"
            value={form.amount}
            error={errors.amount}
            onChange={(e) => setForm({ ...form, amount: e.target.value })}
          />
          <Select
            label={t('expenseCategory')}
            required
            value={form.category}
            error={errors.category}
            onChange={(e) => setForm({ ...form, category: e.target.value })}
            placeholder={t('none')}
          >
            {settings.expenseCategories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
          <Input label={t('date')} required type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
          <Select
            label={t('paymentMethod')}
            value={form.paymentMethod}
            onChange={(e) => setForm({ ...form, paymentMethod: e.target.value as 'cash' | 'bank' })}
          >
            <option value="cash">{t('cash')}</option>
            <option value="bank">{t('bank')}</option>
          </Select>
          <Textarea
            label={t('description')}
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            className="sm:col-span-2"
          />
        </div>
      </Modal>

      <ConfirmDialog
        open={!!deleteTarget}
        title={t('delete')}
        message={`${t('deleteConfirm')} — ${deleteTarget?.category ?? ''} (${formatMoney(deleteTarget?.amount ?? 0, settings.currency)})`}
        danger
        onCancel={() => setDeleteTarget(null)}
        onConfirm={async () => {
          if (!deleteTarget) return;
          try {
            await deleteExpense(deleteTarget.id);
            toast(t('success'));
            reload();
          } catch {
            toast(t('error'), 'error');
          }
          setDeleteTarget(null);
        }}
      />
    </div>
  );
}
