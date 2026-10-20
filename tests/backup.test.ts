/**
 * اختبارات النسخ الاحتياطي: تصدير → مسح → استيراد، بما في ذلك صور الفواتير
 * (Blob ← data URL ← Blob) وسياسة التسعير وسجل المبيعات اليدوي.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { freshDB } from './helpers';
import { createProduct, listProducts } from '../src/services/products';
import { createManualSale, listManualSales } from '../src/services/manualSales';
import { storeInvoiceImage, getInvoiceImage } from '../src/services/scannedInvoices';
import { clearAllData, exportBackup, importBackup } from '../src/services/backup';
import { getSettings, saveSettings } from '../src/services/settings';

const PRODUCT_INPUT = {
  name: 'زيت زيتون 1 لتر',
  code: 'OIL01',
  barcode: '6291000123456',
  category: 'المواد الغذائية',
  purchasePrice: 18,
  salePrice: 24,
  quantity: 12,
  alertThreshold: 2,
  supplierId: null,
  description: '',
};

describe('النسخ الاحتياطي والاستعادة', () => {
  beforeEach(async () => {
    await freshDB();
  });

  it('يصدّر كل الجداول ويستعيدها بعد المسح', async () => {
    const product = await createProduct(PRODUCT_INPUT);
    await createManualSale({
      productId: product.id,
      productName: product.name,
      quantity: 2,
      unitPrice: 24,
      unitCost: 18,
      buyerName: 'أبو سامر',
      clientToken: 'backup-token-1',
      stockApplied: true,
    });

    const settings = await getSettings();
    await saveSettings({ ...settings, salePricePolicy: 'never', defaultMarginPercent: 32 });
    await storeInvoiceImage(new Blob(['fake-image-bytes'], { type: 'image/png' }), {
      name: 'invoice.png',
      width: 800,
      height: 1200,
    });

    const backup = await exportBackup();
    expect(backup.app).toBe('masroofi-store-manager');
    expect(backup.version).toBe(3);
    expect(backup.data.products).toHaveLength(1);
    expect(backup.data.manualSales).toHaveLength(1);
    expect(backup.data.invoiceImages).toHaveLength(1);
    expect(backup.data.invoiceImages![0].dataUrl.startsWith('data:image/png;base64,')).toBe(true);

    await clearAllData();
    expect(await listProducts()).toHaveLength(0);

    await importBackup(backup);

    const products = await listProducts();
    expect(products).toHaveLength(1);
    expect(products[0].name).toBe(PRODUCT_INPUT.name);
    expect(products[0].barcode).toBe(PRODUCT_INPUT.barcode);

    const sales = await listManualSales();
    expect(sales).toHaveLength(1);
    expect(sales[0].total).toBe(48);
    expect(sales[0].buyerName).toBe('أبو سامر');

    const restoredSettings = await getSettings();
    expect(restoredSettings.salePricePolicy).toBe('never');
    expect(restoredSettings.defaultMarginPercent).toBe(32);

    const images = (await exportBackup()).data.invoiceImages ?? [];
    expect(images).toHaveLength(1);
    const image = await getInvoiceImage(images[0].id);
    expect(image).toBeTruthy();
    expect(image!.mimeType).toBe('image/png');
    expect(await image!.blob.text()).toBe('fake-image-bytes');
  });

  it('يحوّل الصور ذهابًا وإيابًا دون فقدان البايتات', async () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 251, 255, 128, 64]);
    const image = await storeInvoiceImage(new Blob([bytes], { type: 'image/jpeg' }), {
      name: 'binary.jpg',
      width: 10,
      height: 10,
    });
    const backup = await exportBackup();
    await clearAllData();
    await importBackup(backup);

    const restored = await getInvoiceImage(image.id);
    expect(restored).toBeTruthy();
    expect(restored!.blob.type).toBe('image/jpeg');
    const roundTrip = new Uint8Array(await restored!.blob.arrayBuffer());
    expect(Array.from(roundTrip)).toEqual(Array.from(bytes));
  });

  it('يرفض ملفًا غير صالح دون المساس بالبيانات الحالية', async () => {
    await createProduct(PRODUCT_INPUT);
    await expect(
      importBackup({ app: 'other-app', version: 1, exportedAt: 0, data: { products: [] } } as never),
    ).rejects.toThrow('INVALID_BACKUP');
    expect(await listProducts()).toHaveLength(1);
  });

  it('يستعيد نسخة قديمة (v1) بلا الجداول الجديدة', async () => {
    await createProduct(PRODUCT_INPUT);
    const backup = await exportBackup();
    const legacy = {
      ...backup,
      version: 1,
      data: {
        ...backup.data,
        manualSales: undefined,
        categories: undefined,
        priceHistory: undefined,
        scannedInvoices: undefined,
        invoiceImages: undefined,
        audit: undefined,
      },
    };
    await clearAllData();
    await importBackup(legacy);

    expect(await listProducts()).toHaveLength(1);
    expect(await listManualSales()).toHaveLength(0);
    expect(await getSettings()).toBeTruthy();
  });
});
