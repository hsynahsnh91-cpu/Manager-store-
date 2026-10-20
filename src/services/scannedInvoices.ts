/**
 * مكتبة الفواتير الممسوحة ضوئيًا.
 *
 * قواعد السلامة:
 * - لا تُحفظ فاتورة قبل تأكيد المستخدم بعد المراجعة.
 * - الصورة الأصلية تُحفظ فور الرفع (قبل OCR) فلا تُفقد عند فشل التعرّف.
 * - الاعتماد (حفظ الفاتورة + تحديث الأسعار + إنشاء المنتجات) يتم داخل معاملة واحدة:
 *   إما ينجح كل شيء أو لا يتغيّر شيء (لا أسعار جزئية).
 * - تحديث سعر الشراء لا يغيّر سعر البيع إلا بقرار صريح من المستخدم.
 * - لا تُنشئ هذه الفواتير حركات مخزون أو صندوق؛ لتفادي ازدواج المحاسبة مع فواتير المشتريات.
 */
import type {
  InvoiceImage,
  PriceChange,
  Product,
  ScannedInvoice,
  ScannedInvoiceItem,
} from '../types';
import { getDB } from './db';
import { uid } from '../utils/id';
import { addMoney, mulMoney, round2, subMoney } from '../utils/money';
import { normalizeArabic, normalizeDigits } from '../utils/text';

export interface InvoiceImageMeta {
  name: string;
  width: number;
  height: number;
}

/** يحفظ الصورة الأصلية بشكل دائم ويعيد معرّفها */
export async function storeInvoiceImage(blob: Blob, meta: InvoiceImageMeta): Promise<InvoiceImage> {
  const db = await getDB();
  const row: InvoiceImage = {
    id: uid('img'),
    blob,
    mimeType: blob.type || 'image/png',
    width: meta.width,
    height: meta.height,
    name: meta.name,
    size: blob.size,
    createdAt: Date.now(),
  };
  await db.put('invoiceImages', row);
  return row;
}

export async function getInvoiceImage(id: string): Promise<InvoiceImage | undefined> {
  const db = await getDB();
  return db.get('invoiceImages', id);
}

export async function deleteUnusedImages(): Promise<number> {
  const db = await getDB();
  const [images, invoices] = await Promise.all([db.getAll('invoiceImages'), db.getAll('scannedInvoices')]);
  const used = new Set(invoices.map((i) => i.imageId).filter(Boolean) as string[]);
  let removed = 0;
  for (const img of images) {
    // نحتفظ بالصور الأحدث من ساعة (قد تكون مسودة قيد المراجعة)
    if (!used.has(img.id) && Date.now() - img.createdAt > 3_600_000) {
      await db.delete('invoiceImages', img.id);
      removed += 1;
    }
  }
  return removed;
}

/** بصمة كشف التكرار: المورد + الرقم + التاريخ + الإجمالي */
export function invoiceFingerprint(input: {
  supplierName: string;
  invoiceNumber: string;
  invoiceDate: number;
  total: number;
}): string {
  const supplier = normalizeArabic(input.supplierName).replace(/\s+/g, '');
  const number = normalizeDigits(input.invoiceNumber).replace(/\s+/g, '').toLowerCase();
  const day = Number.isFinite(input.invoiceDate) ? new Date(input.invoiceDate).toISOString().slice(0, 10) : '';
  return `${supplier}|${number}|${day}|${round2(input.total).toFixed(2)}`;
}

export interface DuplicateCandidate {
  invoice: ScannedInvoice;
  reason: 'same_number' | 'same_fingerprint' | 'same_total_date';
}

/** يبحث عن فواتير مكررة قبل الحفظ (رقم + مورد، أو بصمة كاملة، أو نفس الإجمالي والتاريخ) */
export async function findDuplicates(input: {
  supplierName: string;
  invoiceNumber: string;
  invoiceDate: number;
  total: number;
  excludeId?: string;
}): Promise<DuplicateCandidate[]> {
  const db = await getDB();
  const all = await db.getAll('scannedInvoices');
  const number = normalizeDigits(input.invoiceNumber).replace(/\s+/g, '').toLowerCase();
  const supplier = normalizeArabic(input.supplierName);
  const fingerprint = invoiceFingerprint(input);
  const day = new Date(input.invoiceDate).toISOString().slice(0, 10);
  const out: DuplicateCandidate[] = [];
  for (const inv of all) {
    if (inv.id === input.excludeId) continue;
    if (inv.fingerprint === fingerprint) {
      out.push({ invoice: inv, reason: 'same_fingerprint' });
      continue;
    }
    const sameSupplier = normalizeArabic(inv.supplierName) === supplier;
    const sameNumber =
      number.length > 0 &&
      normalizeDigits(inv.invoiceNumber).replace(/\s+/g, '').toLowerCase() === number;
    if (sameNumber && (sameSupplier || !supplier)) {
      out.push({ invoice: inv, reason: 'same_number' });
      continue;
    }
    if (
      number.length === 0 &&
      sameSupplier &&
      Math.abs(inv.total - round2(input.total)) < 0.01 &&
      new Date(inv.invoiceDate).toISOString().slice(0, 10) === day
    ) {
      out.push({ invoice: inv, reason: 'same_total_date' });
    }
  }
  return out;
}

export interface PriceDecision {
  itemId: string;
  newSalePrice?: number | null; // يُطبَّق فقط إذا وافق المستخدم
}

export interface NewProductDecision {
  itemId: string;
  name: string;
  category: string;
  salePrice: number;
  unit?: string;
}

export interface ConfirmScannedInvoiceInput {
  supplierName: string;
  supplierId?: string | null;
  invoiceNumber: string;
  invoiceDate: number;
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  items: ScannedInvoiceItem[];
  rawText: string;
  imageId: string | null;
  imageName: string;
  ocrConfidence: number;
  engine: string;
  notes?: string;
  edits?: { field: string; from: string; to: string; at: number }[];
  applyPurchasePrices: boolean;
  priceDecisions?: PriceDecision[];
  newProducts?: NewProductDecision[];
  allowDuplicate?: boolean;
}

export class ScannedInvoiceError extends Error {
  constructor(
    public code: 'NO_ITEMS' | 'DUPLICATE' | 'INVALID_TOTAL' | 'SAVE_FAILED',
    public detail?: string,
    public duplicates?: DuplicateCandidate[],
  ) {
    super(code);
    this.name = 'ScannedInvoiceError';
  }
}

/**
 * يحفظ الفاتورة بعد المراجعة ويطبّق قرارات الأسعار.
 * كل الخطوات في معاملة ذرية واحدة على (scannedInvoices, products, priceHistory, categories).
 */
export async function confirmScannedInvoice(input: ConfirmScannedInvoiceInput): Promise<ScannedInvoice> {
  const activeItems = input.items.filter((i) => i.matchState !== 'ignored');
  if (activeItems.length === 0) throw new ScannedInvoiceError('NO_ITEMS');
  if (!Number.isFinite(input.total) || input.total < 0) throw new ScannedInvoiceError('INVALID_TOTAL');

  const duplicates = await findDuplicates({
    supplierName: input.supplierName,
    invoiceNumber: input.invoiceNumber,
    invoiceDate: input.invoiceDate,
    total: input.total,
  });
  if (duplicates.length > 0 && !input.allowDuplicate) {
    throw new ScannedInvoiceError('DUPLICATE', duplicates[0].invoice.id, duplicates);
  }

  const db = await getDB();
  const tx = db.transaction(
    ['scannedInvoices', 'products', 'priceHistory', 'categories', 'audit'],
    'readwrite',
  );
  try {
    const productStore = tx.objectStore('products');
    const historyStore = tx.objectStore('priceHistory');
    const now = Date.now();
    const supplierLabel = input.supplierName || 'مورّد غير معروف';
    const invoiceLabel = `فاتورة ${input.invoiceNumber || '(بلا رقم)'} — ${supplierLabel}`;
    const priceUpdates: ScannedInvoice['priceUpdates'] = [];
    const items: ScannedInvoiceItem[] = input.items.map((i) => ({ ...i }));
    const newProductsByItem = new Map((input.newProducts ?? []).map((p) => [p.itemId, p]));

    for (const item of items) {
      if (item.matchState === 'ignored') continue;

      // 1) إنشاء منتج جديد عند الحاجة
      const newDecision = newProductsByItem.get(item.id);
      if ((item.matchState === 'new' || !item.productId) && newDecision) {
        const product: Product = {
          id: uid('prd'),
          name: newDecision.name.trim() || item.name,
          code: '',
          barcode: '',
          category: newDecision.category.trim(),
          purchasePrice: round2(item.unitPrice),
          salePrice: round2(newDecision.salePrice > 0 ? newDecision.salePrice : item.unitPrice),
          quantity: 0,
          alertThreshold: 5,
          supplierId: input.supplierId ?? null,
          description: '',
          archived: false,
          createdAt: now,
          updatedAt: now,
          unit: newDecision.unit || item.unit || '',
          purchasePriceUpdatedAt: now,
          salePriceUpdatedAt: now,
          lastSupplierId: input.supplierId ?? null,
        };
        await productStore.put(product);
        item.productId = product.id;
        item.matchState = 'new';
        priceUpdates.push({
          productId: product.id,
          productName: product.name,
          oldPrice: 0,
          newPrice: product.purchasePrice,
          action: 'updated',
        });
        // سجل سعر افتتاحي
        await historyStore.put({
          id: uid('prc'),
          productId: product.id,
          productName: product.name,
          field: 'purchase',
          oldPrice: 0,
          newPrice: product.purchasePrice,
          date: input.invoiceDate,
          createdAt: now,
          source: 'scanned_invoice',
          sourceId: input.imageId,
          sourceLabel: invoiceLabel,
        } satisfies PriceChange);
      }

      // 2) تحديث سعر الشراء لمنتج موجود (فقط عند اختيار المستخدم)
      if (item.matchState === 'matched' && item.productId) {
        const product = await productStore.get(item.productId);
        if (!product) {
          item.matchState = 'unlinked';
          item.productId = null;
          continue;
        }
        if (!input.applyPurchasePrices) {
          priceUpdates.push({
            productId: product.id,
            productName: product.name,
            oldPrice: product.purchasePrice,
            newPrice: product.purchasePrice,
            action: 'skipped',
          });
        } else {
          const newPrice = round2(item.unitPrice);
          if (newPrice > 0 && newPrice !== product.purchasePrice) {
            const updated: Product = {
              ...product,
              purchasePrice: newPrice,
              purchasePriceUpdatedAt: now,
              lastSupplierId: input.supplierId ?? product.lastSupplierId ?? null,
              updatedAt: now,
            };
            await productStore.put(updated);
            await historyStore.put({
              id: uid('prc'),
              productId: product.id,
              productName: product.name,
              field: 'purchase',
              oldPrice: product.purchasePrice,
              newPrice,
              date: input.invoiceDate,
              createdAt: now,
              source: 'scanned_invoice',
              sourceId: input.imageId,
              sourceLabel: invoiceLabel,
            } satisfies PriceChange);
            priceUpdates.push({
              productId: product.id,
              productName: product.name,
              oldPrice: product.purchasePrice,
              newPrice,
              action: 'updated',
            });
          } else {
            priceUpdates.push({
              productId: product.id,
              productName: product.name,
              oldPrice: product.purchasePrice,
              newPrice: product.purchasePrice,
              action: 'unchanged',
            });
          }
        }
      }

      // 3) سعر بيع مقترح يوافق عليه المستخدم صراحةً
      const decision = input.priceDecisions?.find((d) => d.itemId === item.id);
      if (decision?.newSalePrice && item.productId) {
        const product = await productStore.get(item.productId);
        if (product) {
          const sale = round2(decision.newSalePrice);
          if (sale > 0 && sale !== product.salePrice) {
            await productStore.put({ ...product, salePrice: sale, salePriceUpdatedAt: now, updatedAt: now });
            await historyStore.put({
              id: uid('prc'),
              productId: product.id,
              productName: product.name,
              field: 'sale',
              oldPrice: product.salePrice,
              newPrice: sale,
              date: now,
              createdAt: now,
              source: 'scanned_invoice',
              sourceId: input.imageId,
              sourceLabel: `${invoiceLabel} (سعر بيع معتمد`,
            } satisfies PriceChange);
          }
        }
      }
    }

    const computedSubtotal = round2(items.reduce((acc, i) => acc + mulMoney(i.quantity, i.unitPrice), 0));
    const subtotal = input.subtotal > 0 ? round2(input.subtotal) : computedSubtotal;
    const discount = round2(input.discount);
    const tax = round2(input.tax);
    const total = round2(input.total);
    const expected = addMoney(subMoney(subtotal, discount), tax);

    const invoice: ScannedInvoice = {
      id: uid('sinv'),
      supplierId: input.supplierId ?? null,
      supplierName: input.supplierName.trim(),
      invoiceNumber: input.invoiceNumber.trim(),
      invoiceDate: input.invoiceDate,
      scanDate: Date.now(),
      subtotal,
      discount,
      tax,
      total,
      items,
      rawText: input.rawText,
      imageId: input.imageId,
      imageName: input.imageName,
      ocrConfidence: input.ocrConfidence,
      engine: input.engine,
      status: 'confirmed',
      notes: input.notes ?? '',
      edits: input.edits ?? [],
      priceUpdates,
      pricesApplied: input.applyPurchasePrices,
      duplicateOf: duplicates[0]?.invoice.id ?? null,
      fingerprint: invoiceFingerprint({
        supplierName: input.supplierName,
        invoiceNumber: input.invoiceNumber,
        invoiceDate: input.invoiceDate,
        total,
      }),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    if (Math.abs(expected - total) > 0.02) {
      invoice.notes = `${invoice.notes}\n[تنبيه] الإجمالي المحفوظ ${total} يختلف عن المحسوب ${expected}`.trim();
    }

    await tx.objectStore('scannedInvoices').put(invoice);
    await tx.objectStore('audit').put({
      id: uid('aud'),
      at: Date.now(),
      action: 'scan_confirm',
      entity: 'scannedInvoice',
      entityId: invoice.id,
      summary: `اعتماد فاتورة ممسوحة ${invoice.invoiceNumber || ''} — ${invoice.supplierName || 'بدون مورد'} (${items.length} صنف)`,
      before: '',
      after: JSON.stringify({
        total,
        updatedPrices: priceUpdates.filter((p) => p.action === 'updated').length,
        newProducts: (input.newProducts ?? []).length,
      }),
    });
    await tx.done;

    return invoice;
  } catch (err) {
    try {
      tx.abort();
    } catch {
      /* noop */
    }
    void tx.done.catch(() => {
      /* مُعالَج */
    });
    if (err instanceof ScannedInvoiceError) throw err;
    throw new ScannedInvoiceError('SAVE_FAILED', err instanceof Error ? err.message : String(err));
  }
}

export async function listScannedInvoices(): Promise<ScannedInvoice[]> {
  const db = await getDB();
  const rows = await db.getAll('scannedInvoices');
  return rows.sort((a, b) => b.scanDate - a.scanDate);
}

export async function getScannedInvoice(id: string): Promise<ScannedInvoice | undefined> {
  const db = await getDB();
  return db.get('scannedInvoices', id);
}

export interface InvoiceLibraryFilters {
  q?: string;
  supplier?: string;
  from?: number | null;
  to?: number | null;
  minTotal?: number | null;
  maxTotal?: number | null;
}

/** بحث في المكتبة: مورد، رقم فاتورة، منتج، سعر — يشمل كل الفواتير المحفوظة */
export function filterInvoiceLibrary(invoices: ScannedInvoice[], filters: InvoiceLibraryFilters): ScannedInvoice[] {
  const q = normalizeArabic(filters.q ?? '');
  const supplier = normalizeArabic(filters.supplier ?? '');
  const numeric = (filters.q ?? '').trim().replace(/,/g, '');
  const asNumber = numeric && /^-?\d+(\.\d+)?$/.test(numeric) ? Number(numeric) : null;
  return invoices.filter((inv) => {
    if (filters.from && inv.invoiceDate < filters.from) return false;
    if (filters.to && inv.invoiceDate > filters.to + 86_399_999) return false;
    if (filters.minTotal !== null && filters.minTotal !== undefined && inv.total < filters.minTotal) return false;
    if (filters.maxTotal !== null && filters.maxTotal !== undefined && inv.total > filters.maxTotal) return false;
    if (supplier && !normalizeArabic(inv.supplierName).includes(supplier)) return false;
    if (!q) return true;
    if (normalizeArabic(inv.supplierName).includes(q)) return true;
    if (normalizeDigits(inv.invoiceNumber).toLowerCase().includes(normalizeDigits(q).toLowerCase())) return true;
    if (inv.items.some((i) => normalizeArabic(i.name).includes(q))) return true;
    if (asNumber !== null) {
      if (Math.abs(inv.total - asNumber) < 0.01) return true;
      if (inv.items.some((i) => Math.abs(i.unitPrice - asNumber) < 0.01 || Math.abs(i.lineTotal - asNumber) < 0.01)) return true;
    }
    return false;
  });
}

/** الفواتير التي ظهر فيها منتج (بالاسم أو بالمعرّف) */
export function invoicesForProduct(invoices: ScannedInvoice[], productId: string, productName: string): ScannedInvoice[] {
  const name = normalizeArabic(productName);
  return invoices
    .filter(
      (inv) =>
        inv.items.some((i) => i.productId === productId) ||
        (name.length > 2 && inv.items.some((i) => normalizeArabic(i.name).includes(name))),
    )
    .sort((a, b) => b.invoiceDate - a.invoiceDate);
}

export async function deleteScannedInvoice(id: string): Promise<void> {
  const db = await getDB();
  const inv = await db.get('scannedInvoices', id);
  if (!inv) return;
  const tx = db.transaction(['scannedInvoices', 'audit', 'invoiceImages'], 'readwrite');
  await tx.objectStore('scannedInvoices').delete(id);
  if (inv.imageId) {
    // الصورة تُحذف فقط إن لم تكن مرتبطة بفاتورة أخرى
    const others = (await tx.objectStore('scannedInvoices').getAll()).filter((x) => x.imageId === inv.imageId);
    if (others.length === 0) await tx.objectStore('invoiceImages').delete(inv.imageId);
  }
  await tx.objectStore('audit').put({
    id: uid('aud'),
    at: Date.now(),
    action: 'delete',
    entity: 'scannedInvoice',
    entityId: id,
    summary: `حذف فاتورة ممسوحة ${inv.invoiceNumber || ''} — ${inv.supplierName}`,
    before: JSON.stringify({ total: inv.total, items: inv.items.length }),
    after: '',
  });
  await tx.done;
}
