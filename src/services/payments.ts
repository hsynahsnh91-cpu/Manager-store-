/**
 * خدمة مدفوعات العملاء (تحصيل الديون).
 * تسجيل الدفعة:
 * - يخصم من المتبقي على الفواتير (الأقدم أولًا أو فاتورة محددة).
 * - يُنشئ حركة صندوق واردة.
 * - لا يُعد دخلًا — الدخل سُجّل عند البيع.
 */
import type { CashTransaction, CustomerPayment, Invoice } from '../types';
import { getDB, getAll } from './db';
import { uid } from '../utils/id';
import { addMoney, round2, subMoney, sumMoney } from '../utils/money';

export class PaymentError extends Error {
  constructor(code: 'NO_CUSTOMER' | 'INVALID_AMOUNT' | 'NO_OUTSTANDING' | 'INVOICE_NOT_FOUND') {
    super(code);
    this.name = 'PaymentError';
  }
}

export async function recordCustomerPayment(input: {
  customerId: string;
  customerName: string;
  amount: number;
  method: CustomerPayment['method'];
  notes?: string;
  date?: number;
  specificInvoiceIds?: string[];
}): Promise<CustomerPayment> {
  const amount = round2(input.amount);
  if (!Number.isFinite(amount) || amount <= 0) throw new PaymentError('INVALID_AMOUNT');
  if (!input.customerId) throw new PaymentError('NO_CUSTOMER');

  const db = await getDB();
  const tx = db.transaction(['invoices', 'customerPayments', 'cash'], 'readwrite');
  try {
    const invoiceStore = tx.objectStore('invoices');
    const all = (await invoiceStore.getAll()) as Invoice[];
    const targets = all
      .filter(
        (i) =>
          i.status !== 'cancelled' &&
          i.remaining > 0 &&
          i.customerId === input.customerId &&
          (input.specificInvoiceIds ? input.specificInvoiceIds.includes(i.id) : true),
      )
      .sort((a, b) => a.date - b.date);

    const outstanding = sumMoney(targets.map((t) => t.remaining));
    if (outstanding <= 0) throw new PaymentError('NO_OUTSTANDING');
    const applied = Math.min(amount, outstanding);

    let left = applied;
    const touched: string[] = [];
    for (const t of targets) {
      if (left <= 0) break;
      const slice = Math.min(left, t.remaining);
      const newPaid = addMoney(t.paid, slice);
      const newRemaining = subMoney(t.remaining, slice);
      const updated: Invoice = {
        ...t,
        paid: newPaid,
        remaining: newRemaining,
        status: newRemaining <= 0 ? 'paid' : 'partial',
      };
      await invoiceStore.put(updated);
      touched.push(t.id);
      left = subMoney(left, slice);
    }

    const now = input.date ?? Date.now();
    const payment: CustomerPayment = {
      id: uid('cpay'),
      date: now,
      customerId: input.customerId,
      customerName: input.customerName,
      invoiceIds: touched,
      amount: applied,
      method: input.method,
      notes: input.notes ?? '',
      createdAt: Date.now(),
    };
    await tx.objectStore('customerPayments').put(payment);

    const cashRec: CashTransaction = {
      id: uid('csh'),
      date: now,
      type: 'in',
      amount: applied,
      account: input.method === 'bank' ? 'bank' : 'cash',
      category: 'تحصيل دين',
      description: `تحصيل من ${input.customerName}${payment.notes ? ` — ${payment.notes}` : ''}`,
      refType: 'payment',
      refId: payment.id,
      createdAt: Date.now(),
    };
    await tx.objectStore('cash').put(cashRec);

    await tx.done;
    return payment;
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

export async function listCustomerPaymentsAll(): Promise<CustomerPayment[]> {
  const items = await getAll<CustomerPayment>('customerPayments');
  return items.sort((a, b) => b.date - a.date);
}
