import { useMemo, useState } from 'react';
import { ArrowDownLeft, ArrowRightLeft, ArrowUpRight, Wallet } from 'lucide-react';
import type { CashAccount, CashTransaction } from '../../types';
import { deposit, getBalances, listCashTransactions, transfer, withdraw, deleteCashTransaction } from '../../services/cash';
import { useAsync } from '../../hooks/useAsync';
import { useApp } from '../../context/AppContext';
import { useI18n } from '../../i18n';
import { Button } from '../../components/Button';
import { Input, Select, Textarea } from '../../components/Form';
import { ConfirmDialog, Modal } from '../../components/Modal';
import { Badge, EmptyState, SkeletonRows, StatCard } from '../../components/UI';
import { formatDateTime } from '../../utils/dates';
import { formatMoney, round2 } from '../../utils/money';

type ActionKind = 'deposit' | 'withdraw' | 'transfer' | null;

export function CashPage() {
  const { t, lang } = useI18n();
  const { settings, toast } = useApp();
  const balances = useAsync(() => getBalances(), []);
  const txs = useAsync(() => listCashTransactions(), []);

  const [action, setAction] = useState<ActionKind>(null);
  const [amountStr, setAmountStr] = useState('');
  const [account, setAccount] = useState<CashAccount>('cash');
  const [transferFrom, setTransferFrom] = useState<CashAccount>('cash');
  const [transferTo, setTransferTo] = useState<CashAccount>('bank');
  const [desc, setDesc] = useState('');
  const [busy, setBusy] = useState(false);
  const [typeFilter, setTypeFilter] = useState<'all' | CashTransaction['type']>('all');
  const [deleteTarget, setDeleteTarget] = useState<CashTransaction | null>(null);

  const list = useMemo(() => {
    const items = txs.data ?? [];
    if (typeFilter === 'all') return items;
    return items.filter((x) => x.type === typeFilter);
  }, [txs.data, typeFilter]);

  const totals = useMemo(() => {
    const items = txs.data ?? [];
    let inflowSum = 0;
    let outflowSum = 0;
    for (const x of items) {
      if (x.type === 'in') inflowSum += x.amount;
      else if (x.type === 'out') outflowSum += x.amount;
    }
    return { inflow: round2(inflowSum), outflow: round2(outflowSum) };
  }, [txs.data]);

  const reset = () => {
    setAmountStr('');
    setDesc('');
    setAccount('cash');
    setTransferFrom('cash');
    setTransferTo('bank');
  };

  const submit = async () => {
    const amount = round2(Number(amountStr));
    if (!Number.isFinite(amount) || amount <= 0) {
      toast(t('required'), 'error');
      return;
    }
    if (action === 'transfer' && transferFrom === transferTo) {
      toast(t('error'), 'error');
      return;
    }
    setBusy(true);
    try {
      if (action === 'deposit') await deposit({ amount, account, description: desc.trim() || t('deposit') });
      else if (action === 'withdraw') await withdraw({ amount, account, description: desc.trim() || t('withdrawal') });
      else if (action === 'transfer')
        await transfer({ amount, from: transferFrom, to: transferTo, description: desc.trim() || t('transfer') });
      toast(t('success'));
      setAction(null);
      reset();
      balances.reload();
      txs.reload();
    } catch {
      toast(t('error'), 'error');
    } finally {
      setBusy(false);
    }
  };

  const typeLabel = (x: CashTransaction) => {
    if (x.type === 'transfer') return t('transfer');
    return `${x.type === 'in' ? '↓' : '↑'} ${x.category}`;
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-extrabold text-slate-800 dark:text-white">{t('cashTitle')}</h1>
          <p className="mt-0.5 text-xs text-slate-400">{t('transferHint')}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="success" icon={<ArrowDownLeft size={15} />} onClick={() => setAction('deposit')}>
            {t('deposit')}
          </Button>
          <Button size="sm" variant="secondary" icon={<ArrowUpRight size={15} />} onClick={() => setAction('withdraw')}>
            {t('withdrawal')}
          </Button>
          <Button size="sm" icon={<ArrowRightLeft size={15} />} onClick={() => setAction('transfer')}>
            {t('transfer')}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          title={t('cashBalance')}
          amount={balances.data?.cash ?? 0}
          icon={<Wallet size={19} />}
          accent="emerald"
          loading={balances.loading}
        />
        <StatCard
          title={t('bankBalance')}
          amount={balances.data?.bank ?? 0}
          icon={<ArrowRightLeft size={19} />}
          accent="brand"
          loading={balances.loading}
        />
        <StatCard
          title={t('totalBalance')}
          amount={balances.data?.total ?? 0}
          icon={<Wallet size={19} />}
          accent="violet"
          loading={balances.loading}
        />
        <StatCard
          title={`${t('inflow')} / ${t('outflow')}`}
          value={`${formatMoney(totals.inflow)} / ${formatMoney(totals.outflow)}`}
          icon={<ArrowDownLeft size={19} />}
          accent="amber"
          loading={txs.loading}
        />
      </div>

      <div className="card flex flex-wrap items-center gap-2 p-3">
        <span className="text-xs font-bold text-slate-500">{t('cashFlow')}:</span>
        {(['all', 'in', 'out', 'transfer'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setTypeFilter(f)}
            className={`rounded-lg px-3 py-1.5 text-xs font-bold transition-colors ${
              typeFilter === f
                ? 'bg-brand-600 text-white'
                : 'bg-slate-100 text-slate-500 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-400'
            }`}
          >
            {f === 'all' ? t('all') : f === 'in' ? t('inflow') : f === 'out' ? t('outflow') : t('transfer')}
          </button>
        ))}
      </div>

      <div className="card overflow-hidden">
        {txs.loading ? (
          <SkeletonRows rows={7} cols={4} />
        ) : list.length === 0 ? (
          <EmptyState icon={<Wallet size={26} />} title={t('noCash')} hint={t('noCashHint')} />
        ) : (
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th>{t('date')}</th>
                  <th>{t('description')}</th>
                  <th>{t('expenseCategory')}</th>
                  <th>{t('cashAccount')} / {t('bankAccount')}</th>
                  <th className="th-numeric">{t('amount')}</th>
                  <th className="text-end">{t('actions')}</th>
                </tr>
              </thead>
              <tbody>
                {list.map((x) => (
                  <tr key={x.id}>
                    <td className="whitespace-nowrap text-xs text-slate-500">{formatDateTime(x.date, lang)}</td>
                    <td className="max-w-[260px] truncate text-xs font-semibold">{x.description}</td>
                    <td>
                      <Badge tone={x.type === 'in' ? 'green' : x.type === 'out' ? 'rose' : 'blue'}>{typeLabel(x)}</Badge>
                    </td>
                    <td className="text-xs text-slate-500">
                      {x.type === 'transfer'
                        ? `${t(x.transferFrom === 'cash' ? 'cashAccount' : 'bankAccount')} → ${t(x.transferTo === 'cash' ? 'cashAccount' : 'bankAccount')}`
                        : t(x.account === 'cash' ? 'cashAccount' : 'bankAccount')}
                    </td>
                    <td className={`td-numeric font-bold ${x.type === 'in' ? 'text-emerald-600' : x.type === 'out' ? 'text-rose-600' : 'text-slate-500'}`}>
                      {x.type === 'in' ? '+' : x.type === 'out' ? '−' : '⇄ '}
                      {formatMoney(x.amount, settings.currency)}
                    </td>
                    <td className="text-end">
                      {x.refType === 'manual' ? (
                        <button
                          onClick={() => setDeleteTarget(x)}
                          className="rounded px-2 py-1 text-[11px] font-bold text-slate-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950"
                        >
                          {t('delete')}
                        </button>
                      ) : (
                        <span className="text-[10px] text-slate-300 dark:text-slate-600">{x.refType}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* نموذج الحركة */}
      <Modal
        open={action !== null}
        onClose={() => setAction(null)}
        title={action === 'deposit' ? t('deposit') : action === 'withdraw' ? t('withdrawal') : t('transfer')}
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setAction(null)}>
              {t('cancel')}
            </Button>
            <Button loading={busy} onClick={submit}>
              {t('confirm')}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Input
            label={t('amount')}
            required
            type="number"
            min="0"
            step="0.01"
            value={amountStr}
            onChange={(e) => setAmountStr(e.target.value)}
          />
          {action === 'transfer' ? (
            <>
              <Select label={t('transferFrom')} value={transferFrom} onChange={(e) => setTransferFrom(e.target.value as CashAccount)}>
                <option value="cash">{t('cashAccount')}</option>
                <option value="bank">{t('bankAccount')}</option>
              </Select>
              <Select label={t('transferTo')} value={transferTo} onChange={(e) => setTransferTo(e.target.value as CashAccount)}>
                <option value="cash">{t('cashAccount')}</option>
                <option value="bank">{t('bankAccount')}</option>
              </Select>
              <p className="rounded-lg bg-brand-50 px-3 py-2 text-[11px] text-brand-700 dark:bg-brand-950 dark:text-brand-300">
                {t('transferHint')}
              </p>
            </>
          ) : (
            <Select label={t('cashAccount')} value={account} onChange={(e) => setAccount(e.target.value as CashAccount)}>
              <option value="cash">{t('cashAccount')}</option>
              <option value="bank">{t('bankAccount')}</option>
            </Select>
          )}
          <Textarea label={t('description')} value={desc} onChange={(e) => setDesc(e.target.value)} />
        </div>
      </Modal>

      <ConfirmDialog
        open={!!deleteTarget}
        title={t('delete')}
        message={`${t('deleteConfirm')} — ${formatMoney(deleteTarget?.amount ?? 0, settings.currency)}`}
        danger
        onCancel={() => setDeleteTarget(null)}
        onConfirm={async () => {
          if (!deleteTarget) return;
          try {
            await deleteCashTransaction(deleteTarget.id);
            toast(t('success'));
            balances.reload();
            txs.reload();
          } catch {
            toast(t('error'), 'error');
          }
          setDeleteTarget(null);
        }}
      />
    </div>
  );
}
