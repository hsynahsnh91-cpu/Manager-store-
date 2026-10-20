/** خدمة المصروفات — تسجيل يُقيد في الصندوق تلقائيًا */
import type { CashTransaction, Expense } from '../types';
import { getAll, getDB } from './db';
import { uid } from '../utils/id';

export type ExpenseInput = Omit<Expense, 'id' | 'createdAt'>;

export async function listExpenses(): Promise<Expense[]> {
  const items = await getAll<Expense>('expenses');
  return items.sort((a, b) => b.date - a.date || b.createdAt - a.createdAt);
}

export async function createExpense(input: ExpenseInput): Promise<Expense> {
  const amount = Math.round((input.amount ?? 0) * 100) / 100;
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('INVALID_AMOUNT');
  const db = await getDB();
  const now = Date.now();
  const expense: Expense = { ...input, amount, id: uid('exp'), createdAt: now };

  const tx = db.transaction(['expenses', 'cash'], 'readwrite');
  try {
    await tx.objectStore('expenses').put(expense);
    const cashRec: CashTransaction = {
      id: uid('csh'),
      date: expense.date,
      type: 'out',
      amount,
      account: expense.paymentMethod === 'bank' ? 'bank' : 'cash',
      category: expense.category,
      description: `مصروف: ${expense.category}${expense.description ? ` — ${expense.description}` : ''}`,
      refType: 'expense',
      refId: expense.id,
      createdAt: now,
    };
    await tx.objectStore('cash').put(cashRec);
    await tx.done;
    return expense;
  } catch (err) {
    try {
      tx.abort();
    } catch {
      /* noop */
    }
      void tx.done.catch(() => { /* مُعالَج: رفض مقصود بعد الإلغاء */ });
    throw err;
  }
}

export async function updateExpense(id: string, patch: Partial<ExpenseInput>): Promise<Expense> {
  const db = await getDB();
  const tx = db.transaction(['expenses', 'cash'], 'readwrite');
  try {
    const store = tx.objectStore('expenses');
    const existing = await store.get(id);
    if (!existing) throw new Error('EXPENSE_NOT_FOUND');
    const amount = patch.amount !== undefined ? Math.round(patch.amount * 100) / 100 : existing.amount;
    if (!Number.isFinite(amount) || amount <= 0) throw new Error('INVALID_AMOUNT');
    const updated: Expense = { ...existing, ...patch, amount, id };
    await store.put(updated);

    // مواءمة حركة الصندوق المرتبطة
    const cashStore = tx.objectStore('cash');
    const allCash = await cashStore.getAll();
    const linked = allCash.find((c) => c.refType === 'expense' && c.refId === id);
    if (linked) {
      await cashStore.put({
        ...linked,
        amount,
        date: updated.date,
        account: updated.paymentMethod === 'bank' ? 'bank' : 'cash',
        category: updated.category,
        description: `مصروف: ${updated.category}${updated.description ? ` — ${updated.description}` : ''}`,
      });
    } else {
      const cashRec: CashTransaction = {
        id: uid('csh'),
        date: updated.date,
        type: 'out',
        amount,
        account: updated.paymentMethod === 'bank' ? 'bank' : 'cash',
        category: updated.category,
        description: `مصروف: ${updated.category}${updated.description ? ` — ${updated.description}` : ''}`,
        refType: 'expense',
        refId: updated.id,
        createdAt: Date.now(),
      };
      await cashStore.put(cashRec);
    }
    await tx.done;
    return updated;
  } catch (err) {
    try {
      tx.abort();
    } catch {
      /* noop */
    }
      void tx.done.catch(() => { /* مُعالَج: رفض مقصود بعد الإلغاء */ });
    throw err;
  }
}

/** حذف مصروف: يزيل قيد الصندوق المرافق معه (تسجيل ملغى لا يؤثر على تاريخ آخر) */
export async function deleteExpense(id: string): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(['expenses', 'cash'], 'readwrite');
  try {
    await tx.objectStore('expenses').delete(id);
    const cashStore = tx.objectStore('cash');
    const allCash = await cashStore.getAll();
    for (const c of allCash) {
      if (c.refType === 'expense' && c.refId === id) {
        await cashStore.delete(c.id);
      }
    }
    await tx.done;
  } catch (err) {
    try {
      tx.abort();
    } catch {
      /* noop */
    }
      void tx.done.catch(() => { /* مُعالَج: رفض مقصود بعد الإلغاء */ });
    throw err;
  }
}
