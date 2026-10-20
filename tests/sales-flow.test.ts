/**
 * اختبارات تدفق المبيعات والمخزون والفواتير — على IndexedDB حقيقي (وهمي في Node).
 * تتحقق من قواعد إلزامية: خصم المخزون، منع التكرار، الفواتير النقدية والآجلة،
 * دفعات العملاء، المشتريات، المرتجعات، المصروفات، والأرباح.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { resetDBConnection, getDB } from '../src/services/db';
import { createProduct, listProducts, updateProduct, adjustStock, isLowStock } from '../src/services/products';
import { createSale, cancelInvoice, listInvoices, getInvoice, SaleError, computeCartTotals } from '../src/services/sales';
import { createCustomer, listCustomersWithBalance, getCustomerBalance, getCustomerStatement, createCustomer as createCust } from '../src/services/customers';
import { recordCustomerPayment, PaymentError } from '../src/services/payments';
import { createPurchase, receivePurchase, cancelPurchase, paySupplier, computePurchaseTotals, listPurchases } from '../src/services/purchases';
import { createExpense, listExpenses, deleteExpense } from '../src/services/expenses';
import { getBalances, listCashTransactions, deposit, withdraw, transfer } from '../src/services/cash';
import { computePnl, buildSalesReport, buildInventoryReport, buildTopProducts } from '../src/services/reports';
import { uid } from '../src/utils/id';

async function freshDB() {
  resetDBConnection();
  const db = await getDB();
  for (const store of [
    'products',
    'customers',
    'suppliers',
    'invoices',
    'purchases',
    'expenses',
    'cash',
    'customerPayments',
    'supplierPayments',
    'settings',
    'meta',
  ] as const) {
    await db.clear(store);
  }
}

let invCounter = 0;
async function nextInv() {
  invCounter += 1;
  return `INV-${String(invCounter).padStart(5, '0')}`;
}

beforeEach(async () => {
  invCounter = 0;
  await freshDB();
});

describe('المنتجات والمخزون', () => {
  it('يضيف منتجًا ويعدّله ويظهر في القائمة', async () => {
    const p = await createProduct({
      name: 'شاي',
      code: 'T01',
      barcode: '6281001',
      category: 'مشروبات',
      purchasePrice: 10,
      salePrice: 15,
      quantity: 20,
      alertThreshold: 5,
      supplierId: null,
      description: '',
    });
    expect(p.id).toBeTruthy();

    const updated = await updateProduct(p.id, { salePrice: 18, name: 'شاي أحمر' });
    expect(updated.salePrice).toBe(18);
    expect(updated.name).toBe('شاي أحمر');

    const list = await listProducts();
    expect(list).toHaveLength(1);
    expect(list[0].salePrice).toBe(18);
  });

  it('يحدد المخزون المنخفض', async () => {
    const p = await createProduct({
      name: 'x', code: 'c1', barcode: '', category: '', purchasePrice: 1, salePrice: 2,
      quantity: 3, alertThreshold: 5, supplierId: null, description: '',
    });
    expect(isLowStock(p)).toBe(true);
    const p2 = await createProduct({
      name: 'y', code: 'c2', barcode: '', category: '', purchasePrice: 1, salePrice: 2,
      quantity: 10, alertThreshold: 5, supplierId: null, description: '',
    });
    expect(isLowStock(p2)).toBe(false);
  });

  it('يعدّل الكمية يدويًا (جرد)', async () => {
    const p = await createProduct({
      name: 'z', code: 'c3', barcode: '', category: '', purchasePrice: 1, salePrice: 2,
      quantity: 5, alertThreshold: 1, supplierId: null, description: '',
    });
    const updated = await adjustStock(p.id, 42);
    expect(updated.quantity).toBe(42);
    await expect(adjustStock(p.id, -1)).rejects.toThrow('INVALID_QUANTITY');
  });
});

describe('نقطة البيع — البيع وخصم المخزون', () => {
  async function seedProduct(qty = 10, price = 50, cost = 30) {
    return createProduct({
      name: 'منتج', code: uid('P'), barcode: '', category: '', purchasePrice: cost,
      salePrice: price, quantity: qty, alertThreshold: 2, supplierId: null, description: '',
    });
  }

  it('يبيع منتجًا ويخصم الكمية ويسجّل الفاتورة والصندوق', async () => {
    const p = await seedProduct(10, 50, 30);
    const inv = await createSale(
      {
        lines: [{ productId: p.id, quantity: 3 }],
        customerId: null,
        discount: 10,
        paid: 140,
        paymentMethod: 'cash',
        clientToken: uid('tok'),
      },
      { nextInvoiceNumber: await nextInv() },
    );

    expect(inv.subtotal).toBe(150);
    expect(inv.discount).toBe(10);
    expect(inv.total).toBe(140);
    expect(inv.paid).toBe(140);
    expect(inv.remaining).toBe(0);
    expect(inv.status).toBe('paid');
    expect(inv.cogs).toBe(90); // 3 × 30 — لقطة التكلفة

    const after = (await listProducts())[0];
    expect(after.quantity).toBe(7);

    const balances = await getBalances();
    expect(balances.cash).toBe(140);
  });

  it('يمنع البيع المكرر بنفس المفتاح', async () => {
    const p = await seedProduct(10, 50, 30);
    const token = uid('tok');
    const input = {
      lines: [{ productId: p.id, quantity: 2 }],
      customerId: null,
      discount: 0,
      paid: 100,
      paymentMethod: 'cash' as const,
      clientToken: token,
    };
    const first = await createSale(input, { nextInvoiceNumber: await nextInv() });
    const second = await createSale(input, { nextInvoiceNumber: await nextInv() });

    expect(second.id).toBe(first.id); // نفس الفاتورة — لم تتكرر
    const invoices = await listInvoices();
    expect(invoices).toHaveLength(1);
    const product = (await listProducts())[0];
    expect(product.quantity).toBe(8); // خُصمت مرة واحدة فقط
    const balances = await getBalances();
    expect(balances.cash).toBe(100); // لم يُحصَّل مرتين
  });

  it('يمنع بيع مخزون غير متوفر عندما يكون الإعداد مغلقًا', async () => {
    const p = await seedProduct(2, 50, 30);
    await expect(
      createSale(
        { lines: [{ productId: p.id, quantity: 5 }], customerId: null, discount: 0, paid: 0, paymentMethod: 'cash', clientToken: uid('tok') },
        { nextInvoiceNumber: await nextInv() },
      ),
    ).rejects.toThrow(SaleError);
    // لم يتغير المخزون
    expect((await listProducts())[0].quantity).toBe(2);
    // ولا أُنشئت فاتورة
    expect(await listInvoices()).toHaveLength(0);
  });

  it('يسمح بالبيع السالب عند تفعيل الإعداد', async () => {
    const p = await seedProduct(2, 50, 30);
    const inv = await createSale(
      { lines: [{ productId: p.id, quantity: 5 }], customerId: null, discount: 0, paid: 250, paymentMethod: 'cash', clientToken: uid('tok') },
      { allowNegativeStock: true, nextInvoiceNumber: await nextInv() },
    );
    expect(inv.status).toBe('paid');
    expect((await listProducts())[0].quantity).toBe(-3);
  });

  it('ينشئ فاتورة آجلة (دين) دون نقد', async () => {
    const p = await seedProduct(10, 50, 30);
    const c = await createCust({ name: 'عميل', phone: '', address: '', notes: '', creditDays: 0 });
    const inv = await createSale(
      {
        lines: [{ productId: p.id, quantity: 4 }],
        customerId: c.id,
        customerName: c.name,
        discount: 0,
        paid: 0,
        paymentMethod: 'credit',
        clientToken: uid('tok'),
      },
      { nextInvoiceNumber: await nextInv() },
    );
    expect(inv.status).toBe('unpaid');
    expect(inv.remaining).toBe(200);
    expect(await getCustomerBalance(c.id)).toBe(200);
    // لا حركة صندوق — لم يُحصَّل شيء
    const balances = await getBalances();
    expect(balances.cash).toBe(0);
  });

  it('يحسب الإجماليات والخصم في السلة', () => {
    const totals = computeCartTotals(
      [
        { productId: 'a', quantity: 2, unitPrice: 10.5 },
        { productId: 'b', quantity: 1, unitPrice: 5 },
      ],
      5,
      0,
    );
    expect(totals.subtotal).toBe(26);
    expect(totals.total).toBe(21);
    expect(totals.remaining).toBe(21);
  });
});

describe('فواتير المبيعات والإلغاء (المرتجع)', () => {
  it('يُرجع المخزون عند الإلغاء ويسجّل استرداد المدفوع ولا يحذف السجل', async () => {
    const p = await createProduct({
      name: 'منتج', code: 'X1', barcode: '', category: '', purchasePrice: 20, salePrice: 40,
      quantity: 10, alertThreshold: 1, supplierId: null, description: '',
    });
    const inv = await createSale(
      { lines: [{ productId: p.id, quantity: 4 }], customerId: null, discount: 0, paid: 160, paymentMethod: 'cash', clientToken: uid('tok') },
      { nextInvoiceNumber: await nextInv() },
    );
    expect((await listProducts())[0].quantity).toBe(6);

    const cancelled = await cancelInvoice(inv.id, 'زبون راجع');
    expect(cancelled.status).toBe('cancelled');
    expect(cancelled.cancelReason).toBe('زبون راجع');

    // المخزون عاد
    expect((await listProducts())[0].quantity).toBe(10);
    // السجل المالي موجود ولا يزال
    const stored = await getInvoice(inv.id);
    expect(stored).toBeDefined();
    expect(stored!.total).toBe(160);
    // الاسترداد قيد صندوق صادر
    const txs = await listCashTransactions();
    const refund = txs.find((t) => t.refType === 'invoice_cancel');
    expect(refund).toBeDefined();
    expect(refund!.amount).toBe(160);
    expect(refund!.type).toBe('out');
    // الصندوق صفر بعد الاسترداد
    expect((await getBalances()).cash).toBe(0);
    // لا يُحتسب ضمن المبيعات
    const pnl = computePnl(await listInvoices(), []);
    expect(pnl.sales).toBe(0);
  });
});

describe('العملاء والديون والمدفوعات', () => {
  it('يحدّث رصيد العميل بعد البيع الآجل ثم الدفعة الجزئية ثم الكاملة', async () => {
    const p = await createProduct({
      name: 'منتج', code: 'D1', barcode: '', category: '', purchasePrice: 10, salePrice: 20,
      quantity: 10, alertThreshold: 1, supplierId: null, description: '',
    });
    const c = await createCustomer({ name: 'أحمد', phone: '050', address: '', notes: '', creditDays: 30 });

    const inv = await createSale(
      { lines: [{ productId: p.id, quantity: 5 }], customerId: c.id, customerName: c.name, discount: 0, paid: 0, paymentMethod: 'credit', clientToken: uid('tok') },
      { nextInvoiceNumber: await nextInv() },
    );
    expect(await getCustomerBalance(c.id)).toBe(100);

    // دفعة جزئية
    await recordCustomerPayment({ customerId: c.id, customerName: c.name, amount: 40, method: 'cash' });
    expect(await getCustomerBalance(c.id)).toBe(60);
    const afterPartial = await getInvoice(inv.id);
    expect(afterPartial!.paid).toBe(40);
    expect(afterPartial!.remaining).toBe(60);
    expect(afterPartial!.status).toBe('partial');

    // الصندوق يرى المبلغ المحصّل
    expect((await getBalances()).cash).toBe(40);

    // دفعة كاملة تسدّد الباقي
    await recordCustomerPayment({ customerId: c.id, customerName: c.name, amount: 60, method: 'cash' });
    expect(await getCustomerBalance(c.id)).toBe(0);
    const afterFull = await getInvoice(inv.id);
    expect(afterFull!.status).toBe('paid');
    expect(afterFull!.remaining).toBe(0);

    // التحصيل ليس دخلًا جديدًا: صافي المبيعات = 100 فقط
    const invoices = await listInvoices();
    const pnl = computePnl(invoices, []);
    expect(pnl.sales).toBe(100);
    expect((await getBalances()).cash).toBe(100); // 40 + 60 محصّلة
  });

  it('يمنع دفعة أكبر من المستحق', async () => {
    const c = await createCustomer({ name: 'ب', phone: '', address: '', notes: '', creditDays: 0 });
    await expect(
      recordCustomerPayment({ customerId: c.id, customerName: c.name, amount: 10, method: 'cash' }),
    ).rejects.toThrow(PaymentError);
  });

  it('كشف حساب العميل يعكس الفواتير والمدفوعات مع الرصيد الجاري', async () => {
    const p = await createProduct({
      name: 'م', code: 'S1', barcode: '', category: '', purchasePrice: 5, salePrice: 10,
      quantity: 10, alertThreshold: 1, supplierId: null, description: '',
    });
    const c = await createCustomer({ name: 'c', phone: '', address: '', notes: '', creditDays: 0 });
    await createSale(
      { lines: [{ productId: p.id, quantity: 3 }], customerId: c.id, customerName: c.name, discount: 0, paid: 0, paymentMethod: 'credit', clientToken: uid('tok') },
      { nextInvoiceNumber: await nextInv() },
    );
    await recordCustomerPayment({ customerId: c.id, customerName: c.name, amount: 10, method: 'bank' });

    const statement = await getCustomerStatement(c.id);
    expect(statement).toHaveLength(2);
    expect(statement[0].debit).toBe(30);
    expect(statement[1].credit).toBe(10);
    expect(statement[1].balanceAfter).toBe(20);

    const rows = await listCustomersWithBalance();
    expect(rows[0].balance).toBe(20);
  });
});

describe('المشتريات والموردون', () => {
  async function seedProduct(cost = 10, qty = 4) {
    return createProduct({
      name: 'مخزون', code: uid('W'), barcode: '', category: '', purchasePrice: cost,
      salePrice: cost + 5, quantity: qty, alertThreshold: 1, supplierId: null, description: '',
    });
  }

  it('الطلب لا يغيّر المخزون — الاستلام يزيد الكمية ويحدّث متوسط التكلفة', async () => {
    const p = await seedProduct(10, 6); // قيمة 60
    const { items, subtotal, discount, total } = computePurchaseTotals(
      [{ productId: p.id, name: p.name, code: p.code, quantity: 4, unitCost: 20 }],
      0,
    );
    expect(subtotal).toBe(80);

    const purchase = await createPurchase({
      items,
      supplierId: null,
      supplierName: '',
      discount,
      paid: 80,
      paymentMethod: 'cash',
      status: 'ordered',
      notes: '',
      date: Date.now(),
      number: 'PUR-00001',
      total,
    } as never);

    // قبل الاستلام: المخزون كما هو
    expect((await listProducts())[0].quantity).toBe(6);
    expect(purchase.status).toBe('ordered');

    // الاستلام
    const received = await receivePurchase(purchase.id);
    expect(received.status).toBe('received');

    const after = (await listProducts())[0];
    expect(after.quantity).toBe(10);
    // متوسط مرجّح: (6×10 + 4×20) / 10 = 14
    expect(after.purchasePrice).toBe(14);

    // الاستلام مرة أخرى لا يكرر الزيادة
    await receivePurchase(purchase.id);
    expect((await listProducts())[0].quantity).toBe(10);

    // الصندوق قيّد الخروج
    expect((await getBalances()).cash).toBe(-80);
  });

  it('الشراء الآجل يسجّل مستحقات المورد ثم التسديد يصفّرها', async () => {
    const p = await seedProduct(5, 0);
    const db = await getDB();
    const supplier = { id: 'sup_test', name: 'مورد', phone: '', address: '', notes: '', createdAt: 1, updatedAt: 1 };
    await db.put('suppliers', supplier);

    const { items, discount, total } = computePurchaseTotals(
      [{ productId: p.id, name: p.name, code: p.code, quantity: 10, unitCost: 5 }],
      0,
    );
    const purchase = await createPurchase({
      items,
      supplierId: supplier.id,
      supplierName: supplier.name,
      discount,
      paid: 0,
      paymentMethod: 'credit',
      status: 'ordered',
      notes: '',
      date: Date.now(),
      number: 'PUR-00002',
      total,
    } as never);
    await receivePurchase(purchase.id);

    const received = (await listPurchases())[0];
    expect(received.remaining).toBe(50);

    // لا يُحتسب كمصروف تشغيلي
    const pnl = computePnl([], []);
    expect(pnl.expenses).toBe(0);

    // تسديد كامل
    const res = await paySupplier(supplier.id, supplier.name, 50, 'cash', Date.now());
    expect(res.applied).toBe(50);
    const after = (await listPurchases())[0];
    expect(after.remaining).toBe(0);
    // الصندوق خرج لكن ليس مصروفًا
    expect((await getBalances()).cash).toBe(-50);
    const expenses = await listExpenses();
    expect(expenses).toHaveLength(0);
  });

  it('إلغاء فاتورة شراء مستلمة يعكس المخزون', async () => {
    const p = await seedProduct(10, 0);
    const { items, discount, total } = computePurchaseTotals(
      [{ productId: p.id, name: p.name, code: p.code, quantity: 5, unitCost: 10 }],
      0,
    );
    const purchase = await createPurchase({
      items,
      supplierId: null,
      supplierName: '',
      discount,
      paid: 0,
      paymentMethod: 'credit',
      status: 'ordered',
      notes: '',
      date: Date.now(),
      number: 'PUR-00003',
      total,
    } as never);
    await receivePurchase(purchase.id);
    expect((await listProducts())[0].quantity).toBe(5);

    await cancelPurchase(purchase.id, 'خطأ في الطلب');
    expect((await listProducts())[0].quantity).toBe(0);
    expect((await listPurchases())[0].status).toBe('cancelled');
  });
});

describe('المصروفات والصندوق', () => {
  it('تسجيل مصروف يقيّد صندوقًا ويظهر في التقارير', async () => {
    await createExpense({ date: Date.now(), amount: 25.5, category: 'كهرباء', paymentMethod: 'cash', description: 'فاتورة' });
    const expenses = await listExpenses();
    expect(expenses).toHaveLength(1);

    const balances = await getBalances();
    expect(balances.cash).toBe(-25.5);

    const pnl = computePnl([], expenses);
    expect(pnl.expenses).toBe(25.5);
    expect(pnl.netProfit).toBe(-25.5);
  });

  it('حذف المصروف يزيل قيده من الصندوق', async () => {
    const e = await createExpense({ date: Date.now(), amount: 10, category: 'أخرى', paymentMethod: 'cash', description: '' });
    await deleteExpense(e.id);
    expect(await listExpenses()).toHaveLength(0);
    expect((await getBalances()).cash).toBe(0);
  });

  it('الإيداع والسحب والتحويل: التحويل لا يعد دخلًا أو مصروفًا', async () => {
    await deposit({ amount: 500, account: 'cash', description: 'رصيد افتتاحي' });
    await withdraw({ amount: 100, account: 'cash', description: 'سحب شخصي' });
    await transfer({ amount: 200, from: 'cash', to: 'bank', description: 'إيداع بنكي' });

    const balances = await getBalances();
    expect(balances.cash).toBe(200); // 500 - 100 - 200
    expect(balances.bank).toBe(200);
    expect(balances.total).toBe(400);

    // لا أثر في الربح
    const pnl = computePnl([], []);
    expect(pnl.sales).toBe(0);
    expect(pnl.expenses).toBe(0);
    expect(pnl.netProfit).toBe(0);
  });

  it('رفض المبلغ غير الموجب', async () => {
    await expect(deposit({ amount: -5, account: 'cash', description: '' })).rejects.toThrow('INVALID_AMOUNT');
    await expect(transfer({ amount: 10, from: 'cash', to: 'cash', description: '' })).rejects.toThrow('SAME_ACCOUNT');
  });
});

describe('التقارير والأرباح', () => {
  it('الأرقام تتطابق: مبيعات − COGS − مصروفات = صافي الربح', async () => {
    const p = await createProduct({
      name: 'prod', code: 'R1', barcode: '', category: '', purchasePrice: 30, salePrice: 50,
      quantity: 100, alertThreshold: 1, supplierId: null, description: '',
    });
    // بيعان نقدًا
    await createSale(
      { lines: [{ productId: p.id, quantity: 2 }], customerId: null, discount: 0, paid: 100, paymentMethod: 'cash', clientToken: uid('tok') },
      { nextInvoiceNumber: await nextInv() },
    );
    await createSale(
      { lines: [{ productId: p.id, quantity: 1 }], customerId: null, discount: 10, paid: 40, paymentMethod: 'cash', clientToken: uid('tok') },
      { nextInvoiceNumber: await nextInv() },
    );
    await createExpense({ date: Date.now(), amount: 15, category: 'نقل', paymentMethod: 'cash', description: '' });

    const invoices = await listInvoices();
    const expenses = await listExpenses();
    const range = { from: 0, to: Date.now() + 86400000 };
    const pnl = computePnl(invoices, expenses, range);

    expect(pnl.sales).toBe(140); // 100 + 40
    expect(pnl.cogs).toBe(90); // 60 + 30
    expect(pnl.grossProfit).toBe(50);
    expect(pnl.expenses).toBe(15);
    expect(pnl.netProfit).toBe(35);
    expect(pnl.invoiceCount).toBe(2);

    // تقرير المبيعات يطابق
    const rows = buildSalesReport(invoices, range);
    expect(rows.reduce((a, r) => a + r.total, 0)).toBe(140);
    expect(rows.reduce((a, r) => a + r.profit, 0)).toBe(50);

    // تقرير المخزون بالتكلفة
    const inv = buildInventoryReport(await listProducts());
    expect(inv[0].quantity).toBe(97);
    expect(inv[0].costValue).toBe(97 * 30);

    // الأكثر مبيعًا
    const top = buildTopProducts(invoices, range);
    expect(top[0].quantity).toBe(3);
    expect(top[0].profit).toBe(50);
  });

  it('الفواتير الملغاة خارج أرقام التقارير', async () => {
    const p = await createProduct({
      name: 'p', code: 'R2', barcode: '', category: '', purchasePrice: 10, salePrice: 20,
      quantity: 10, alertThreshold: 1, supplierId: null, description: '',
    });
    const inv = await createSale(
      { lines: [{ productId: p.id, quantity: 1 }], customerId: null, discount: 0, paid: 20, paymentMethod: 'cash', clientToken: uid('tok') },
      { nextInvoiceNumber: await nextInv() },
    );
    await cancelInvoice(inv.id, 'خطأ');
    const pnl = computePnl(await listInvoices(), [], { from: 0, to: Date.now() + 86400000 });
    expect(pnl.sales).toBe(0);
    expect(pnl.cancelledCount).toBe(1);
    expect(pnl.cancelledTotal).toBe(20);
  });
});

describe('استمرارية البيانات', () => {
  it('البيانات تبقى بعد إعادة فتح الاتصال بقاعدة البيانات', async () => {
    const p = await createProduct({
      name: 'persistent', code: 'P1', barcode: '', category: '', purchasePrice: 5, salePrice: 9,
      quantity: 50, alertThreshold: 2, supplierId: null, description: '',
    });
    await createSale(
      { lines: [{ productId: p.id, quantity: 2 }], customerId: null, discount: 0, paid: 18, paymentMethod: 'cash', clientToken: uid('tok') },
      { nextInvoiceNumber: await nextInv() },
    );

    // محاكاة إغلاق التطبيق وإعادة فتحه
    resetDBConnection();
    const products = await listProducts();
    expect(products).toHaveLength(1);
    expect(products[0].quantity).toBe(48);
    const invoices = await listInvoices();
    expect(invoices).toHaveLength(1);
    expect((await getBalances()).cash).toBe(18);
  });
});
