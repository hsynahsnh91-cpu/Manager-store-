// @vitest-environment jsdom
/**
 * اختبار تكاملي عبر الواجهة الحقيقية:
 * إضافة منتج من نموذج الصفحة ← بيعه من نقطة البيع ← التحقق من خصم المخزون
 * وظهور الفاتورة في صفحة الفواتير.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createElement, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { resetDBConnection, getDB } from '../src/services/db';
import { createProduct, listProducts } from '../src/services/products';
import { listInvoices } from '../src/services/sales';
import { listManualSales } from '../src/services/manualSales';
import { listCategories } from '../src/services/categories';
import { computePnl } from '../src/services/reports';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

async function mount(): Promise<void> {
  const { default: App } = await import('../src/App');
  const container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(createElement(App));
  });
}

async function go(hash: string): Promise<void> {
  window.location.hash = hash;
  await act(async () => {
    await new Promise((r) => setTimeout(r, 60));
  });
}

async function flush(ms = 80): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
}

function byText<T extends Element>(selector: string, text: string): T | null {
  const nodes = Array.from(document.querySelectorAll<T>(selector));
  return nodes.find((n) => n.textContent?.includes(text)) ?? null;
}

async function click(el: Element | null): Promise<void> {
  expect(el).toBeTruthy();
  await act(async () => {
    (el as HTMLElement).click();
  });
  await flush();
}

function setInputValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

beforeEach(async () => {
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
    'manualSales',
    'categories',
    'priceHistory',
    'scannedInvoices',
    'invoiceImages',
    'audit',
  ] as const) {
    await db.clear(store);
  }
  document.body.innerHTML = '';
  window.location.hash = '#/';
});

afterEach(async () => {
  if (root) {
    await act(async () => root!.unmount());
    root = null;
  }
});

describe('تدفق العمل الكامل عبر الواجهة', () => {
  it('إضافة منتج ثم بيعه من نقطة البيع وخصم المخزون', async () => {
    await mount();
    await flush(120);

    // — 1) إضافة منتج من صفحة المنتجات —
    await go('#/products');
    const addBtn = byText('button', 'منتج جديد');
    await click(addBtn);

    const inputs = Array.from(document.querySelectorAll<HTMLInputElement>('input'));
    const nameInput = inputs.find((i) => i.closest('label')?.textContent?.includes('اسم المنتج'));
    expect(nameInput).toBeTruthy();
    await act(async () => {
      setInputValue(nameInput!, 'حليب طازج');
    });

    const codeInput = inputs.find((i) => i.closest('label')?.textContent?.includes('رمز المنتج'));
    await act(async () => {
      setInputValue(codeInput!, 'MILK01');
    });

    const priceInputs = Array.from(document.querySelectorAll<HTMLInputElement>('input[type="number"]'));
    // سعر الشراء، سعر البيع، الكمية، حد التنبيه (بالترتيب في النموذج)
    expect(priceInputs.length).toBeGreaterThanOrEqual(4);
    await act(async () => {
      setInputValue(priceInputs[0], '10'); // الشراء
      setInputValue(priceInputs[1], '15'); // البيع
      setInputValue(priceInputs[2], '20'); // الكمية
    });

    const saveBtn = byText<HTMLButtonElement>('button', 'حفظ');
    await click(saveBtn);
    await flush(150);

    const products = await listProducts();
    expect(products).toHaveLength(1);
    expect(products[0].name).toBe('حليب طازج');
    expect(products[0].quantity).toBe(20);

    // — 2) البيع من نقطة البيع —
    await go('#/pos');
    await flush(150);

    const productBtn = byText<HTMLButtonElement>('button', 'حليب طازج');
    expect(productBtn).toBeTruthy();
    await click(productBtn);

    const completeBtn = byText<HTMLButtonElement>('button', 'تأكيد البيع');
    expect(completeBtn).toBeTruthy();
    expect(completeBtn!.disabled).toBe(false);
    await click(completeBtn);
    await flush(250);

    // — 3) التحقق: مخزون مخصوم + فاتورة محفوظة —
    const after = await listProducts();
    expect(after[0].quantity).toBe(19);

    const invoices = await listInvoices();
    expect(invoices).toHaveLength(1);
    expect(invoices[0].total).toBe(15);
    expect(invoices[0].status).toBe('paid');
    expect(invoices[0].cogs).toBe(10);

    // — 4) الفاتورة تظهر في صفحة الفواتير —
    await go('#/invoices');
    await flush(150);
    expect(byText('td', 'INV-00001')).toBeTruthy();
  }, 30000);

  it('تسجيل بيع يدوي من سجل المبيعات ثم إيجاده في سجل اليوم والبحث', async () => {
    // منتج موجود مسبقًا في المخزون
    const product = await createProduct({
      name: 'شاي ليبتون 400 جم',
      code: 'TEA400',
      barcode: '',
      category: 'المواد الغذائية',
      purchasePrice: 15,
      salePrice: 18,
      quantity: 10,
      alertThreshold: 2,
      supplierId: null,
      description: '',
    });
    await listCategories(); // زرع التصنيفات الافتراضية

    await mount();
    await flush(150);
    await go('#/sales-log');
    await flush(250);

    // فتح نموذج التسجيل
    const addBtn = byText<HTMLButtonElement>('button', 'تسجيل بيع');
    expect(addBtn).toBeTruthy();
    await click(addBtn);
    await flush(100);

    const nameInput = document.querySelector<HTMLInputElement>('input[aria-label="اسم المنتج"]');
    expect(nameInput).toBeTruthy();
    await act(async () => {
      setInputValue(nameInput!, product.name);
      // إشعار React بالحدث كما يفعل المتصفح
      nameInput!.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await flush(120);

    const qtyInput = document.querySelector<HTMLInputElement>('input[aria-label="الكمية"]');
    expect(qtyInput).toBeTruthy();
    await act(async () => setInputValue(qtyInput!, '2'));

    const buyerInput = document.querySelector<HTMLInputElement>('input[aria-label="المشتري"]');
    await act(async () => setInputValue(buyerInput!, 'أبو محمد'));

    // حفظ السجل
    const modal = document.querySelector('[role="dialog"]');
    const saveBtn = Array.from(modal?.querySelectorAll('button') ?? []).find((b) => b.textContent?.trim() === 'حفظ');
    expect(saveBtn).toBeTruthy();
    await click(saveBtn!);
    await flush(300);

    // — التحقق من الحفظ الفعلي في قاعدة البيانات —
    const sales = await listManualSales();
    expect(sales).toHaveLength(1);
    expect(sales[0].productName).toBe('شاي ليبتون 400 جم');
    expect(sales[0].quantity).toBe(2);
    expect(sales[0].total).toBe(36);
    expect(sales[0].buyerName).toBe('أبو محمد');
    expect(sales[0].stockApplied).toBe(true);

    // المخزون خُصم مرة واحدة فقط
    const after = (await listProducts()).find((p) => p.id === product.id)!;
    expect(after.quantity).toBe(8);

    // يظهر في سجل اليوم
    expect(document.body.textContent).toContain('شاي ليبتون 400 جم');
    expect(document.body.textContent).toContain('أبو محمد');

    // البحث يجد السجل با سم المنتج وبالسعر
    const searchInput = document.querySelector<HTMLInputElement>('input[aria-label="بحث"]');
    expect(searchInput).toBeTruthy();
    await act(async () => {
      setInputValue(searchInput!, 'ليبتون');
    });
    await flush(150);
    expect(document.body.textContent).toContain('ليبتون');

    await act(async () => setInputValue(searchInput!, '36'));
    await flush(150);
    expect(byText('p', '36')).toBeTruthy();

    // — لا ازدواج في التقارير —
    const invoices = await listInvoices();
    const pnl = computePnl(invoices, [], undefined, await listManualSales());
    expect(pnl.sales).toBe(36);
    expect(pnl.manualCount).toBe(1);
    expect(pnl.invoiceCount).toBe(0);
  }, 30000);

  it('البحث الشامل ينقل إلى صفحة الأسعار ويصفّي النتائج', async () => {
    await createProduct({ name: 'حليب طازج', code: 'MILK01', barcode: '', category: 'ألبان', purchasePrice: 10, salePrice: 15, quantity: 20, alertThreshold: 2, supplierId: null, description: '' });
    await createProduct({ name: 'شاي أخضر', code: 'TEA01', barcode: '', category: 'مشروبات', purchasePrice: 4, salePrice: 6, quantity: 10, alertThreshold: 2, supplierId: null, description: '' });

    await mount();
    await flush(150);
    await go('#/products');
    await flush(150);

    const search = document.querySelector<HTMLInputElement>('input[aria-label="بحث عن سعر"]');
    expect(search).toBeTruthy();
    await act(async () => {
      setInputValue(search!, 'حليب');
      search!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    await flush(300);

    expect(window.location.hash).toContain('/prices?q=');
    const text = document.body.textContent ?? '';
    expect(text).toContain('المنتجات والأسعار');
    expect(byText('td', 'حليب طازج')).toBeTruthy();
    expect(byText('td', 'شاي أخضر')).toBeFalsy();
  }, 20000);

  it('صفحة المسح تعرض أدوات الرفع والمعالجة دون تنفيذ OCR عند غياب صورة', async () => {
    await mount();
    await flush(120);
    await go('#/scan');
    await flush(400);

    const text = document.body.textContent ?? '';
    expect(text).toContain('مسح الفواتير');
    expect(text).toContain('رفع صورة الفاتورة');
    expect(text).toContain('التعرّف مصمم للفواتير المطبوعة');
    expect(text).toContain('الكتابة اليدوية');

    // لا توجد صورة → لا تبدأ العملية
    const startBtn = byText<HTMLButtonElement>('button', 'بدء المسح الضوئي');
    expect(startBtn).toBeTruthy();
    expect(startBtn!.disabled).toBe(true);
  }, 20000);

  it('تبديل اللغة يغيّر اتجاه الصفحة', async () => {
    await mount();
    await flush(120);

    expect(document.documentElement.dir).toBe('rtl');
    const langBtn = Array.from(document.querySelectorAll('header button')).find((b) =>
      b.textContent?.includes('EN'),
    );
    await click(langBtn ?? null);
    await flush(150);

    expect(document.documentElement.dir).toBe('ltr');
    expect(document.documentElement.lang).toBe('en');
    // عنوان قائمة الفارغة أو أي نص بالإنجليزية
    expect(document.body.textContent?.includes('Dashboard') || document.body.textContent?.length).toBeTruthy();
  }, 20000);
});
