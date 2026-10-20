/** خدمة العملاء وحساباتهم — تشمل فواتير البيع وسجلات البيع اليدوي الآجلة */
import type { Customer, CustomerPayment, Invoice, ManualSale } from '../types';
import { deleteItem, getAll, getDB, putItem } from './db';
import { uid } from '../utils/id';
import { addMoney, mulCost, round2, subMoney, sumMoney } from '../utils/money';

export type CustomerInput = Omit<Customer, 'id' | 'createdAt' | 'updatedAt'>;

export async function listCustomers(): Promise<Customer[]> {
  const items = await getAll<Customer>('customers');
  return items.sort((a, b) => a.name.localeCompare(b.name));
}

export async function createCustomer(input: CustomerInput): Promise<Customer> {
  const now = Date.now();
  const customer: Customer = {
    ...input,
    openingBalance: Math.max(0, round2(input.openingBalance ?? 0)),
    id: uid('cus'),
    createdAt: now,
    updatedAt: now,
  };
  await putItem('customers', customer);
  return customer;
}

export async function updateCustomer(id: string, patch: Partial<CustomerInput>): Promise<Customer> {
  const db = await getDB();
  const existing = await db.get('customers', id);
  if (!existing) throw new Error('CUSTOMER_NOT_FOUND');
  const updated = {
    ...existing,
    ...patch,
    openingBalance:
      patch.openingBalance !== undefined ? Math.max(0, round2(patch.openingBalance)) : existing.openingBalance,
    id,
    updatedAt: Date.now(),
  };
  await putItem('customers', updated);
  return updated;
}

export async function deleteCustomer(id: string): Promise<void> {
  await deleteItem('customers', id);
}

/** المتبقي على سجل بيع يدوي */
export function manualSaleRemaining(sale: ManualSale): number {
  return Math.max(0, round2(sale.total - sale.paid));
}

/** المتبقي على فاتورة (غير ملغاة) */
export function invoiceRemaining(invoice: Invoice): number {
  return invoice.status === 'cancelled' ? 0 : Math.max(0, invoice.remaining);
}

/**
 * رصيد العميل المستحق = الرصيد السابق + متبقي الفواتير + متبقي السجلات الآجلة.
 * التحصيل يخصم من المتبقي ولا يُعد دخلًا جديدًا.
 */
export async function getCustomerBalance(customerId: string): Promise<number> {
  const db = await getDB();
  const [customer, invoices, allManual] = await Promise.all([
    db.get('customers', customerId),
    db.getAllFromIndex('invoices', 'by-customer', customerId) as Promise<Invoice[]>,
    getAll<ManualSale>('manualSales'),
  ]);
  const invoiceDebt = sumMoney(invoices.filter((i) => i.status !== 'cancelled').map((i) => i.remaining));
  const manualDebt = sumMoney(
    allManual.filter((m) => m.customerId === customerId).map(manualSaleRemaining),
  );
  const openingRemaining = Math.max(
    0,
    round2((customer?.openingBalance ?? 0) - (customer?.openingBalancePaid ?? 0)),
  );
  return addMoney(openingRemaining, invoiceDebt, manualDebt);
}

export interface CustomerRow extends Customer {
  balance: number;
  invoiceDebt: number;
  manualDebt: number;
  invoiceCount: number;
  manualSaleCount: number;
  totalPurchases: number;
  /** أيام أقدم دين غير مسدد — لتنبيه المتأخرات */
  oldestUnpaidDays: number;
  /** تاريخ آخر حركة (بيع أو دفعة) */
  lastActivity: number | null;
  /** تجاوز أيام السماح المتفق عليها مع العميل */
  overdue: boolean;
}

export async function listCustomersWithBalance(): Promise<CustomerRow[]> {
  const [customers, invoices, manualSales, payments] = await Promise.all([
    getAll<Customer>('customers'),
    getAll<Invoice>('invoices'),
    getAll<ManualSale>('manualSales'),
    getAll<CustomerPayment>('customerPayments'),
  ]);
  const active = invoices.filter((i) => i.status !== 'cancelled');
  const now = Date.now();
  const dayMs = 24 * 3600 * 1000;
  return customers
    .map((c) => {
      const myInvoices = active.filter((i) => i.customerId === c.id);
      const myManual = manualSales.filter((m) => m.customerId === c.id);
      const unpaidDates = [
        ...myInvoices.filter((i) => i.remaining > 0).map((i) => i.date),
        ...myManual.filter((m) => manualSaleRemaining(m) > 0).map((m) => m.date),
        ...((c.openingBalance ?? 0) > (c.openingBalancePaid ?? 0) ? [c.createdAt] : []),
      ];
      const oldest = unpaidDates.length > 0 ? Math.min(...unpaidDates) : null;
      const oldestUnpaidDays = oldest ? Math.floor((now - oldest) / dayMs) : 0;
      const openingRemaining = Math.max(0, round2((c.openingBalance ?? 0) - (c.openingBalancePaid ?? 0)));
      const balance = addMoney(
        openingRemaining,
        sumMoney(myInvoices.map((i) => i.remaining)),
        sumMoney(myManual.map(manualSaleRemaining)),
      );
      const myPayments = payments.filter((p) => p.customerId === c.id);
      const activity = [
        ...myInvoices.map((i) => i.date),
        ...myManual.map((m) => m.date),
        ...myPayments.map((p) => p.date),
      ];
      const invoiceDebt = sumMoney(myInvoices.map((i) => i.remaining));
      const manualDebt = sumMoney(myManual.map(manualSaleRemaining));
      return {
        ...c,
        balance,
        invoiceDebt,
        manualDebt,
        invoiceCount: myInvoices.length,
        manualSaleCount: myManual.length,
        totalPurchases: addMoney(
          sumMoney(myInvoices.map((i) => i.total)),
          sumMoney(myManual.map((m) => m.total)),
        ),
        oldestUnpaidDays,
        lastActivity: activity.length > 0 ? Math.max(...activity) : null,
        overdue: oldest !== null && c.creditDays > 0 && oldestUnpaidDays > c.creditDays,
      };
    })
    .sort((a, b) => b.balance - a.balance || a.name.localeCompare(b.name));
}

export interface CustomerStatementEntry {
  date: number;
  kind: 'opening' | 'invoice' | 'manualSale' | 'payment' | 'adjustment';
  label: string;
  reference: string;
  debit: number; // دين جديد
  credit: number; // دفعة
  balanceAfter: number;
  refId: string;
  /** المواد المشتراة إن وُجدت */
  items?: { name: string; quantity: number; unit?: string; unitPrice: number; total: number }[];
  method?: string;
}

/** كشف حساب العميل: رصيد سابق + فواتير + سجلات يدوية + مدفوعات مرتبة زمنيًا */
export async function getCustomerStatement(customerId: string): Promise<CustomerStatementEntry[]> {
  const db = await getDB();
  const [customer, invoices, manualSales, payments] = await Promise.all([
    db.get('customers', customerId),
    db.getAllFromIndex('invoices', 'by-customer', customerId) as Promise<Invoice[]>,
    getAll<ManualSale>('manualSales'),
    db.getAllFromIndex('customerPayments', 'by-customer', customerId) as Promise<CustomerPayment[]>,
  ]);

  const events: (CustomerStatementEntry & { sort: number })[] = [];

  if ((customer?.openingBalance ?? 0) > 0) {
    events.push({
      date: customer!.createdAt,
      kind: 'opening',
      label: 'رصيد سابق',
      reference: '—',
      debit: customer!.openingBalance ?? 0,
      credit: 0,
      balanceAfter: 0,
      refId: `${customerId}_opening`,
      sort: -1,
    });
  }

  for (const inv of invoices) {
    if (inv.status === 'cancelled') continue;
    events.push({
      date: inv.date,
      kind: 'invoice',
      label: 'فاتورة بيع',
      reference: inv.number,
      debit: inv.subtotal,
      credit: 0,
      balanceAfter: 0,
      refId: inv.id,
      sort: 1,
      items: inv.items.map((i) => ({
        name: i.name,
        quantity: i.quantity,
        unit: i.unit,
        unitPrice: i.unitPrice,
        total: i.lineTotal,
      })),
    });
    const discount = inv.discount;
    if (discount > 0) {
      events.push({
        date: inv.date,
        kind: 'adjustment',
        label: 'خصم',
        reference: inv.number,
        debit: 0,
        credit: discount,
        balanceAfter: 0,
        refId: `${inv.id}_discount`,
        sort: 1,
      });
    }
    if ((inv.initialPaid ?? 0) > 0) {
      events.push({
        date: inv.date,
        kind: 'payment',
        label: 'مدفوع وقت البيع',
        reference: inv.number,
        debit: 0,
        credit: inv.initialPaid,
        balanceAfter: 0,
        refId: `${inv.id}_init`,
        sort: 1,
      });
    }
  }

  const activeInvoiceIds = new Set(invoices.filter((i) => i.status !== 'cancelled').map((i) => i.id));
  const activeManualIds = new Set(manualSales.filter((m) => m.customerId === customerId).map((m) => m.id));

  for (const sale of manualSales) {
    if (sale.customerId !== customerId) continue;
    events.push({
      date: sale.date,
      kind: 'manualSale',
      label: sale.paymentMethod === 'credit' ? 'بيع آجل (سجل يدوي)' : 'بيع يدوي',
      reference: sale.number,
      debit: sale.total,
      credit: 0,
      balanceAfter: 0,
      refId: sale.id,
      sort: 1,
      items: [{ name: sale.productName, quantity: sale.quantity, unit: sale.unit, unitPrice: sale.unitPrice, total: sale.total }],
    });
    const paidAtSale = Math.min(sale.total, sale.initialPaid ?? sale.paid);
    if (paidAtSale > 0) {
      events.push({
        date: sale.date,
        kind: 'payment',
        label: 'مدفوع وقت البيع',
        reference: sale.number,
        debit: 0,
        credit: paidAtSale,
        balanceAfter: 0,
        refId: `${sale.id}_paid`,
        sort: 1,
      });
    }
  }

  for (const p of payments) {
    // دفعة مرتبطة فقط بسجلات ملغاة/محذوفة — لا تُدرج لتفادي خلل الرصيد
    const touchesInvoice = p.invoiceIds.some((id) => activeInvoiceIds.has(id));
    const touchesManual = (p.manualSaleIds ?? []).some((id) => activeManualIds.has(id));
    const noTargets = p.invoiceIds.length === 0 && (p.manualSaleIds ?? []).length === 0;
    if (!noTargets && !touchesInvoice && !touchesManual) continue;
    events.push({
      date: p.date,
      kind: 'payment',
      label: 'دفعة',
      reference: p.notes || '—',
      debit: 0,
      credit: p.amount,
      balanceAfter: 0,
      refId: p.id,
      sort: 2,
      method: p.method,
    });
  }

  events.sort((a, b) => a.date - b.date || a.sort - b.sort);
  let balance = 0;
  return events.map((e) => {
    balance = addMoney(balance, subMoney(e.debit, e.credit));
    const { sort: _sort, ...rest } = e;
    void _sort;
    return { ...rest, balanceAfter: balance };
  });
}

export async function listCustomerPayments(customerId?: string): Promise<CustomerPayment[]> {
  const items = await getAll<CustomerPayment>('customerPayments');
  const filtered = customerId ? items.filter((p) => p.customerId === customerId) : items;
  return filtered.sort((a, b) => b.date - a.date);
}

export interface CustomerSummary {
  customerId: string;
  name: string;
  phone: string;
  reference: string;
  balance: number;
  openingBalance: number;
  invoiceDebt: number;
  manualDebt: number;
  lastPayment: number | null;
  lastPurchase: number | null;
  oldestUnpaidDays: number;
  creditDays: number;
  overdue: boolean;
  invoiceCount: number;
  manualSaleCount: number;
}

/** ملخص دفتر الدين لكل زبون */
export async function listDebtBook(): Promise<CustomerSummary[]> {
  const [rows, payments] = await Promise.all([listCustomersWithBalance(), getAll<CustomerPayment>('customerPayments')]);
  return rows
    .map((c) => {
      const myPayments = payments.filter((p) => p.customerId === c.id);
      const lastPayment = myPayments.length > 0 ? Math.max(...myPayments.map((p) => p.date)) : null;
      return {
        customerId: c.id,
        name: c.name,
        phone: c.phone,
        reference: c.reference ?? '',
        balance: c.balance,
        openingBalance: c.openingBalance ?? 0,
        invoiceDebt: c.invoiceDebt,
        manualDebt: c.manualDebt,
        lastPayment,
        lastPurchase: c.lastActivity,
        oldestUnpaidDays: c.oldestUnpaidDays,
        creditDays: c.creditDays,
        overdue: c.overdue,
        invoiceCount: c.invoiceCount,
        manualSaleCount: c.manualSaleCount,
      };
    })
    .filter((c) => c.balance > 0 || c.invoiceCount > 0 || c.manualSaleCount > 0)
    .sort((a, b) => {
      if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
      return b.balance - a.balance || a.name.localeCompare(b.name);
    });
}

/** تفصيل ديون الزبون: فواتير وسجلات غير مسددة */
export async function getCustomerOpenDebts(customerId: string): Promise<
  {
    id: string;
    kind: 'invoice' | 'manual' | 'opening';
    number: string;
    date: number;
    total: number;
    paid: number;
    remaining: number;
    items: { name: string; quantity: number; unit?: string; unitPrice: number; total: number }[];
  }[]
> {
  const db = await getDB();
  const [invoices, manual, customer] = await Promise.all([
    db.getAllFromIndex('invoices', 'by-customer', customerId) as Promise<Invoice[]>,
    getAll<ManualSale>('manualSales'),
    db.get('customers', customerId),
  ]);
  const openingRemaining = Math.max(
    0,
    round2((customer?.openingBalance ?? 0) - (customer?.openingBalancePaid ?? 0)),
  );
  const rows = [
    ...(openingRemaining > 0
      ? [
          {
            id: `${customerId}_opening`,
            kind: 'opening' as const,
            number: '—',
            date: customer?.createdAt ?? Date.now(),
            total: customer?.openingBalance ?? 0,
            paid: customer?.openingBalancePaid ?? 0,
            remaining: openingRemaining,
            items: [],
          },
        ]
      : []),
    ...invoices
      .filter((i) => i.status !== 'cancelled' && i.remaining > 0)
      .map((i) => ({
        id: i.id,
        kind: 'invoice' as const,
        number: i.number,
        date: i.date,
        total: i.total,
        paid: i.paid,
        remaining: i.remaining,
        items: i.items.map((it) => ({
          name: it.name,
          quantity: it.quantity,
          unit: it.unit,
          unitPrice: it.unitPrice,
          total: it.lineTotal,
        })),
      })),
    ...manual
      .filter((m) => m.customerId === customerId && manualSaleRemaining(m) > 0)
      .map((m) => ({
        id: m.id,
        kind: 'manual' as const,
        number: m.number,
        date: m.date,
        total: m.total,
        paid: m.paid,
        remaining: manualSaleRemaining(m),
        items: [{ name: m.productName, quantity: m.quantity, unit: m.unit, unitPrice: m.unitPrice, total: m.total }],
      })),
  ];
  return rows.sort((a, b) => a.date - b.date);
}

/** حساب تكلفة سجل بيع يدوي (للتقارير) */
export function manualSaleCost(sale: ManualSale): number {
  return sale.unitCost === null ? 0 : mulCost(sale.quantity, sale.unitCost);
}
