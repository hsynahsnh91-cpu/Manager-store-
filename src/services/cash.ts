/** خدمة الصندوق — حركة المقبوضات والمدفوعات والسحوبات والإيداعات والتحويلات */
import type { CashAccount, CashTransaction } from '../types';
import { getAll, getDB, putItem } from './db';
import { uid } from '../utils/id';
import { subMoney, sumMoney } from '../utils/money';

export interface CashBalances {
  cash: number;
  bank: number;
  total: number;
}

/**
 * الرصيد الحالي لكل حساب.
 * التحويل بين الحسابات يُخصم من حساب ويُضاف لآخر (صافي صفر) ولا يُعد دخلًا أو مصروفًا.
 */
export async function getBalances(): Promise<CashBalances> {
  const txs = await getAll<CashTransaction>('cash');
  return computeBalances(txs);
}

export function computeBalances(txs: CashTransaction[]): CashBalances {
  let cash = 0;
  let bank = 0;
  for (const t of txs) {
    if (t.type === 'in') {
      if (t.account === 'cash') cash += t.amount;
      else bank += t.amount;
    } else if (t.type === 'out') {
      if (t.account === 'cash') cash -= t.amount;
      else bank -= t.amount;
    } else if (t.type === 'transfer') {
      const from = t.transferFrom ?? 'cash';
      const to = t.transferTo ?? 'bank';
      if (from === 'cash') cash -= t.amount;
      else bank -= t.amount;
      if (to === 'cash') cash += t.amount;
      else bank += t.amount;
    }
  }
  return { cash: Math.round(cash * 100) / 100, bank: Math.round(bank * 100) / 100, total: Math.round((cash + bank) * 100) / 100 };
}

export async function listCashTransactions(): Promise<CashTransaction[]> {
  const items = await getAll<CashTransaction>('cash');
  return items.sort((a, b) => b.date - a.date || b.createdAt - a.createdAt);
}

/** إيداع في الصندوق */
export async function deposit(input: { amount: number; account: CashAccount; description: string; date?: number }): Promise<CashTransaction> {
  return manualTx({ type: 'in', amount: input.amount, account: input.account, category: 'إيداع', description: input.description, date: input.date });
}

/** سحب من الصندوق */
export async function withdraw(input: { amount: number; account: CashAccount; description: string; date?: number }): Promise<CashTransaction> {
  return manualTx({ type: 'out', amount: input.amount, account: input.account, category: 'سحب', description: input.description, date: input.date });
}

/** تحويل داخلي بين الحسابات — ليس دخلًا ولا مصروفًا */
export async function transfer(input: { amount: number; from: CashAccount; to: CashAccount; description: string; date?: number }): Promise<CashTransaction> {
  if (input.from === input.to) throw new Error('SAME_ACCOUNT');
  return manualTx({
    type: 'transfer',
    amount: input.amount,
    account: input.from,
    transferFrom: input.from,
    transferTo: input.to,
    category: 'تحويل',
    description: input.description,
    date: input.date,
  });
}

async function manualTx(p: {
  type: CashTransaction['type'];
  amount: number;
  account: CashAccount;
  transferFrom?: CashAccount;
  transferTo?: CashAccount;
  category: string;
  description: string;
  date?: number;
}): Promise<CashTransaction> {
  const amount = Math.round((p.amount ?? 0) * 100) / 100;
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('INVALID_AMOUNT');
  const now = Date.now();
  const rec: CashTransaction = {
    id: uid('csh'),
    date: p.date ?? now,
    type: p.type,
    amount,
    account: p.account,
    transferFrom: p.transferFrom,
    transferTo: p.transferTo,
    category: p.category,
    description: p.description,
    refType: 'manual',
    createdAt: now,
  };
  await putItem('cash', rec);
  return rec;
}

/** تعديل حركة يدوية (يُعدَّل وصفها فقط — المبالغ تخضع لقيود أقوى) */
export async function updateCashTransaction(rec: CashTransaction): Promise<void> {
  await putItem('cash', { ...rec, createdAt: rec.createdAt });
}

export async function deleteCashTransaction(id: string): Promise<void> {
  const db = await getDB();
  const rec = await db.get('cash', id);
  // لا نسمح بحذف حركات مرتبطة بعمليات (sale/payment/purchase/expense)
  if (rec && rec.refType && rec.refType !== 'manual') {
    throw new Error('LINKED_TRANSACTION');
  }
  await db.delete('cash', id);
}

export function inflow(txs: CashTransaction[]): number {
  return sumMoney(txs.filter((t) => t.type === 'in').map((t) => t.amount));
}

export function outflow(txs: CashTransaction[]): number {
  return sumMoney(txs.filter((t) => t.type === 'out').map((t) => t.amount));
}

export function netTransfer(txs: CashTransaction[]): number {
  return subMoney(
    sumMoney(txs.filter((t) => t.type === 'transfer' && t.transferTo === 'cash').map((t) => t.amount)),
    sumMoney(txs.filter((t) => t.type === 'transfer' && t.transferFrom === 'cash').map((t) => t.amount)),
  );
}
