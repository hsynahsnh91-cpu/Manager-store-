/**
 * ينشئ صورة فاتورة تجريبية (عربية + أرقام) لاختبار محرّك OCR فعليًا.
 */
import { createCanvas, GlobalFonts } from '@napi-rs/canvas';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, '.tmp-ocr');
mkdirSync(outDir, { recursive: true });

GlobalFonts.registerFromPath(
  join(root, 'node_modules/@expo-google-fonts/noto-naskh-arabic/400Regular/NotoNaskhArabic_400Regular.ttf'),
  'NotoArabic',
);
GlobalFonts.registerFromPath(
  join(root, 'node_modules/@expo-google-fonts/noto-naskh-arabic/700Bold/NotoNaskhArabic_700Bold.ttf'),
  'NotoArabicBold',
);

const W = 1240;
const H = 900;
const canvas = createCanvas(W, H);
const ctx = canvas.getContext('2d');

ctx.fillStyle = '#ffffff';
ctx.fillRect(0, 0, W, H);
ctx.fillStyle = '#111111';
ctx.direction = 'rtl';
ctx.textAlign = 'right';

ctx.font = 'bold 44px NotoArabicBold';
ctx.fillText('شركة النور للتجارة', W - 60, 90);

ctx.font = '26px NotoArabic';
ctx.fillText('فاتورة شراء', W - 60, 140);
ctx.fillText('رقم الفاتورة: 4582', W - 60, 185);
ctx.fillText('التاريخ: 2026-10-18', W - 60, 230);
ctx.fillText('المورد: مؤسسة الأمانة', W - 60, 275);

// رأس الجدول
const rows = [
  ['الصنف', 'الكمية', 'سعر الوحدة', 'الإجمالي'],
  ['حليب المراعي 1 لتر', '12', '6.50', '78.00'],
  ['شاي ليبتون 400 جم', '6', '18.00', '108.00'],
  ['صابون ديتول 165 جم', '24', '4.25', '102.00'],
  ['زيت عافية 1.8 لتر', '8', '32.75', '262.00'],
];
let y = 350;
ctx.font = 'bold 24px NotoArabicBold';
ctx.fillText(rows[0][0], W - 60, y);
ctx.fillText(rows[0][1], W - 420, y);
ctx.fillText(rows[0][2], W - 620, y);
ctx.fillText(rows[0][3], W - 860, y);
ctx.strokeStyle = '#333';
ctx.beginPath();
ctx.moveTo(50, y + 14);
ctx.lineTo(W - 50, y + 14);
ctx.stroke();

ctx.font = '28px NotoArabic';
for (const row of rows.slice(1)) {
  y += 70;
  ctx.fillText(row[0], W - 60, y);
  ctx.fillText(row[1], W - 420, y);
  ctx.fillText(row[2], W - 620, y);
  ctx.fillText(row[3], W - 860, y);
}

y += 80;
ctx.strokeStyle = '#333';
ctx.beginPath();
ctx.moveTo(50, y - 40);
ctx.lineTo(W - 50, y - 40);
ctx.stroke();
ctx.font = 'bold 26px NotoArabicBold';
ctx.fillText('خصم: 20.00', W - 60, y + 10);
ctx.fillText('الضريبة: 52.90', W - 60, y + 55);
ctx.font = 'bold 34px NotoArabicBold';
ctx.fillText('الإجمالي: 582.90', W - 60, y + 115);

writeFileSync(join(outDir, 'invoice-ar.png'), canvas.toBuffer('image/png'));
console.log('wrote', join(outDir, 'invoice-ar.png'));
