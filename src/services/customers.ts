/** خدمة العملاء وحساباتهم */
import type { Customer, CustomerPayment, Invoice } from '../types';
import { deleteItem, getAll, getDB, putItem } from './db';
import { uid } from '../utils/id';
import { addMoney, subMoney, sumMoney } from '../utils/money';

export type CustomerInput = Omit<Customer, 'id' | 'createdAt' | 'updatedAt'>;

export async function listCustomers(): Promise<Customer[]> {
  const items = await getAll<Customer>('customers');
  return items.sort((a, b) => a.name.localeCompare(b.name));
}

export async function createCustomer(input: CustomerInput): Promise<Customer> {
  const now = Date.now();
  const customer: Customer = { ...input, id: uid('cus'), createdAt: now, updatedAt: now };
  await putItem('customers', customer);
  return customer;
}

export async function updateCustomer(id: string, patch: Partial<CustomerInput>): Promise<Customer> {
  const db = await getDB();
  const existing = await db.get('customers', id);
  if (!existing) throw new Error('CUSTOMER_NOT_FOUND');
  const updated = { ...existing, ...patch, id, updatedAt: Date.now() };
  await putItem('customers', updated);
  return updated;
}

export async function deleteCustomer(id: string): Promise<void> {
  await deleteItem('customers', id);
}

/**
 * رصيد العميل المستحق = مجموع المتبقي في فواتيره غير المسددة/غير الملغاة
 * (التحصيل يخصم من المتبقي ولا يُعد دخلًا جديدًا — الدخل سُجّل عند البيع).
 */
export async function getCustomerBalance(customerId: string): Promise<number> {
  const db = await getDB();
  const invoices = (await db.getAllFromIndex('invoices', 'by-customer', customerId)) as Invoice[];
  return sumMoney(invoices.filter((i) => i.status !== 'cancelled').map((i) => i.remaining));
}

export interface CustomerRow extends Customer {
  balance: number;
  invoiceCount: number;
  totalPurchases: number;
}

export async function listCustomersWithBalance(): Promise<CustomerRow[]> {
  const [customers, invoices] = await Promise.all([
    getAll<Customer>('customers'),
    getAll<Invoice>('invoices'),
  ]);
  const active = invoices.filter((i) => i.status !== 'cancelled');
  return customers
    .map((c) => {
      const mine = active.filter((i) => i.customerId === c.id);
      return {
        ...c,
        balance: sumMoney(mine.map((i) => i.remaining)),
        invoiceCount: mine.length,
        totalPurchases: sumMoney(mine.map((i) => i.total)),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export interface CustomerStatementEntry {
  date: number;
  kind: 'invoice' | 'payment' | 'adjustment';
  label: string;
  reference: string;
  debit: number; // فاتورة/دين جديد
  credit: number; // دفعة
  balanceAfter: number;
  refId: string;
}

/** كشف حساب العميل: فواتير + مدفوعات مرتبة زمنيًا مع الرصيد الجاري */
export async function getCustomerStatement(customerId: string): Promise<CustomerStatementEntry[]> {
  const db = await getDB();
  const [invoices, payments] = await Promise.all([
    db.getAllFromIndex('invoices', 'by-customer', customerId),
    db.getAllFromIndex('customerPayments', 'by-customer', customerId),
  ]);
  const events: { date: number; kind: 'invoice' | 'payment'; debit: number; credit: number; label: string; reference: string; refId: string; sort: number }[] = [];
  for (const inv of invoices as Invoice[]) {
    events.push({
      date: inv.date,
      kind: 'invoice',
      debit: inv.total,
      credit: 0,
      label: 'فاتورة بيع',
      reference: inv.number,
      refId: inv.id,
      sort: 1,
    });
    // مرتجع/إلغاء يُخصم من الرصيد عبر دمجه كعدم وجود الفاتورة — نعامله لاحقًا بالفلترة
  }
  for (const p of payments as CustomerPayment[]) {
    events.push({
      date: p.date,
      kind: 'payment',
      debit: 0,
      credit: p.amount,
      label: 'دفعة',
      reference: p.notes || '—',
      refId: p.id,
      sort: 2,
    });
  }
  events.sort((a, b) => a.date - b.date || a.sort - b.sort);
  let balance = 0;
  return events.map((e) => {
    balance = addMoney(balance, subMoney(e.debit, e.credit));
    return { ...e, balanceAfter: balance };
  });
}

export async function listCustomerPayments(customerId?: string): Promise<CustomerPayment[]> {
  const items = await getAll<CustomerPayment>('customerPayments');
  const filtered = customerId ? items.filter((p) => p.customerId === customerId) : items;
  return filtered.sort((a, b) => b.date - a.date);
}
