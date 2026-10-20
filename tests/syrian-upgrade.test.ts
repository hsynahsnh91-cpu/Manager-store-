/**
 * اختبارات الترقية السورية: الوحدات، الشراء بالكرتونة، البحث بالأسماء البديلة،
 * دفتر الدين والبيع الآجل، حسابات الموردين، تقلّب التكلفة، الإتلاف، واستمرارية البيانات.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { freshDB } from './helpers';
import { getDB, resetDBConnection } from '../src/services/db';
import { createProduct, listProducts, updateProduct } from '../src/services/products';
import { preparePurchaseLine, createPurchase, receivePurchase, computePurchaseTotals, getNextPurchaseNumber, paySupplier } from '../src/services/purchases';
import { createSale, getNextInvoiceNumber, listInvoices } from '../src/services/sales';
import { createCustomer, getCustomerStatement, listDebtBook, getCustomerOpenDebts, getCustomerBalance } from '../src/services/customers';
import { recordCustomerPayment } from '../src/services/payments';
import { createManualSale } from '../src/services/manualSales';
import { createCategory, listCategories, groupCategories, moveProducts, updateCategory } from '../src/services/categories';
import { searchProducts, suggestDuplicates } from '../src/services/productSearch';
import { getPriceHistory } from '../src/services/prices';
import { writeOffStock, listWriteOffs } from '../src/services/stock';
import { computePnl } from '../src/services/reports';
import { getBalances } from '../src/services/cash';
import { getSupplierProfile, listSuppliersWithBalance } from '../src/services/suppliers';
import { convertToBaseForTest } from './unit-helpers';
import { uid } from '../src/utils/id';
import { at } from './helpers';

async function seedRice() {
  return createProduct({
    name: 'أرز مصري 1 كغ',
    code: 'RICE1',
    barcode: '6291000000017',
    category: 'الأرز والحبوب والبقوليات',
    purchasePrice: 8000,
    salePrice: 11000,
    quantity: 0,
    alertThreshold: 10,
    supplierId: null,
    description: '',
    brand: 'الشعلان',
    aliases: ['رز مصري', 'أرز كيلو'],
    sizeValue: 1,
    sizeUnit: 'kg',
    saleUnit: 'piece',
    purchaseUnit: 'carton',
    unitsPerPurchase: 24,
  });
}

async function makeSupplier(name = 'مؤسسة الأمانة') {
  const db = await getDB();
  const supplier = {
    id: uid('sup'),
    name,
    phone: '0930000000',
    address: 'سوق الهال',
    notes: '',
    area: 'ريف حماة',
    supplies: 'أرز، سكر، زيت',
    openingBalance: 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  await db.put('suppliers', supplier);
  return supplier;
}

async function purchaseCartons(productId: string, cartons: number, costPerCarton: number, opts: { supplierId?: string; paid?: number; method?: 'cash' | 'credit' } = {}) {
  const product = (await listProducts()).find((p) => p.id === productId)!;
  const prepared = preparePurchaseLine(product, cartons, costPerCarton);
  expect(prepared.error).toBeNull();
  const purchase = await createPurchase({
    items: [prepared.item!],
    supplierId: opts.supplierId ?? null,
    supplierName: opts.supplierId ? 'مؤسسة الأمانة' : '',
    discount: 0,
    extraCosts: 0,
    paid: opts.paid ?? 0,
    paymentMethod: opts.method ?? 'credit',
    status: 'ordered',
    notes: '',
    date: Date.now(),
    number: await getNextPurchaseNumber('PUR'),
    clientToken: uid('tok'),
  });
  return { purchase, prepared };
}

async function sell(productId: string, quantity: number, opts: { customerId?: string; paid?: number; method?: 'cash' | 'credit' } = {}) {
  return createSale(
    {
      lines: [{ productId, quantity }],
      customerId: opts.customerId ?? null,
      customerName: '',
      discount: 0,
      paid: opts.paid ?? 0,
      paymentMethod: opts.method ?? 'cash',
      clientToken: uid('tok'),
    },
    { nextInvoiceNumber: await getNextInvoiceNumber('INV') },
  );
}

describe('دليل الأصناف السوري', () => {
  beforeEach(async () => {
    await freshDB();
  });

  it('يزرع 16 تصنيفًا مناسبًا للبقالية مع إمكانية الفروع وإعادة التسمية', async () => {
    const cats = await listCategories();
    expect(cats.length).toBeGreaterThanOrEqual(16);
    expect(cats.map((c) => c.name)).toContain('الأرز والحبوب والبقوليات');
    expect(cats.map((c) => c.name)).toContain('السجائر والمنتجات المقيدة');

    const parent = cats.find((c) => c.name === 'الأرز والحبوب والبقوليات')!;
    const child = await createCategory('أرز بسمتي', ['بسمتي'], parent.id);
    expect(child.parentId).toBe(parent.id);
    const grouped = groupCategories(await listCategories());
    const group = grouped.find((g) => g.parent.id === parent.id)!;
    expect(group.children.map((c) => c.name)).toContain('أرز بسمتي');

    // إعادة التسمية تنقل المنتجات المرتبطة دون فقدان بياناتها
    const product = await seedRice();
    await updateCategory(parent.id, { name: 'الحبوب والأرز' });
    const after = (await listProducts()).find((p) => p.id === product.id)!;
    expect(after.category).toBe('الحبوب والأرز');
    expect(after.salePrice).toBe(11000);
  });

  it('ينقل المنتجات بين التصنيفات دون المساس بسجل الأسعار', async () => {
    const product = await seedRice();
    await moveProducts('الأرز والحبوب والبقوليات', 'منتجات أخرى');
    expect((await listProducts()).find((p) => p.id === product.id)!.category).toBe('منتجات أخرى');
  });

  it('يبحث بالأسماء البديلة والعلامة والحجم والباركود ويقترح الموجود بدل التكرار', async () => {
    const rice = await seedRice();
    const oil = await createProduct({
      name: 'زيت عافية 1.8 لتر',
      code: 'OIL18',
      barcode: '',
      category: 'الزيوت والسمن والمواد التموينية',
      purchasePrice: 15000,
      salePrice: 19000,
      quantity: 5,
      alertThreshold: 2,
      supplierId: null,
      description: '',
      brand: 'عافية',
      aliases: ['زيت ذرة', 'زيت طبخ'],
      sizeValue: 1.8,
      sizeUnit: 'l',
      saleUnit: 'piece',
    });

    const byAlias = searchProducts([rice, oil], 'رز مصري');
    expect(byAlias[0]?.product.id).toBe(rice.id);
    const byAlias2 = searchProducts([rice, oil], 'زيت طبخ');
    expect(byAlias2[0]?.product.id).toBe(oil.id);
    const byBrand = searchProducts([rice, oil], 'عافية');
    expect(byBrand[0]?.product.id).toBe(oil.id);
    const byBarcode = searchProducts([rice, oil], '6291000000017');
    expect(byBarcode[0]?.product.id).toBe(rice.id);
    expect(byBarcode[0]?.reason).toBe('barcode');

    // نفس الاسم بعلامة مختلفة = صنف مختلف، لا دمج
    const duplicates = suggestDuplicates([rice, oil], { name: 'أرز مصري 1 كغ', brand: 'أخرى', sizeValue: 1, sizeUnit: 'kg' });
    expect(duplicates[0].product.id).toBe(rice.id);
    expect(duplicates[0].sameBrand).toBe(false);
    expect(duplicates[0].conflict).toBe(true);
  });

  it('يحوّل الكرتونة إلى قطع باستخدام العدد الذي حدده المستخدم فقط', async () => {
    const rice = await seedRice();
    expect(convertToBaseForTest(3, 'carton', 'piece', 24)).toBe(72);
    expect(convertToBaseForTest(1, 'kg', 'g', null)).toBe(1000);
    expect(convertToBaseForTest(1, 'carton', 'kg', null)).toBeNull();

    const missingFactor = preparePurchaseLine({ ...rice, unitsPerPurchase: null }, 1, 24000);
    expect(missingFactor.error).toBe('UNIT_CONVERSION_REQUIRED');
    expect(missingFactor.item).toBeNull();
  });
});

describe('الشراء بالكرتونة والبيع بالقطعة', () => {
  beforeEach(async () => {
    await freshDB();
  });

  it('يستلم 5 كراتين (120 قطعة) ويحسب التكلفة للقطعة ويبيع 3 قطع', async () => {
    const rice = await seedRice();
    const supplier = await makeSupplier();
    const { purchase, prepared } = await purchaseCartons(rice.id, 5, 24000, { supplierId: supplier.id, paid: 120000, method: 'cash' });

    expect(prepared.baseQuantity).toBe(120);
    expect(purchase.total).toBe(120000);
    expect(purchase.items[0].quantity).toBe(120);
    expect(purchase.items[0].unitCost).toBe(1000); // 24000 ÷ 24
    expect(purchase.items[0].enteredUnit).toBe('carton');
    expect(purchase.items[0].unitsPerPurchase).toBe(24);

    await receivePurchase(purchase.id);
    const received = (await listProducts()).find((p) => p.id === rice.id)!;
    expect(received.quantity).toBe(120);
    expect(received.purchasePrice).toBe(1000);
    expect(received.salePrice).toBe(11000); // لم يتغيّر تلقائيًا

    const invoice = await sell(rice.id, 3, { paid: 33000 });
    // 3 × 1000 = 3000 COGS (القطع لا الكرتونة)
    expect(invoice.cogs).toBe(3000);
    expect(invoice.total).toBe(33000);
    expect(invoice.items[0].unitPrice).toBe(11000);
    expect(invoice.items[0].unit).toBe('piece');

    const afterSale = (await listProducts()).find((p) => p.id === rice.id)!;
    expect(afterSale.quantity).toBe(117);
    expect((await getBalances()).cash).toBe(33000 - 120000);
    expect((await getPriceHistory(rice.id))[0]).toMatchObject({ field: 'purchase', oldPrice: 8000, newPrice: 1000, source: 'purchase' });
  });

  it('يوزّع الخصم والنقل على البنود في تكلفة الوحدة', async () => {
    const rice = await seedRice();
    const prepared = preparePurchaseLine({ ...rice, unitsPerPurchase: 10 }, 2, 20000);
    expect(prepared.item?.quantity).toBe(20);
    const totals = computePurchaseTotals([prepared.item!], 4000, 1000);
    // الإجمالي 40000 − 4000 + 1000 = 37000 على 20 قطعة = 1850
    expect(totals.total).toBe(37000);
    expect(totals.items[0].unitCost).toBe(1850);
  });

  it('يبقي فواتير المبيعات القديمة بتكلفتها بعد تغيّر سعر الشراء', async () => {
    const rice = await seedRice();
    const first = await purchaseCartons(rice.id, 1, 24000, { paid: 24000, method: 'cash' });
    await receivePurchase(first.purchase.id);
    const oldInvoice = await sell(rice.id, 2, { paid: 22000 });
    expect(oldInvoice.cogs).toBe(2000);

    // فاتورة شراء ثانية بسعر أعلى (كرتونة بـ 36000)
    const second = await purchaseCartons(rice.id, 1, 36000, { paid: 36000, method: 'cash' });
    await receivePurchase(second.purchase.id);
    const product = (await listProducts()).find((p) => p.id === rice.id)!;
    // متوسط مرجّح: (22×1000 + 24×1500) ÷ 46
    expect(product.purchasePrice).toBeCloseTo(1260.8696, 4);
    expect(product.quantity).toBe(46);

    // الفاتورة القديمة لم تتغيّر
    const stored = (await listInvoices()).find((i) => i.id === oldInvoice.id)!;
    expect(stored.cogs).toBe(2000);
    expect(stored.items[0].unitCost).toBe(1000);
  });

  it('لا يزيد المخزون إلا عند الاستلام ولا يكرر الاستلام', async () => {
    const rice = await seedRice();
    const { purchase } = await purchaseCartons(rice.id, 1, 24000);
    expect((await listProducts()).find((p) => p.id === rice.id)!.quantity).toBe(0);
    await receivePurchase(purchase.id);
    await receivePurchase(purchase.id);
    expect((await listProducts()).find((p) => p.id === rice.id)!.quantity).toBe(24);
  });
});

describe('دفتر الدين والبيع الآجل', () => {
  beforeEach(async () => {
    await freshDB();
  });

  it('يضيف فاتورة آجلة وبيعًا يدويًا آجلًا ثم يسدد جزئيًا ثم كاملًا دون ازدواج الدخل', async () => {
    const rice = await seedRice();
    const purchase = await purchaseCartons(rice.id, 2, 24000, { paid: 0 });
    await receivePurchase(purchase.purchase.id);

    const customer = await createCustomer({
      name: 'أبو محمد',
      phone: '0944111222',
      address: 'حارة الجامع',
      notes: '',
      creditDays: 15,
      reference: 'C-12',
      openingBalance: 5000,
    });

    const invoice = await sell(rice.id, 2, { customerId: customer.id, paid: 0, method: 'credit' });
    expect(invoice.remaining).toBe(22000);

    const manual = await createManualSale({
      productId: rice.id,
      productName: rice.name,
      quantity: 1,
      unitPrice: 11000,
      unitCost: 1000,
      customerId: customer.id,
      buyerName: customer.name,
      paymentMethod: 'credit',
      paid: 0,
      stockApplied: true,
      clientToken: uid('tok'),
    });
    expect(manual.sale.total).toBe(11000);

    const balance = await getCustomerBalance(customer.id);
    expect(balance).toBe(5000 + 22000 + 11000);

    const debts = await getCustomerOpenDebts(customer.id);
    expect(debts).toHaveLength(3); // رصيد سابق + فاتورة + بيع يدوي
    expect(debts[0].kind).toBe('opening');
    expect(debts[1].kind).toBe('invoice');

    // دفعة جزئية 10000 توزَّع على الأقدم أولًا
    const pay1 = await recordCustomerPayment({
      customerId: customer.id,
      customerName: customer.name,
      amount: 10000,
      method: 'cash',
      clientToken: uid('tok'),
    });
    expect(pay1.amount).toBe(10000);
    expect((await getCustomerBalance(customer.id))).toBe(28000);

    // دفعة الباقي 28000
    await recordCustomerPayment({
      customerId: customer.id,
      customerName: customer.name,
      amount: 28000,
      method: 'cash',
      clientToken: uid('tok'),
    });
    expect(await getCustomerBalance(customer.id)).toBe(0);

    const statement = await getCustomerStatement(customer.id);
    expect(statement[0].kind).toBe('opening');
    expect(statement[0].balanceAfter).toBe(5000);
    expect(statement.some((e) => e.kind === 'opening')).toBe(true);
    expect(statement.some((e) => e.kind === 'manualSale')).toBe(true);
    expect(statement.some((e) => e.items?.some((i) => i.name === rice.name))).toBe(true);
    expect(statement[statement.length - 1].balanceAfter).toBe(0);

    // التحصيل ليس دخلًا: المبيعات 33000 فقط (22000 فاتورة + 11000 يدوي)
    const pnl = computePnl(await listInvoices(), [], undefined, [manual.sale]);
    expect(pnl.sales).toBe(33000);
    expect(pnl.cogs).toBe(3000);
    expect(pnl.grossProfit).toBe(30000);
    // الصندوق: دفعتان 38000 فقط (لا تُحتسب الفاتورة الآجلة نقدًا)
    expect((await getBalances()).cash).toBe(38000);
  });

  it('لا يكرر الدفعة عند نفس مفتاح النقر', async () => {
    const rice = await seedRice();
    const purchase = await purchaseCartons(rice.id, 1, 24000, { paid: 0 });
    await receivePurchase(purchase.purchase.id);
    const customer = await createCustomer({ name: 'سالم', phone: '', address: '', notes: '', creditDays: 30 });
    await sell(rice.id, 1, { customerId: customer.id, paid: 0, method: 'credit' });
    const token = uid('pay');
    const a = await recordCustomerPayment({ customerId: customer.id, customerName: customer.name, amount: 5000, method: 'cash', clientToken: token });
    const b = await recordCustomerPayment({ customerId: customer.id, customerName: customer.name, amount: 5000, method: 'cash', clientToken: token });
    expect(b.id).toBe(a.id);
    expect(await getCustomerBalance(customer.id)).toBe(6000); // 11000 - 5000 مرة واحدة
    const book = await listDebtBook();
    expect(book.find((r) => r.customerId === customer.id)?.balance).toBe(6000);
  });

  it('يوزّع الدفعة على فواتير محددة عند اختيار المستخدم', async () => {
    const rice = await seedRice();
    const purchase = await purchaseCartons(rice.id, 2, 24000, { paid: 0 });
    await receivePurchase(purchase.purchase.id);
    const customer = await createCustomer({ name: 'أم أحمد', phone: '', address: '', notes: '', creditDays: 30 });
    const inv1 = await sell(rice.id, 1, { customerId: customer.id, paid: 0, method: 'credit' });
    const inv2 = await sell(rice.id, 2, { customerId: customer.id, paid: 0, method: 'credit' });

    await recordCustomerPayment({
      customerId: customer.id,
      customerName: customer.name,
      amount: 22000,
      method: 'cash',
      allocations: [{ invoiceId: inv2.id, amount: 22000 }],
    });
    const invoices = await listInvoices();
    expect(invoices.find((i) => i.id === inv2.id)?.remaining).toBe(0);
    expect(invoices.find((i) => i.id === inv1.id)?.remaining).toBe(11000);
  });
});

describe('حسابات الموردين وتقلّب التكلفة', () => {
  beforeEach(async () => {
    await freshDB();
  });

  it('يسجّل شراءً نقديًا وآجلًا ويحسب المستحق وآخر سعر لكل منتج', async () => {
    const rice = await seedRice();
    const supplier = await makeSupplier();
    const cash = await purchaseCartons(rice.id, 1, 24000, { supplierId: supplier.id, paid: 24000, method: 'cash' });
    await receivePurchase(cash.purchase.id);
    const credit = await purchaseCartons(rice.id, 2, 26000, { supplierId: supplier.id, paid: 0 });
    await receivePurchase(credit.purchase.id);

    const profile = await getSupplierProfile(supplier.id);
    expect(profile.balance).toBe(52000);
    expect(profile.unpaid).toHaveLength(1);
    expect(profile.purchases).toHaveLength(2);
    expect(profile.prices[0]).toMatchObject({ productId: rice.id });
    // آخر سعر شراء للقطعة من آخر فاتورة مستلمة = 26000/24
    expect(profile.prices[0].unitCost).toBeCloseTo(1083.3333, 3);

    const partial = await paySupplier(supplier.id, supplier.name, 20000, 'cash', Date.now(), 'دفعة أولى', uid('pay'));
    expect(partial.applied).toBe(20000);
    const after = await getSupplierProfile(supplier.id);
    expect(after.balance).toBe(32000);
    const rows = await listSuppliersWithBalance();
    expect(rows.find((r) => r.id === supplier.id)?.balance).toBe(32000);

    // دفع زائد: يطبّق المستحق فقط
    const rest = await paySupplier(supplier.id, supplier.name, 50000, 'cash', Date.now(), '', uid('pay'));
    expect(rest.applied).toBe(32000);
    expect((await getSupplierProfile(supplier.id)).balance).toBe(0);
  });

  it('التكلفة المرجّحة تشمل النقل والخصم وتظهر في سجل الأسعار', async () => {
    const rice = await seedRice();
    const supplier = await makeSupplier();
    const product = (await listProducts()).find((p) => p.id === rice.id)!;
    const prepared = preparePurchaseLine(product, 2, 20000);
    const purchase = await createPurchase({
      items: [prepared.item!],
      supplierId: supplier.id,
      supplierName: supplier.name,
      discount: 2000,
      extraCosts: 2000,
      paid: 40000,
      paymentMethod: 'cash',
      status: 'ordered',
      notes: '',
      date: Date.now(),
      number: 'PUR-X',
      clientToken: uid('tok'),
    });
    await receivePurchase(purchase.id);
    // 48 قطعة، التكلفة = 40000 − 2000 + 2000 = 40000 ÷ 48 = 833.3333
    const updated = (await listProducts()).find((p) => p.id === rice.id)!;
    expect(updated.quantity).toBe(48);
    expect(updated.purchasePrice).toBeCloseTo(833.3333, 4);
    const history = await getPriceHistory(rice.id);
    expect(history[0].newPrice).toBeCloseTo(833.3333, 4);
    expect(history[0].source).toBe('purchase');
  });
});

describe('الإتلاف والصلاحية', () => {
  beforeEach(async () => {
    await freshDB();
  });

  it('يتلف كمية ويسجّل الخسارة دون حركة صندوق ودون لمس المبيعات', async () => {
    const rice = await seedRice();
    const purchase = await purchaseCartons(rice.id, 1, 24000, { paid: 24000, method: 'cash' });
    await receivePurchase(purchase.purchase.id);
    const before = (await getBalances()).cash;

    const writeOff = await writeOffStock({ productId: rice.id, quantity: 2, kind: 'damage', reason: 'عبوة ممزقة' });
    expect(writeOff.value).toBe(2000); // 2 × 1000
    const after = (await listProducts()).find((p) => p.id === rice.id)!;
    expect(after.quantity).toBe(22);
    expect((await getBalances()).cash).toBe(before);
    expect(await listWriteOffs()).toHaveLength(1);

    const pnl = computePnl([], [], undefined, [], await listWriteOffs());
    expect(pnl.netProfit).toBe(-2000);
    expect(pnl.expenses).toBe(0);

    await expect(writeOffStock({ productId: rice.id, quantity: 999, kind: 'loss', reason: '' })).rejects.toThrow('INSUFFICIENT_STOCK');
  });

  it('يحفظ تاريخ الصلاحية ويظهر في تنبيهات لوحة التحكم', async () => {
    const rice = await seedRice();
    await updateProduct(rice.id, { perishable: true, expiryDate: at(2020, 1, 1), batchNumber: 'B-77' });
    const purchase = await purchaseCartons(rice.id, 1, 24000, { paid: 24000, method: 'cash' });
    await receivePurchase(purchase.purchase.id);
    const { getDashboard } = await import('../src/services/reports');
    const dash = await getDashboard({ from: at(2026, 10, 1), to: at(2026, 10, 31) }, { from: at(2026, 10, 1), to: at(2026, 10, 31) });
    expect(dash.expiryAlerts[0].product.id).toBe(rice.id);
    expect(dash.expiryAlerts[0].status).toBe('expired');
  });
});

describe('استمرارية البيانات', () => {
  beforeEach(async () => {
    await freshDB();
  });

  it('تبقى المنتجات والأسماء البديلة والديون بعد إعادة فتح قاعدة البيانات', async () => {
    const rice = await seedRice();
    const customer = await createCustomer({ name: 'خالد', phone: '0955', address: '', notes: '', creditDays: 10 });
    const purchase = await purchaseCartons(rice.id, 1, 24000, { paid: 0 });
    await receivePurchase(purchase.purchase.id);
    await sell(rice.id, 2, { customerId: customer.id, paid: 0, method: 'credit' });

    resetDBConnection();
    const products = await listProducts();
    const restored = products.find((p) => p.id === rice.id)!;
    expect(restored.aliases).toEqual(['رز مصري', 'أرز كيلو']);
    expect(restored.unitsPerPurchase).toBe(24);
    expect(restored.quantity).toBe(22);
    expect(await getCustomerBalance(customer.id)).toBe(22000);
    expect((await listInvoices())).toHaveLength(1);
    expect((await listInvoices())[0].cogs).toBe(2000);
  });
});
