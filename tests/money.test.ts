import { describe, expect, it } from 'vitest';
import {
  addMoney,
  subMoney,
  mulMoney,
  sumMoney,
  round2,
  toCents,
  fromCents,
  percentOf,
} from '../src/utils/money';

describe('money utilities', () => {
  it('يجمع المبالغ دون أخطاء فاصلة عائمة', () => {
    expect(addMoney(0.1, 0.2)).toBe(0.3);
    expect(addMoney(1.005, 1.005)).toBe(2.01);
    expect(addMoney(10.1, 10.2, 10.3)).toBe(30.6);
  });

  it('يطرح المبالغ بأمان', () => {
    expect(subMoney(0.3, 0.1)).toBe(0.2);
    expect(subMoney(1, 0.999)).toBe(0);
  });

  it('يضرب كمية × سعر', () => {
    expect(mulMoney(3, 0.1)).toBe(0.3);
    expect(mulMoney(7, 1.15)).toBe(8.05);
    expect(mulMoney(0, 99.99)).toBe(0);
  });

  it('يجمع قوائم مبالغ', () => {
    expect(sumMoney([0.1, 0.2, 0.3])).toBe(0.6);
    expect(sumMoney([])).toBe(0);
  });

  it('يقرّب إلى منزلتين', () => {
    expect(round2(1.005)).toBe(1.01);
    expect(round2(12)).toBe(12);
    expect(round2(Number.NaN)).toBe(0);
  });

  it('يحول إلى سنتات وبالعكس', () => {
    expect(toCents(12.34)).toBe(1234);
    expect(fromCents(1234)).toBe(12.34);
    expect(toCents(-5.555)).toBe(-556);
  });

  it('يحسب النسب المئوية للخصم', () => {
    expect(percentOf(200, 10)).toBe(20);
    expect(percentOf(99.99, 15)).toBe(15);
  });
});
