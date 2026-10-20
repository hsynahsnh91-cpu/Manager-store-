/**
 * اختبار حيّ لمحرك OCR الحقيقي (tesseract.js + ملفات اللغة المشحونة في public/ocr).
 *
 * لا يعمل افتراضيًا لأنه يشغّل محرك WASM فعليًا (≈ 2-4 ثوانٍ):
 *   OCR_LIVE=1 npx vitest run tests/ocr-live.test.ts
 *
 * يُنشئ صور فواتير (عربية وإنجليزية بترتيب أعمدة مختلف)، يشغّل التعرّف،
 * ثم يمرّر النص الناتج إلى محلل الفواتير في التطبيق ويتحقق من النتائج.
 */
import { describe, expect, it } from 'vitest';
import { createCanvas, GlobalFonts } from '@napi-rs/canvas';
import { createWorker } from 'tesseract.js';
import { join } from 'node:path';
import { parseInvoiceText } from '../src/services/ocr/parseInvoice';

const ARABIC_FONT = join(
  process.cwd(),
  'node_modules/@expo-google-fonts/noto-naskh-arabic/400Regular/NotoNaskhArabic_400Regular.ttf',
);
const ARABIC_BOLD = join(
  process.cwd(),
  'node_modules/@expo-google-fonts/noto-naskh-arabic/700Bold/NotoNaskhArabic_700Bold.ttf',
);

function arabicInvoicePng(): Buffer {
  GlobalFonts.registerFromPath(ARABIC_FONT, 'NotoArabic');
  GlobalFonts.registerFromPath(ARABIC_BOLD, 'NotoArabicBold');
  const canvas = createCanvas(1240, 900);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, 1240, 900);
  ctx.fillStyle = '#111';
  ctx.direction = 'rtl';
  ctx.textAlign = 'right';
  ctx.font = 'bold 44px NotoArabicBold';
  ctx.fillText('شركة النور للتجارة', 1180, 90);
  ctx.font = '26px NotoArabic';
  ctx.fillText('فاتورة شراء', 1180, 140);
  ctx.fillText('رقم الفاتورة: 4582', 1180, 185);
  ctx.fillText('التاريخ: 2026-10-18', 1180, 230);
  ctx.fillText('المورد: مؤسسة الأمانة', 1180, 275);

  const rows = [
    ['الصنف', 'الكمية', 'سعر الوحدة', 'الإجمالي'],
    ['حليب المراعي 1 لتر', '12', '6.50', '78.00'],
    ['شاي ليبتون 400 جم', '6', '18.00', '108.00'],
    ['صابون ديتول 165 جم', '24', '4.25', '102.00'],
    ['زيت عافية 1.8 لتر', '8', '32.75', '262.00'],
  ];
  let y = 350;
  ctx.font = 'bold 24px NotoArabicBold';
  ctx.fillText(rows[0][0], 1180, y);
  ctx.fillText(rows[0][1], 820, y);
  ctx.fillText(rows[0][2], 620, y);
  ctx.fillText(rows[0][3], 380, y);
  ctx.strokeStyle = '#333';
  ctx.beginPath();
  ctx.moveTo(50, y + 14);
  ctx.lineTo(1190, y + 14);
  ctx.stroke();
  ctx.font = '28px NotoArabic';
  for (const row of rows.slice(1)) {
    y += 70;
    ctx.fillText(row[0], 1180, y);
    ctx.fillText(row[1], 820, y);
    ctx.fillText(row[2], 620, y);
    ctx.fillText(row[3], 380, y);
  }
  y += 80;
  ctx.font = 'bold 26px NotoArabicBold';
  ctx.fillText('خصم: 20.00', 1180, y + 10);
  ctx.fillText('الضريبة: 52.90', 1180, y + 55);
  ctx.font = 'bold 34px NotoArabicBold';
  ctx.fillText('الإجمالي: 582.90', 1180, y + 115);
  return canvas.toBuffer('image/png');
}

function englishInvoicePng(): Buffer {
  const canvas = createCanvas(1240, 620);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, 1240, 620);
  ctx.fillStyle = '#111';
  ctx.textAlign = 'left';
  ctx.font = 'bold 34px sans-serif';
  ctx.fillText('ACME SUPPLIES', 60, 70);
  ctx.font = '22px sans-serif';
  ctx.fillText('Invoice No: INV-9021', 60, 115);
  ctx.fillText('Date: 2026-03-05', 60, 150);
  ctx.fillText('Supplier: ACME Ltd', 60, 185);
  // ترتيب أعمدة مختلف: الإجمالي أولًا
  const rows = [
    ['Amount', 'Unit Price', 'Qty', 'Description'],
    ['85.00', '8.50', '10', 'Olive Oil 1L'],
    ['19.50', '3.25', '6', 'Dish Soap'],
    ['126.00', '4.50', '28', 'Paper Towels'],
  ];
  let y = 260;
  ctx.font = 'bold 22px sans-serif';
  rows[0].forEach((cell, i) => ctx.fillText(cell, 60 + i * 280, y));
  ctx.strokeStyle = '#333';
  ctx.beginPath();
  ctx.moveTo(50, y + 12);
  ctx.lineTo(1190, y + 12);
  ctx.stroke();
  ctx.font = '24px sans-serif';
  for (const row of rows.slice(1)) {
    y += 60;
    row.forEach((cell, i) => ctx.fillText(cell, 60 + i * 280, y));
  }
  y += 70;
  ctx.font = 'bold 24px sans-serif';
  ctx.fillText('Discount: 4.50', 60, y);
  ctx.fillText('Total: 226.00', 60, y + 45);
  return canvas.toBuffer('image/png');
}

const runLive = process.env.OCR_LIVE === '1';

describe.runIf(runLive)('OCR حيّ — tesseract.js على صور فواتير حقيقية', () => {
  it(
    'يقرأ فاتورة عربية مطبوعة ويستخرج البنود والأسعار والإجمالي',
    async () => {
      const worker = await createWorker(['ara', 'eng'], 1, {
        langPath: join(process.cwd(), 'public/ocr/lang'),
        cacheMethod: 'none',
      });
      try {
        const { data } = await worker.recognize(arabicInvoicePng());
        expect(data.confidence).toBeGreaterThan(70);
        const parsed = parseInvoiceText(data.text, { engineConfidence: data.confidence });

        expect(parsed.supplierName).toContain('الأمانة');
        expect(parsed.invoiceNumber).toBe('4582');
        expect(new Date(parsed.invoiceDate ?? 0).getDate()).toBe(18);
        expect(parsed.total).toBe(582.9);
        expect(parsed.discount).toBe(20);
        expect(parsed.tax).toBe(52.9);
        expect(parsed.items.length).toBeGreaterThanOrEqual(4);

        const milk = parsed.items.find((i) => i.name.includes('حليب'));
        expect(milk?.quantity).toBe(12);
        expect(milk?.unitPrice).toBe(6.5);
        expect(milk?.lineTotal).toBe(78);

        const soap = parsed.items.find((i) => i.name.includes('ديتول'));
        expect(soap?.quantity).toBe(24);
        expect(soap?.unitPrice).toBe(4.25);
        expect(soap?.lineTotal).toBe(102);
      } finally {
        await worker.terminate();
      }
    },
    120_000,
  );

  it(
    'يقرأ فاتورة إنجليزية بترتيب أعمدة معكوس (الإجمالي أولًا)',
    async () => {
      const worker = await createWorker(['ara', 'eng'], 1, {
        langPath: join(process.cwd(), 'public/ocr/lang'),
        cacheMethod: 'none',
      });
      try {
        const { data } = await worker.recognize(englishInvoicePng());
        const parsed = parseInvoiceText(data.text, { engineConfidence: data.confidence });
        expect(parsed.invoiceNumber).toBe('INV-9021');
        expect(parsed.total).toBe(226);
        expect(parsed.discount).toBe(4.5);
        expect(parsed.items.length).toBe(3);
        const olive = parsed.items.find((i) => /olive/i.test(i.name));
        expect(olive?.quantity).toBe(10);
        expect(olive?.unitPrice).toBe(8.5);
        expect(olive?.lineTotal).toBe(85);
      } finally {
        await worker.terminate();
      }
    },
    120_000,
  );
});
