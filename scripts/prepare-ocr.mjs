/**
 * ينسخ أصول محرّك OCR (worker + core wasm + ملفات اللغة) إلى public/ocr
 * كي تعمل عملية المسح محليًا بالكامل دون أي طلب شبكة خارجي.
 * يعمل تلقائيًا بعد npm install، ويمكن تشغيله يدويًا: npm run prepare:ocr
 */
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const out = join(root, 'public', 'ocr');

function pkgDir(name) {
  // يحدد مجلد الحزمة بغض النظر عن مكان تثبيتها (npm يرفع الحزم المشتركة)
  try {
    return dirname(require.resolve(`${name}/package.json`));
  } catch {
    return join(root, 'node_modules', name);
  }
}

function must(path, label) {
  if (!existsSync(path)) {
    throw new Error(`[prepare-ocr] missing ${label}: ${path}`);
  }
  return path;
}

mkdirSync(join(out, 'core'), { recursive: true });
mkdirSync(join(out, 'lang'), { recursive: true });
mkdirSync(join(out, 'worker'), { recursive: true });

// 1) عامل التعرّف (worker) — يعمل في Web Worker منفصل
const tessDir = pkgDir('tesseract.js');
cpSync(must(join(tessDir, 'dist', 'worker.min.js'), 'tesseract worker'), join(out, 'worker', 'worker.min.js'));

// 2) نواة WebAssembly (نسخة SIMD وغير SIMD + نسخة LSTM)
const coreDir = pkgDir('tesseract.js-core');
let coreCount = 0;
for (const file of readdirSync(coreDir)) {
  if (/^tesseract-core.*\.(js|wasm)$/.test(file)) {
    cpSync(join(coreDir, file), join(out, 'core', file));
    coreCount += 1;
  }
}
if (coreCount === 0) throw new Error('[prepare-ocr] no core wasm files found');

// 3) ملفات اللغة: العربية + الإنجليزية (نسخة دقيقة مضغوطة)
const langs = [
  { pkg: '@tesseract.js-data/ara', file: '4.0.0_best_int/ara.traineddata.gz', as: 'ara.traineddata.gz' },
  { pkg: '@tesseract.js-data/eng', file: '4.0.0_best_int/eng.traineddata.gz', as: 'eng.traineddata.gz' },
];
for (const lang of langs) {
  const src = must(join(pkgDir(lang.pkg), lang.file), lang.pkg);
  cpSync(src, join(out, 'lang', lang.as));
}

// سجل إصدارات لمزامنة الإعدادات مع المحرّك
writeFileSync(
  join(out, 'manifest.json'),
  JSON.stringify(
    {
      engine: 'tesseract.js',
      version: JSON.parse(readFileSyncSafe(join(tessDir, 'package.json'), '{}')).version ?? '7',
      generatedAt: new Date().toISOString(),
      languages: langs.map((l) => l.as.replace('.traineddata.gz', '')),
    },
    null,
    2,
  ),
);

// تنظيف أي ملفات قديمة غير متوقعة
rmSync(join(out, '.tmp'), { recursive: true, force: true });

console.log(`[prepare-ocr] ready → public/ocr (core files: ${coreCount}, langs: ${langs.length})`);

function readFileSyncSafe(path, fallback) {
  try {
    return require('node:fs').readFileSync(path, 'utf8');
  } catch {
    return fallback;
  }
}
