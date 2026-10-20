/**
 * اختبارات سجل المبيعات اليدوي والأرشفة والبحث والتقارير.
 * السيناريوهات المطلوبة: تسجيل بيع ثم إيجاده في الأرشيف، انتقال اليوم،
 * البحث في السجلات القديمة، منع التكرار، وعدم احتساب البيع مرتين.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { at, freshDB } from './helpers';
import { createProduct, listProducts } from '../src/services/products';
import { createSale, getNextInvoiceNumber } from '../src/services/sales';
import {
  createManualSale,
  deleteManualSale,
  listManualSales,
  updateManualSale,
  ManualSaleError,
} from '../src/services/manualSales';
import { filterSalesLog, groupByDay, loadSalesLog, sumEntries } from '../src/services/salesLog';
import { computePnl, getDashboard, buildTopProducts } from '../src/services/reports';
import { listAudit } from '../src/services/audit';
import { getBalances } from '../src/services/cash';
import { listCategories } from '../src/services/categories';
import { getPriceHistory } from '../src/services/prices';

async function seedProduct(name = 'حليب المراعي 1 لتر', quantity = 20, cost = 5, sale = 6.5) {
  return createProduct({
    name,
    code: '',
    barcode: '',
    category: 'المواد الغذائية',
    purchasePrice: cost,
    salePrice: sale,
    quantity,
    alertThreshold: 3,
    supplierId: null,
    description: '',
  });
}

describe('سجل المبيعات اليدوي', () => {
  beforeEach(async () => {
    await freshDB();
  });

  it('يسجّل بيعًا مخزنيًا: يخصم المخزون ويضيف للمحصل ويظهر في سجل اليوم', async () => {
    const product = await seedProduct();
    const { sale } = await createManualSale(
      {
        productId: product.id,
        productName: product.name,
        quantity: 3,
        unitPrice: 6.5,
        buyerName: 'أبو أحمد',
        clientToken: 'tok-1',
        stockApplied: true,
        date: at(2026, 10, 20, 10, 15),
      },
      { allowNegativeStock: false },
    );

    expect(sale.total).toBe(19.5);
    expect(sale.unitCost).toBe(5); // لقطة التكلفة من المنتج
    expect(sale.paid).toBe(19.5);
    expect(sale.number).toMatch(/^MS-\d{5}$/);

    const products = await listProducts();
    expect(products[0].quantity).toBe(17);

    const balances = await getBalances();
    expect(balances.cash).toBe(19.5);

    const log = await loadSalesLog();
    expect(log).toHaveLength(1);
    expect(log[0].source).toBe('manual');
    expect(log[0].buyerName).toBe('أبو أحمد');

    const days = groupByDay(log);
    expect(days[0].key).toBe('2026-10-20');
    expect(days[0].sales).toBe(19.5);
    expect(days[0].manualCount).toBe(1);
  });

  it('يمنع تكرار السجل بنفس التوكن (نقر مزدوج) دون خصم مخزون إضافي', async () => {
    const product = await seedProduct();
    const input = {
      productId: product.id,
      productName: product.name,
      quantity: 2,
      unitPrice: 6.5,
      clientToken: 'same-token',
      stockApplied: true,
      date: at(2026, 10, 20, 9),
    };
    const first = await createManualSale(input, { allowNegativeStock: false });
    const second = await createManualSale(input, { allowNegativeStock: false });
    expect(second.duplicate).toBe(true);
    expect(second.sale.id).toBe(first.sale.id);
    expect((await listProducts())[0].quantity).toBe(18);
    expect(await listManualSales()).toHaveLength(1);
  });

  it('يقبل بيعًا غير مخزني دون لمس المخزون', async () => {
    const product = await seedProduct();
    await createManualSale({
      productId: product.id,
      productName: product.name,
      quantity: 5,
      unitPrice: 10,
      clientToken: 'tok-2',
      stockApplied: false,
      date: at(2026, 10, 20, 11),
    });
    expect((await listProducts())[0].quantity).toBe(20);
    const log = await loadSalesLog();
    expect(sumEntries(log).sales).toBe(50);
  });

  it('يرفض البيع المخزني عند نقص الكمية', async () => {
    const product = await seedProduct('صنف نادر', 1, 10, 15);
    await expect(
      createManualSale(
        {
          productId: product.id,
          productName: product.name,
          quantity: 2,
          unitPrice: 15,
          clientToken: 'tok-3',
          stockApplied: true,
        },
        { allowNegativeStock: false },
      ),
    ).rejects.toBeInstanceOf(ManualSaleError);
    expect((await listProducts())[0].quantity).toBe(1);
  });

  it('ينشئ منتجًا جديدًا مع البيع دون إجبار المستخدم على مسار منفصل', async () => {
    const { sale } = await createManualSale({
      productId: null,
      productName: 'ماء النخيل 1.5 لتر',
      quantity: 4,
      unitPrice: 2.5,
      unitCost: 1.6,
      category: 'المشروبات',
      clientToken: 'tok-new',
      stockApplied: false,
      source: 'manual',
      createProduct: { category: 'المشروبات', salePrice: 2.5, initialQuantity: 0 },
    });

    const products = await listProducts();
    expect(products).toHaveLength(1);
    expect(products[0].name).toBe('ماء النخيل 1.5 لتر');
    expect(products[0].purchasePrice).toBe(1.6);
    expect(sale.productId).toBe(products[0].id);
    const categories = await listCategories();
    expect(categories.some((c) => c.name === 'المشروبات')).toBe(true);
  });

  it('يعدّل السجل فيصحّح المخزون والصندوق والمجموع', async () => {
    const product = await seedProduct();
    const { sale } = await createManualSale(
      {
        productId: product.id,
        productName: product.name,
        quantity: 2,
        unitPrice: 6.5,
        clientToken: 'tok-edit',
        stockApplied: true,
        date: at(2026, 10, 20, 10),
      },
      { allowNegativeStock: false },
    );

    const updated = await updateManualSale(
      sale.id,
      { quantity: 5, buyerName: 'سالم' },
      { allowNegativeStock: false },
    );

    expect(updated.total).toBe(32.5);
    expect(updated.buyerName).toBe('سالم');
    expect((await listProducts())[0].quantity).toBe(15); // 20 - 5
    expect((await getBalances()).cash).toBe(32.5);

    const audit = await listAudit();
    expect(audit.some((a) => a.action === 'update' && a.entityId === sale.id)).toBe(true);
  });

  it('يحذف السجل فيعيد المخزون ويصرف الحركة المالية ويحفظ أثرًا في سجل المراجعة', async () => {
    const product = await seedProduct();
    const { sale } = await createManualSale(
      {
        productId: product.id,
        productName: product.name,
        quantity: 4,
        unitPrice: 6.5,
        clientToken: 'tok-del',
        stockApplied: true,
        date: at(2026, 10, 20, 10),
      },
      { allowNegativeStock: false },
    );

    await deleteManualSale(sale.id);
    expect(await listManualSales()).toHaveLength(0);
    expect((await listProducts())[0].quantity).toBe(20);
    expect((await getBalances()).cash).toBe(0);
    const audit = await listAudit();
    expect(audit.some((a) => a.action === 'sale_delete' && a.entityId === sale.id)).toBe(true);
  });

  it('لا يحتسب البيع مرتين: الفاتورة تُحسب مرة والبيع اليدوي مرة، والمجموع مطابق', async () => {
    const product = await seedProduct();
    const number = await getNextInvoiceNumber('INV');
    await createSale(
      {
        lines: [{ productId: product.id, quantity: 2, unitPrice: 6.5 }],
        customerId: null,
        discount: 0,
        paid: 13,
        paymentMethod: 'cash',
        clientToken: 'sale-1',
        date: at(2026, 10, 20, 9),
      },
      { allowNegativeStock: false, nextInvoiceNumber: number },
    );
    await createManualSale({
      productId: product.id,
      productName: product.name,
      quantity: 1,
      unitPrice: 6.5,
      clientToken: 'manual-1',
      stockApplied: false,
      date: at(2026, 10, 20, 10),
    });

    const log = await loadSalesLog();
    // فاتورة واحدة + سجل يدوي واحد فقط (لا تكرار)
    expect(log).toHaveLength(2);
    expect(sumEntries(log).sales).toBe(19.5);

    const invoices = await (await import('../src/services/sales')).listInvoices();
    const manual = await listManualSales();
    const pnl = computePnl(invoices, [], { from: at(2026, 10, 20), to: at(2026, 10, 20) }, manual);
    expect(pnl.sales).toBe(19.5);
    expect(pnl.invoiceCount).toBe(1);
    expect(pnl.manualCount).toBe(1);

    const top = buildTopProducts(invoices, { from: at(2026, 10, 20), to: at(2026, 10, 20) }, manual);
    expect(top[0].quantity).toBe(3);
    expect(top[0].revenue).toBe(19.5);
  });

  it('يجمّع الأرشيف حسب يوم السجل لا حسب وقت فتح الصفحة', async () => {
    const product = await seedProduct();
    await createManualSale({
      productId: product.id,
      productName: product.name,
      quantity: 1,
      unitPrice: 6.5,
      clientToken: 'yesterday',
      stockApplied: false,
      date: at(2026, 10, 19, 23, 45),
    });
    await createManualSale({
      productId: product.id,
      productName: product.name,
      quantity: 2,
      unitPrice: 6.5,
      clientToken: 'today',
      stockApplied: false,
      date: at(2026, 10, 20, 0, 15),
    });

    const days = groupByDay(await loadSalesLog());
    expect(days.map((d) => d.key)).toEqual(['2026-10-20', '2026-10-19']);
    expect(days[0].sales).toBe(13);
    expect(days[1].sales).toBe(6.5);
    expect(days[1].count).toBe(1);
  });

  it('يبحث في كل السجلات بالاسم والجزء والسعر والتصنيف ورقم الفاتورة والمصدر', async () => {
    const product = await seedProduct();
    await createManualSale({
      productId: product.id,
      productName: 'حليب المراعي 1 لتر',
      quantity: 2,
      unitPrice: 6.5,
      category: 'المواد الغذائية',
      buyerName: 'خالد',
      clientToken: 's1',
      stockApplied: false,
      source: 'manual',
      date: at(2026, 10, 18, 10),
    });
    await createManualSale({
      productId: null,
      productName: 'شامبو هيد اند شولدرز',
      quantity: 1,
      unitPrice: 24,
      category: 'العناية الشخصية',
      clientToken: 's2',
      stockApplied: false,
      source: 'scanned',
      date: at(2026, 9, 2, 12),
    });
    const log = await loadSalesLog();

    expect(filterSalesLog(log, { q: 'مراعي' })).toHaveLength(1);
    expect(filterSalesLog(log, { q: 'حليب' })).toHaveLength(1);
    expect(filterSalesLog(log, { q: '6.5' })).toHaveLength(1);
    expect(filterSalesLog(log, { q: '24' })).toHaveLength(1);
    expect(filterSalesLog(log, { category: 'العناية الشخصية' })).toHaveLength(1);
    expect(filterSalesLog(log, { source: 'scanned' })).toHaveLength(1);
    expect(filterSalesLog(log, { q: 'MS-' })).toHaveLength(2);
    expect(filterSalesLog(log, { minPrice: 10, maxPrice: 30 })).toHaveLength(2);
    expect(filterSalesLog(log, { minPrice: 20, maxPrice: 30 })).toHaveLength(1);
    expect(
      filterSalesLog(log, { from: at(2026, 10, 1), to: at(2026, 10, 31) }),
    ).toHaveLength(1);
    expect(filterSalesLog(log, { q: 'شامبو', sort: 'oldest' })[0].date).toBeLessThan(
      filterSalesLog(log, { q: 'مراعي' })[0].date,
    );
  });

  it('يدرج السجلات اليدوية في لوحة التحكم والتقارير دون بيانات وهمية', async () => {
    const product = await seedProduct();
    await createManualSale({
      productId: product.id,
      productName: product.name,
      quantity: 2,
      unitPrice: 6.5,
      clientToken: 'dash',
      stockApplied: true,
      date: Date.now(),
    });
    const range = { from: Date.now() - 86_400_000, to: Date.now() };
    const data = await getDashboard(range, range, 7);
    expect(data.todaySales).toBe(13);
    expect(data.pnl.sales).toBe(13);
    expect(data.pnl.cogs).toBe(10);
    expect(data.pnl.grossProfit).toBe(3);
    expect(data.topProducts[0].name).toBe(product.name);
  });

  it('يسجّل تاريخ تغيّر السعر عند إنشاء منتج من بيع يدوي', async () => {
    await createManualSale({
      productId: null,
      productName: 'منتج بلا مخزون',
      quantity: 1,
      unitPrice: 9,
      unitCost: 6,
      clientToken: 'price-new',
      stockApplied: false,
      createProduct: { category: 'منتجات أخرى', salePrice: 9 },
    });
    const products = await listProducts();
    expect(products[0].purchasePrice).toBe(6);
    expect(products[0].salePrice).toBe(9);
    // لا يوجد سجل تغيير سعر عند الإنشاء الأول (السعر الافتتاحي ليس تغييرًا)
    expect(await getPriceHistory(products[0].id)).toHaveLength(0);
  });
});
