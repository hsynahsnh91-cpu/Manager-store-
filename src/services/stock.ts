/**
 * إتلاف/تلف البضاعة وتخفيض أسعارها.
 *
 * - الإتلاف يخصم الكمية من المخزون ويسجّل قيمة الخسارة بالتكلفة.
 * - لا يُنشئ حركة صندوق: الخسارة غير نقدية، وتظهر منفصلة في التقارير
 *   (لا نخلطها بالمبيعات ولا بالمصروفات النقدية).
 * - التخفيض يعدّل سعر البيع عبر خدمة الأسعار مع سبب واضح في سجل الأسعار.
 */
import type { Product, StockWriteOff } from '../types';
import { getDB } from './db';
import { uid } from '../utils/id';
import { mulCost, round2, round4 } from '../utils/money';
import { normalizeUnit } from '../utils/units';
import { logAudit } from './audit';

export class StockError extends Error {
  constructor(
    public code: 'PRODUCT_NOT_FOUND' | 'INVALID_QUANTITY' | 'INSUFFICIENT_STOCK',
    public detail?: string,
  ) {
    super(code);
    this.name = 'StockError';
  }
}

export interface WriteOffInput {
  productId: string;
  quantity: number;
  kind: StockWriteOff['kind'];
  reason: string;
  date?: number;
}

/** تسجيل إتلاف بضاعة (تالف/منتهي الصلاحية/فقد) */
export async function writeOffStock(input: WriteOffInput): Promise<StockWriteOff> {
  const quantity = round4(input.quantity);
  if (!Number.isFinite(quantity) || quantity <= 0) throw new StockError('INVALID_QUANTITY');
  const db = await getDB();
  const tx = db.transaction(['products', 'stockWriteOffs'], 'readwrite');
  try {
    const product = (await tx.objectStore('products').get(input.productId)) as Product | undefined;
    if (!product) throw new StockError('PRODUCT_NOT_FOUND');
    if (product.quantity < quantity) {
      throw new StockError('INSUFFICIENT_STOCK', product.name);
    }
    const now = Date.now();
    const unitCost = round4(product.purchasePrice);
    const record: StockWriteOff = {
      id: uid('woff'),
      date: input.date ?? now,
      productId: product.id,
      productName: product.name,
      quantity,
      unit: normalizeUnit(product.saleUnit ?? product.unit),
      unitCost,
      value: mulCost(quantity, unitCost),
      kind: input.kind,
      reason: input.reason.trim(),
      createdAt: now,
    };
    await tx.objectStore('stockWriteOffs').put(record);
    await tx.objectStore('products').put({
      ...product,
      quantity: round4(product.quantity - quantity),
      updatedAt: now,
    });
    await tx.done;

    await logAudit({
      action: 'write_off',
      entity: 'product',
      entityId: product.id,
      summary: `إتلاف ${quantity} ${record.unit} من ${product.name} (${record.kind})`,
      before: `الكمية: ${product.quantity}`,
      after: `الكمية: ${round4(product.quantity - quantity)} · القيمة: ${record.value}`,
    });
    return record;
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

export async function listWriteOffs(): Promise<StockWriteOff[]> {
  const db = await getDB();
  const rows = await db.getAll('stockWriteOffs');
  return rows.sort((a, b) => b.date - a.date);
}

export function sumWriteOffs(rows: StockWriteOff[], from?: number, to?: number): number {
  return round2(
    rows
      .filter((r) => (from === undefined || r.date >= from) && (to === undefined || r.date <= to))
      .reduce((acc, r) => acc + r.value, 0),
  );
}
