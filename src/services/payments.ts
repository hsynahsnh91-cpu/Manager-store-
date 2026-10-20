/**
 * خدمة مدفوعات العملاء (تحصيل الديون).
 *
 * تسجيل الدفعة:
 * - يخصم من المتبقي على الفواتير **وسجلات البيع الآجلة** (الأقدم أولًا أو المحدد).
 * - يُنشئ حركة صندوق واردة.
 * - لا يُعد دخلًا — الدخل سُجّل عند البيع، والتحصيل مجرد تحويل من «ديون» إلى «نقد».
 * - clientToken يمنع تكرار الدفعة عند النقر المزدوج.
 */
import type { CashTransaction, CustomerPayment, Invoice, ManualSale } from '../types';
import { getDB, getAll } from './db';
import { uid } from '../utils/id';
import { addMoney, round2, subMoney, sumMoney } from '../utils/money';

export class PaymentError extends Error {
  public code: 'NO_CUSTOMER' | 'INVALID_AMOUNT' | 'NO_OUTSTANDING' | 'INVOICE_NOT_FOUND' | 'DUPLICATE';
  constructor(
    code: 'NO_CUSTOMER' | 'INVALID_AMOUNT' | 'NO_OUTSTANDING' | 'INVOICE_NOT_FOUND' | 'DUPLICATE',
  ) {
    super(code);
    this.name = 'PaymentError';
    this.code = code;
  }
}

export interface PaymentAllocation {
  invoiceId?: string;
  manualSaleId?: string;
  amount: number;
}

export interface RecordCustomerPaymentInput {
  customerId: string;
  customerName: string;
  amount: number;
  method: CustomerPayment['method'];
  notes?: string;
  date?: number;
  specificInvoiceIds?: string[];
  specificManualSaleIds?: string[];
  /** توزيع صريح لمبالغ على فواتير/سجلات محددة */
  allocations?: PaymentAllocation[];
  clientToken?: string;
}

/** المتبقي على سجل بيع يدوي */
export function manualSaleRemaining(sale: ManualSale): number {
  return Math.max(0, round2(sale.total - sale.paid));
}

export async function recordCustomerPayment(
  input: RecordCustomerPaymentInput,
): Promise<CustomerPayment> {
  const amount = round2(input.amount);
  if (!Number.isFinite(amount) || amount <= 0) throw new PaymentError('INVALID_AMOUNT');
  if (!input.customerId) throw new PaymentError('NO_CUSTOMER');

  const db = await getDB();
  if (input.clientToken) {
    const duplicate = await db
      .getFromIndex('customerPayments', 'by-token', input.clientToken)
      .catch(() => undefined);
    if (duplicate) return duplicate;
  }

  const tx = db.transaction(['invoices', 'manualSales', 'customers', 'customerPayments', 'cash'], 'readwrite');
  try {
    const invoiceStore = tx.objectStore('invoices');
    const manualStore = tx.objectStore('manualSales');
    const customerStore = tx.objectStore('customers');
    const customer = await customerStore.get(input.customerId);
    const openingRemaining = Math.max(
      0,
      Math.round(((customer?.openingBalance ?? 0) - (customer?.openingBalancePaid ?? 0)) * 100) / 100,
    );

    const allInvoices = (await invoiceStore.getAll()) as Invoice[];
    const allManual = (await manualStore.getAll()) as ManualSale[];

    const invoiceTargets = allInvoices
      .filter(
        (i) =>
          i.status !== 'cancelled' &&
          i.remaining > 0 &&
          i.customerId === input.customerId &&
          (input.specificInvoiceIds ? input.specificInvoiceIds.includes(i.id) : true),
      )
      .sort((a, b) => a.date - b.date);
    const manualTargets = allManual
      .filter(
        (m) =>
          m.customerId === input.customerId &&
          manualSaleRemaining(m) > 0 &&
          (input.specificManualSaleIds ? input.specificManualSaleIds.includes(m.id) : true),
      )
      .sort((a, b) => a.date - b.date);

    const explicitSelection = Boolean(input.specificInvoiceIds?.length || input.specificManualSaleIds?.length);
    const targetTotal = addMoney(
      sumMoney(invoiceTargets.map((t) => t.remaining)),
      sumMoney(manualTargets.map(manualSaleRemaining)),
    );
    const outstanding = explicitSelection ? targetTotal : addMoney(openingRemaining, targetTotal);
    if (outstanding <= 0) throw new PaymentError('NO_OUTSTANDING');

    const applied = Math.min(amount, outstanding);
    let left = applied;
    const touchedInvoices: string[] = [];
    const touchedManual: string[] = [];
    let openingApplied = 0;

    // 0) الرصيد السابق يُسدد أولًا (أقدم دين) — إلا عند توزيع صريح
    const explicit = Boolean(input.allocations?.length || explicitSelection);
    if (openingRemaining > 0 && !explicit) {
      openingApplied = Math.min(left, openingRemaining);
      if (openingApplied > 0) {
        await customerStore.put({
          ...customer!,
          openingBalancePaid: addMoney(customer?.openingBalancePaid ?? 0, openingApplied),
          updatedAt: Date.now(),
        });
        left = subMoney(left, openingApplied);
      }
    }

    // 1) توزيع صريح عند اختيار المستخدم
    if (input.allocations?.length) {
      for (const alloc of input.allocations) {
        if (left <= 0) break;
        const share = Math.min(round2(alloc.amount), left);
        if (!(share > 0)) continue;
        if (alloc.invoiceId) {
          const inv = invoiceTargets.find((t) => t.id === alloc.invoiceId);
          if (!inv || touchedInvoices.includes(inv.id)) continue;
          const slice = Math.min(share, inv.remaining);
          await applyToInvoice(invoiceStore, inv, slice);
          touchedInvoices.push(inv.id);
          left = subMoney(left, slice);
        } else if (alloc.manualSaleId) {
          const sale = manualTargets.find((t) => t.id === alloc.manualSaleId);
          if (!sale || touchedManual.includes(sale.id)) continue;
          const slice = Math.min(share, manualSaleRemaining(sale));
          await applyToManualSale(manualStore, sale, slice);
          touchedManual.push(sale.id);
          left = subMoney(left, slice);
        }
      }
    }

    // 2) الباقي (أو الكل) على الأقدم أولًا — فواتير ثم سجلات يدوية بترتيب التاريخ
    // لا يتسرّب المبلغ إلى فواتير غير مختارة عند تحديد فواتير/سجلات صريحة
    const merged = explicit
      ? []
      : [
          ...invoiceTargets.map((t) => ({ kind: 'invoice' as const, date: t.date, id: t.id })),
          ...manualTargets.map((t) => ({ kind: 'manual' as const, date: t.date, id: t.id })),
        ].sort((a, b) => a.date - b.date);
    for (const target of merged) {
      if (left <= 0) break;
      if (target.kind === 'invoice') {
        const inv = await invoiceStore.get(target.id);
        if (!inv || inv.remaining <= 0) continue;
        const slice = Math.min(left, inv.remaining);
        await applyToInvoice(invoiceStore, inv, slice);
        if (!touchedInvoices.includes(inv.id)) touchedInvoices.push(inv.id);
        left = subMoney(left, slice);
      } else {
        const sale = await manualStore.get(target.id);
        if (!sale) continue;
        const remaining = manualSaleRemaining(sale);
        if (remaining <= 0) continue;
        const slice = Math.min(left, remaining);
        await applyToManualSale(manualStore, sale, slice);
        if (!touchedManual.includes(sale.id)) touchedManual.push(sale.id);
        left = subMoney(left, slice);
      }
    }

    const now = input.date ?? Date.now();
    const payment: CustomerPayment = {
      id: uid('cpay'),
      date: now,
      customerId: input.customerId,
      customerName: input.customerName,
      invoiceIds: touchedInvoices,
      manualSaleIds: touchedManual,
      amount: applied,
      method: input.method,
      notes: input.notes ?? '',
      createdAt: Date.now(),
      clientToken: input.clientToken,
      openingApplied,
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
    void tx.done.catch(() => {
      /* مُعالَج: رفض مقصود بعد الإلغاء */
    });
    throw err;
  }
}

async function applyToInvoice(
  store: { put: (v: Invoice) => Promise<unknown>; get: (id: string) => Promise<Invoice | undefined> },
  invoice: Invoice,
  slice: number,
): Promise<void> {
  const current = (await store.get(invoice.id)) ?? invoice;
  const newPaid = addMoney(current.paid, slice);
  const newRemaining = subMoney(current.remaining, slice);
  await store.put({
    ...current,
    paid: newPaid,
    remaining: newRemaining,
    status: newRemaining <= 0 ? 'paid' : 'partial',
  });
}

async function applyToManualSale(
  store: { put: (v: ManualSale) => Promise<unknown>; get: (id: string) => Promise<ManualSale | undefined> },
  sale: ManualSale,
  slice: number,
): Promise<void> {
  const current = (await store.get(sale.id)) ?? sale;
  const paid = Math.min(current.total, addMoney(current.paid, slice));
  await store.put({
    ...current,
    paid,
    updatedAt: Date.now(),
  });
}

export async function listCustomerPaymentsAll(): Promise<CustomerPayment[]> {
  const items = await getAll<CustomerPayment>('customerPayments');
  return items.sort((a, b) => b.date - a.date);
}
