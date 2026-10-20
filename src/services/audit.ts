/** سجل المراجعة — كل تعديل/حذف مهم يُسجَّل هنا بشكل دائم */
import type { AuditEntry } from '../types';
import { getAll, getDB } from './db';
import { uid } from '../utils/id';

type NewAudit = Omit<AuditEntry, 'id' | 'at'> & { at?: number };

/** يضيف قيدًا لسجل المراجعة (لا يفشل العملية الأصلية إذا تعذّر التسجيل) */
export async function logAudit(entry: NewAudit): Promise<void> {
  const rec: AuditEntry = { ...entry, id: uid('aud'), at: entry.at ?? Date.now() };
  try {
    const db = await getDB();
    await db.put('audit', rec);
  } catch {
    // التسجيل التشخيصي لا يجب أن يُفشل الحفظ الأساسي
  }
}

/** قراءة آخر القيود (الأحدث أولًا) */
export async function listAudit(limit = 100): Promise<AuditEntry[]> {
  const rows = await getAll<AuditEntry>('audit');
  return rows.sort((a, b) => b.at - a.at).slice(0, limit);
}

/** وصف مختصر لسجل بيع لأغراض المراجعة */
export function describeManualSale(sale: {
  productName: string;
  quantity: number;
  unitPrice: number;
  total: number;
  buyerName: string;
  date: number;
}): string {
  return `${sale.productName} × ${sale.quantity} @ ${sale.unitPrice} = ${sale.total}${
    sale.buyerName ? ` — ${sale.buyerName}` : ''
  } (${new Date(sale.date).toISOString()})`;
}
