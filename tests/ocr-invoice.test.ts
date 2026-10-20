/**
 * اختبارات مسح الفواتير: تحليل نص OCR، مطابقة المنتجات، تحديث الأسعار،
 * كشف التكرار، أرشفة الصور، والبحث في مكتبة الفواتير.
 * النصوص المستخدمة مأخوذة من تشغيل فعلي لمحرك tesseract على صورة فاتورة عربية.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { at, freshDB } from './helpers';
import { listProducts, createProduct } from '../src/services/products';
import { getPriceHistory, suggestSalePrice, setProductPrice, summarizePriceChanges } from '../src/services/prices';
import { parseInvoiceText, parseDateFromText } from '../src/services/ocr/parseInvoice';
import { rankProductMatches, cleanProductName } from '../src/services/ocr/matchProducts';
import {
  confirmScannedInvoice,
  findDuplicates,
  filterInvoiceLibrary,
  invoicesForProduct,
  listScannedInvoices,
  storeInvoiceImage,
  getInvoiceImage,
  invoiceFingerprint,
  ScannedInvoiceError,
  type ConfirmScannedInvoiceInput,
} from '../src/services/scannedInvoices';
import { ensureCategories, suggestCategory, createCategory, categoryKey } from '../src/services/categories';
import type { ScannedInvoiceItem } from '../src/types';

/** نص حقيقي من tesseract.js 7 على صورة فاتورة عربية (ثقة 92%) */
export const OCR_TEXT_AR = `شركة النور للتجارة

فاتورة شراء

رقم الفاتورة: 4582

التاريخ: 18-10-2026

المورد: مؤسسة الأمانة

الصنف الكمية سعر الوحدة الإجمالي
حليب المراعي 1 لتر 12 6.50 78.00

شاي ليبتون 400 جم 6 18.00 108.00
صابون ديتول 165 جم 24 425 102.00
زيت عافية 1.8 لتر 8 32.75 262.00
خصم: 20.00

الضريبة: 52.90

الإجمالي: 582.90`;

function item(partial: Partial<ScannedInvoiceItem> & { name: string }): ScannedInvoiceItem {
  return {
    id: partial.id ?? `row-${Math.random().toString(36).slice(2, 8)}`,
    rawName: partial.rawName ?? partial.name,
    name: partial.name,
    quantity: partial.quantity ?? 1,
    unitPrice: partial.unitPrice ?? 10,
    lineTotal: partial.lineTotal ?? (partial.quantity ?? 1) * (partial.unitPrice ?? 10),
    discount: 0,
    tax: 0,
    unit: partial.unit ?? '',
    productId: partial.productId ?? null,
    matchState: partial.matchState ?? 'unlinked',
    matchScore: partial.matchScore ?? 0,
    confidence: partial.confidence ?? 0.9,
    needsReview: partial.needsReview ?? false,
  };
}

function baseInvoice(overrides: Partial<ConfirmScannedInvoiceInput> = {}): ConfirmScannedInvoiceInput {
  return {
    supplierName: 'مؤسسة الأمانة',
    invoiceNumber: '4582',
    invoiceDate: at(2026, 10, 18),
    subtotal: 550,
    discount: 20,
    tax: 52.9,
    total: 582.9,
    items: [],
    rawText: OCR_TEXT_AR,
    imageId: null,
    imageName: 'invoice-ar.png',
    ocrConfidence: 92,
    engine: 'tesseract.js (LSTM) — ara+eng',
    applyPurchasePrices: true,
    ...overrides,
  };
}

describe('تحليل نص الفاتورة', () => {
  it('يستخرج المورد والرقم والتاريخ والبنود والإجماليات من نص OCR عربي حقيقي', () => {
    const parsed = parseInvoiceText(OCR_TEXT_AR, { engineConfidence: 92 });
    expect(parsed.supplierName).toBe('مؤسسة الأمانة');
    expect(parsed.invoiceNumber).toBe('4582');
    expect(new Date(parsed.invoiceDate ?? 0).getDate()).toBe(18);
    expect(new Date(parsed.invoiceDate ?? 0).getMonth()).toBe(9);
    expect(parsed.items).toHaveLength(4);
    expect(parsed.discount).toBe(20);
    expect(parsed.tax).toBe(52.9);
    expect(parsed.total).toBe(582.9);
    expect(parsed.subtotal).toBe(550);
    expect(parsed.warnings).toHaveLength(0);
  });

  it('يستنتج سعر الوحدة الصحيح عندما تُقرأ الفاصلة العشرية خطأ (425 بدل 4.25) ويعلّم السطر للمراجعة', () => {
    const parsed = parseInvoiceText(OCR_TEXT_AR);
    const soap = parsed.items.find((i) => i.name.includes('ديتول'));
    expect(soap).toBeDefined();
    expect(soap?.quantity).toBe(24);
    expect(soap?.unitPrice).toBe(4.25);
    expect(soap?.lineTotal).toBe(102);
    expect(soap?.needsReview).toBe(true);
    // لا يُخلط حجم العبوة (165 جم) بالكمية
    expect(soap?.name).toContain('165');
  });

  it('لا يعتبر إجمالي السطر سعرًا للوحدة عندما تكون الكمية أكبر من واحد', () => {
    const parsed = parseInvoiceText('صنف تجريبي 5 12.00 60.00');
    expect(parsed.items[0].quantity).toBe(5);
    expect(parsed.items[0].unitPrice).toBe(12);
    expect(parsed.items[0].lineTotal).toBe(60);
  });

  it('يدعم الأرقام العربية الهندية والفارسية والفاصلة العشرية العربية', () => {
    const parsed = parseInvoiceText('المورد: متجر النخبة\nالمنتج الكمية السعر الإجمالي\nزيت زيتون ٤ ٢٥٫٥٠ ١٠٢٫٠٠\nالإجمالي: ١٠٢٫٠٠');
    expect(parsed.items[0].quantity).toBe(4);
    expect(parsed.items[0].unitPrice).toBe(25.5);
    expect(parsed.items[0].lineTotal).toBe(102);
    expect(parsed.total).toBe(102);
    expect(parsed.supplierName).toBe('متجر النخبة');
  });

  it('يعمل مع فاتورة إنجليزية بأعمدة مختلفة الترتيب', () => {
    const parsed = parseInvoiceText(`ACME SUPPLIES
Invoice No: INV-9021
Date: 2026-03-05
Supplier: ACME Ltd
Description Qty Unit Price Amount
Olive Oil 1L 10 8.50 85.00
Dish Soap 6 3.25 19.50
Discount: 4.50
Total: 100.00`);
    expect(parsed.invoiceNumber).toBe('INV-9021');
    expect(parsed.supplierName).toBe('ACME Ltd');
    expect(parsed.items).toHaveLength(2);
    expect(parsed.items[0].unitPrice).toBe(8.5);
    expect(parsed.discount).toBe(4.5);
    expect(parsed.total).toBe(100);
  });

  it('يحذر عندما لا يطابق الإجمالي مجموع البنود', () => {
    const parsed = parseInvoiceText('المنتج الكمية السعر الإجمالي\nصنف أ 2 10 20.00\nصنف ب 1 5 5.00\nالإجمالي: 90.00');
    expect(parsed.warnings.join(' ')).toContain('لا يطابق');
    expect(parsed.fieldConfidence.total).toBeLessThan(0.5);
  });

  it('يتعرف على صيغ تواريخ متعددة دون انزياح زمني', () => {
    expect(new Date(parseDateFromText('15/07/2026') ?? 0).getDate()).toBe(15);
    expect(new Date(parseDateFromText('2026-12-01') ?? 0).getMonth()).toBe(11);
    expect(new Date(parseDateFromText('3 مارس 2026') ?? 0).getDate()).toBe(3);
    expect(new Date(parseDateFromText('October 9, 2026') ?? 0).getMonth()).toBe(9);
  });
});

describe('مطابقة المنتجات والتصنيفات', () => {
  beforeEach(async () => {
    await freshDB();
  });

  async function products() {
    return [
      await createProduct({ name: 'حليب المراعي 1 لتر', code: '', barcode: '6281001', category: 'المواد الغذائية', purchasePrice: 5, salePrice: 6.5, quantity: 10, alertThreshold: 2, supplierId: null, description: '' }),
      await createProduct({ name: 'شاي ليبتون 400 جم', code: '', barcode: '', category: 'المواد الغذائية', purchasePrice: 15, salePrice: 18, quantity: 5, alertThreshold: 2, supplierId: null, description: '' }),
      await createProduct({ name: 'صابون ديتول 165 جم', code: '', barcode: '', category: 'المنظفات', purchasePrice: 4, salePrice: 5, quantity: 8, alertThreshold: 2, supplierId: null, description: '' }),
    ];
  }

  it('يطابق الاسم مع اختلاف التشكيل وأل التعريف', async () => {
    const list = await products();
    const match = rankProductMatches('حليب المراعى 1 لتر', list)[0];
    expect(match.product.name).toBe('حليب المراعي 1 لتر');
    expect(match.confidence).toBe('high');
  });

  it('لا يربط منتجًا بحجم مختلف بثقة عالية', async () => {
    const list = await products();
    const match = rankProductMatches('شاي ليبتون 250 جم', list)[0];
    expect(match.product.name).toBe('شاي ليبتون 400 جم');
    expect(match.confidence).not.toBe('high');
  });

  it('يعيد لا شيء لمنتج غير معروف تمامًا', async () => {
    const list = await products();
    const matches = rankProductMatches('بطاريات شحن سريع 20000', list);
    expect(matches[0]?.confidence ?? 'low').toBe('low');
  });

  it('ينظف اسم الصنف من ضجيج OCR', () => {
    expect(cleanProductName('  | صابون ديتول 165 جم :  ')).toBe('صابون ديتول 165 جم');
  });

  it('يقترح التصنيف المناسب ويطلب تدخلًا عند الغموض', async () => {
    const cats = await ensureCategories();
    expect(suggestCategory('حليب المراعي 1 لتر', cats).category).toBe('المواد الغذائية');
    expect(suggestCategory('صابون ديتول', cats).category).toBe('المنظفات');
    expect(suggestCategory('قطعة معدنية غير معروفة', cats).category).toBeNull();
  });

  it('يمنع تكرار التصنيفات باختلاف بسيط في الكتابة', async () => {
    await ensureCategories();
    const a = await createCategory('العناية الشخصية');
    const b = await createCategory('العنايه الشخصيه');
    expect(a.id).toBe(b.id);
    expect(categoryKey('المواد الغذائية')).toBe(categoryKey('مواد غذائية'));
  });
});

describe('اعتماد الفاتورة وتحديث الأسعار', () => {
  beforeEach(async () => {
    await freshDB();
  });

  async function seed() {
    const milk = await createProduct({ name: 'حليب المراعي 1 لتر', code: '', barcode: '', category: 'المواد الغذائية', purchasePrice: 5, salePrice: 6.5, quantity: 10, alertThreshold: 2, supplierId: null, description: '' });
    const tea = await createProduct({ name: 'شاي ليبتون 400 جم', code: '', barcode: '', category: 'المواد الغذائية', purchasePrice: 15, salePrice: 18, quantity: 5, alertThreshold: 2, supplierId: null, description: '' });
    const untouched = await createProduct({ name: 'زيت عافية 1.8 لتر', code: '', barcode: '', category: 'المواد الغذائية', purchasePrice: 30, salePrice: 38, quantity: 4, alertThreshold: 2, supplierId: null, description: '' });
    return { milk, tea, untouched };
  }

  it('يرفع سعر الشراء ويسجّل التاريخ والمصدر دون تغيير سعر البيع', async () => {
    const { milk, untouched } = await seed();
    const invoice = await confirmScannedInvoice(
      baseInvoice({
        items: [item({ name: milk.name, productId: milk.id, matchState: 'matched', quantity: 12, unitPrice: 5.75, lineTotal: 69 })],
        subtotal: 69,
        discount: 0,
        tax: 0,
        total: 69,
      }),
    );

    const after = (await listProducts()).find((p) => p.id === milk.id)!;
    expect(after.purchasePrice).toBe(5.75);
    expect(after.salePrice).toBe(6.5); // لم يتغيّر تلقائيًا
    expect(after.purchasePriceUpdatedAt).toBeGreaterThan(0);

    const untouchedAfter = (await listProducts()).find((p) => p.id === untouched.id)!;
    expect(untouchedAfter.purchasePrice).toBe(30);
    expect(untouchedAfter.salePrice).toBe(38);

    const history = await getPriceHistory(milk.id);
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ field: 'purchase', oldPrice: 5, newPrice: 5.75, source: 'scanned_invoice' });
    expect(history[0].sourceLabel).toContain('4582');

    expect(invoice.priceUpdates[0]).toMatchObject({ action: 'updated', oldPrice: 5, newPrice: 5.75 });
    expect(invoice.status).toBe('confirmed');
    expect(await listScannedInvoices()).toHaveLength(1);
  });

  it('يخفض سعر الشراء ويسجّل الانخفاض بوضوح', async () => {
    const { milk } = await seed();
    await confirmScannedInvoice(
      baseInvoice({
        items: [item({ name: milk.name, productId: milk.id, matchState: 'matched', quantity: 12, unitPrice: 4.4, lineTotal: 52.8 })],
        subtotal: 52.8, discount: 0, tax: 0, total: 52.8,
      }),
    );
    const history = await getPriceHistory(milk.id);
    expect(history[0]).toMatchObject({ oldPrice: 5, newPrice: 4.4 });
    expect(history[0].newPrice).toBeLessThan(history[0].oldPrice);
  });

  it('لا ينشئ سجل سعر عند عدم التغيّر', async () => {
    const { milk } = await seed();
    const invoice = await confirmScannedInvoice(
      baseInvoice({
        items: [item({ name: milk.name, productId: milk.id, matchState: 'matched', quantity: 12, unitPrice: 5, lineTotal: 60 })],
        subtotal: 60, discount: 0, tax: 0, total: 60,
      }),
    );
    expect(await getPriceHistory(milk.id)).toHaveLength(0);
    expect(invoice.priceUpdates[0].action).toBe('unchanged');
  });

  it('يُنشئ منتجًا جديدًا عند التأكيد مع تصنيفه وسعره', async () => {
    await seed();
    const row = item({ name: 'مياه معدنية 600 مل', matchState: 'new', quantity: 24, unitPrice: 1.25, lineTotal: 30 });
    const invoice = await confirmScannedInvoice(
      baseInvoice({
        items: [row],
        subtotal: 30, discount: 0, tax: 0, total: 30,
        newProducts: [{ itemId: row.id, name: 'مياه معدنية 600 مل', category: 'المشروبات', salePrice: 2, unit: 'ml' }],
      }),
    );
    const newProduct = (await listProducts()).find((p) => p.name === 'مياه معدنية 600 مل');
    expect(newProduct).toBeDefined();
    expect(newProduct?.purchasePrice).toBe(1.25);
    expect(newProduct?.salePrice).toBe(2);
    expect(newProduct?.category).toBe('المشروبات');
    expect(invoice.items[0].productId).toBe(newProduct?.id);
    expect(invoice.items[0].matchState).toBe('new');
    const history = await getPriceHistory(newProduct!.id);
    expect(history[0]).toMatchObject({ field: 'purchase', oldPrice: 0, newPrice: 1.25 });
  });

  it('يطبّق سعر البيع فقط عند موافقة صريحة', async () => {
    const { milk } = await seed();
    const row = item({ name: milk.name, productId: milk.id, matchState: 'matched', quantity: 12, unitPrice: 6, lineTotal: 72 });
    const invoice = await confirmScannedInvoice(
      baseInvoice({
        items: [row],
        subtotal: 72, discount: 0, tax: 0, total: 72,
        priceDecisions: [{ itemId: row.id, newSalePrice: 8 }],
      }),
    );
    const after = (await listProducts()).find((p) => p.id === milk.id)!;
    expect(after.purchasePrice).toBe(6);
    expect(after.salePrice).toBe(8);
    const history = await getPriceHistory(milk.id);
    expect(history.some((h) => h.field === 'sale' && h.newPrice === 8)).toBe(true);
    expect(invoice.priceUpdates).toHaveLength(1);
  });

  it('يمنع حفظ الفاتورة نفسها مرتين ويكشف التكرار قبل الحفظ', async () => {
    const { milk } = await seed();
    const input = baseInvoice({
      items: [item({ name: milk.name, productId: milk.id, matchState: 'matched', quantity: 12, unitPrice: 5.5, lineTotal: 66 })],
      subtotal: 66, discount: 0, tax: 0, total: 66,
    });
    await confirmScannedInvoice(input);
    const dups = await findDuplicates({ supplierName: input.supplierName, invoiceNumber: input.invoiceNumber, invoiceDate: input.invoiceDate, total: input.total });
    expect(dups).toHaveLength(1);
    await expect(confirmScannedInvoice(input)).rejects.toBeInstanceOf(ScannedInvoiceError);

    // الأسعار لم تتغيّر بعد المحاولة المرفوضة
    const after = (await listProducts()).find((p) => p.id === milk.id)!;
    expect(after.purchasePrice).toBe(5.5);
    expect(await listScannedInvoices()).toHaveLength(1);

    // يمكن اعتمادها صراحةً عند المراجعة
    const forced = await confirmScannedInvoice({ ...input, allowDuplicate: true });
    expect(forced.duplicateOf).not.toBeNull();
  });

  it('لا يغيّر شيئًا إذا كانت البنود فارغة (فحص قبل أي كتابة)', async () => {
    const { milk } = await seed();
    await expect(
      confirmScannedInvoice(baseInvoice({ items: [], total: 0 })),
    ).rejects.toBeInstanceOf(ScannedInvoiceError);
    const after = (await listProducts()).find((p) => p.id === milk.id)!;
    expect(after.purchasePrice).toBe(5);
    expect(await listScannedInvoices()).toHaveLength(0);
  });

  it('يخزّن الصورة الأصلية بشكل دائم ويستعيدها', async () => {
    const blob = new Blob([new Uint8Array([137, 80, 78, 71, 1, 2, 3])], { type: 'image/png' });
    const image = await storeInvoiceImage(blob, { name: 'scan.png', width: 1200, height: 900 });
    const restored = await getInvoiceImage(image.id);
    expect(restored).toBeDefined();
    expect(restored?.mimeType).toBe('image/png');
    expect(restored?.name).toBe('scan.png');
    expect(restored?.blob.size).toBe(blob.size);
    expect(restored?.width).toBe(1200);
  });

  it('يبحث في المكتبة عن منتج داخل فاتورة قديمة', async () => {
    const { milk } = await seed();
    await confirmScannedInvoice(
      baseInvoice({
        items: [item({ name: milk.name, productId: milk.id, matchState: 'matched', quantity: 12, unitPrice: 5.2, lineTotal: 62.4 })],
        subtotal: 62.4, discount: 0, tax: 0, total: 62.4,
      }),
    );
    const library = await listScannedInvoices();
    expect(filterInvoiceLibrary(library, { q: 'حليب' })).toHaveLength(1);
    expect(filterInvoiceLibrary(library, { q: 'ديتول' })).toHaveLength(0);
    expect(filterInvoiceLibrary(library, { q: '4582' })).toHaveLength(1);
    expect(filterInvoiceLibrary(library, { q: '5.2' })).toHaveLength(1);
    expect(filterInvoiceLibrary(library, { supplier: 'الأمانة' })).toHaveLength(1);
    expect(invoicesForProduct(library, milk.id, milk.name)).toHaveLength(1);
  });

  it('يحسب بصمة تكرار مستقرة بعد تطبيع الأرقام العربية', () => {
    const a = invoiceFingerprint({ supplierName: 'مؤسسة الأمانة', invoiceNumber: '٤٥٨٢', invoiceDate: at(2026, 10, 18), total: 582.9 });
    const b = invoiceFingerprint({ supplierName: 'مؤسسة  الامانة', invoiceNumber: '4582', invoiceDate: at(2026, 10, 18), total: 582.9 });
    expect(a).toBe(b);
  });
});

describe('سياسة الأسعار', () => {
  beforeEach(async () => {
    await freshDB();
  });

  it('يقترح سعر بيع من الهامش مع تقريب لأعلى', () => {
    expect(suggestSalePrice(10, { marginPercent: 25, roundTo: 0 })).toBe(12.5);
    expect(suggestSalePrice(10, { marginPercent: 25, roundTo: 0.25 })).toBe(12.5);
    expect(suggestSalePrice(9.9, { marginPercent: 30, roundTo: 0.5 })).toBe(13);
    expect(suggestSalePrice(0)).toBeNull();
  });

  it('يحدّث سعر المنتج يدويًا ويسجّل التغيير مرة واحدة فقط', async () => {
    const p = await createProduct({ name: 'منتج', code: '', barcode: '', category: 'منتجات أخرى', purchasePrice: 10, salePrice: 14, quantity: 1, alertThreshold: 1, supplierId: null, description: '' });
    const first = await setProductPrice(p.id, 'purchase', 11, { source: 'manual', sourceLabel: 'تعديل يدوي' });
    expect(first.changed).toBe(true);
    const second = await setProductPrice(p.id, 'purchase', 11, { source: 'manual' });
    expect(second.changed).toBe(false);
    expect(await getPriceHistory(p.id)).toHaveLength(1);
  });

  it('يصنّف التغيّرات إلى ارتفاع/انخفاض/ثبات', () => {
    const summary = summarizePriceChanges([
      { productId: '1', productName: 'أ', field: 'purchase', oldPrice: 5, newPrice: 6, changed: true, reason: 'increase' },
      { productId: '2', productName: 'ب', field: 'purchase', oldPrice: 5, newPrice: 4, changed: true, reason: 'decrease' },
      { productId: '3', productName: 'ج', field: 'purchase', oldPrice: 5, newPrice: 5, changed: false, reason: 'same' },
    ]);
    expect(summary.increases).toHaveLength(1);
    expect(summary.decreases).toHaveLength(1);
    expect(summary.unchanged).toHaveLength(1);
  });
});
