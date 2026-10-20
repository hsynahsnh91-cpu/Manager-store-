/** مساعد اختبار: يستخدم نفس دالة التحويل الحقيقية بدل تكرار منطقها */
import { conversionFactor } from '../src/utils/units';

export function convertToBaseForTest(
  quantity: number,
  purchaseUnit: string,
  saleUnit: string,
  unitsPerPurchase: number | null,
): number | null {
  const factor = conversionFactor(purchaseUnit, saleUnit, unitsPerPurchase);
  if (factor === null) return null;
  return Math.round(quantity * factor * 10000) / 10000;
}
