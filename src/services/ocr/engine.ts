/**
 * محرّك OCR — tesseract.js (WASM) يعمل داخل المتصفح عبر Web Worker.
 * كل الأصول (worker + wasm + ملفات اللغة ara/eng) تُقدَّم محليًا من /ocr،
 * فلا يحدث أي اتصال شبكة خارجي أثناء المسح، وتعمل الصفحة دون إنترنت بعد التحميل.
 *
 * القيود المعروفة (بصراحة):
 * - المحرك مخصص للفواتير المطبوعة. الكتابة اليدوية غير مدعومة إلا بجودة منخفضة جدًا،
 *   لذلك توجد دائمًا مراجعة يدوية قبل الحفظ.
 */
import type { ParsedInvoice, ParseOptions } from './parseInvoice';
import { parseInvoiceText } from './parseInvoice';

export interface OcrProgress {
  status: string;
  progress: number; // 0..1
}

export interface OcrLine {
  text: string;
  confidence: number;
}

export interface OcrResult {
  text: string;
  confidence: number; // 0..100
  lines: OcrLine[];
  engine: string;
}

export const OCR_ENGINE_LABEL = 'tesseract.js (LSTM) — ara+eng';
export const OCR_LANGUAGES = ['ara', 'eng'];

export class OcrError extends Error {
  constructor(
    public code: 'UNSUPPORTED' | 'ASSETS_MISSING' | 'ENGINE_FAILED' | 'EMPTY_RESULT',
    message?: string,
  ) {
    super(message ?? code);
    this.name = 'OcrError';
  }
}

function basePath(): string {
  const base = import.meta.env.BASE_URL || '/';
  return base.endsWith('/') ? base : `${base}/`;
}

function ocrAsset(path: string): string {
  return new URL(`${basePath()}ocr/${path}`, window.location.origin + basePath()).href;
}

let workerPromise: Promise<import('tesseract.js').Worker> | null = null;
let workerLang = '';
let assetsChecked = false;

async function assertAssets(): Promise<void> {
  if (assetsChecked) return;
  const res = await fetch(ocrAsset('manifest.json'), { cache: 'no-store' });
  if (!res.ok) {
    throw new OcrError(
      'ASSETS_MISSING',
      'ملفات محرك OCR غير موجودة على الخادم. شغّل npm run prepare:ocr ثم أعد البناء.',
    );
  }
  assetsChecked = true;
}

async function getWorker(onProgress?: (p: OcrProgress) => void) {
  if (typeof Worker === 'undefined') {
    throw new OcrError('UNSUPPORTED', 'المتصفح لا يدعم Web Workers المطلوبة لمحرك OCR.');
  }
  if (workerPromise && workerLang === OCR_LANGUAGES.join('+')) return workerPromise;

  await assertAssets();
  const langs = OCR_LANGUAGES.join('+');
  workerPromise = (async () => {
    const { createWorker } = await import('tesseract.js');
    const worker = await createWorker(langs, 1, {
      workerPath: ocrAsset('worker/worker.min.js'),
      corePath: `${ocrAsset('core')}/`,
      langPath: ocrAsset('lang'),
      cacheMethod: 'none',
      logger: (m: { status?: string; progress?: number }) => {
        onProgress?.({ status: m.status ?? '', progress: m.progress ?? 0 });
      },
      errorHandler: (e: unknown) => {
        console.error('[ocr] worker error', e);
      },
    });
    return worker;
  })();
  workerLang = langs;
  try {
    return await workerPromise;
  } catch (err) {
    workerPromise = null;
    workerLang = '';
    throw new OcrError('ENGINE_FAILED', err instanceof Error ? err.message : String(err));
  }
}

/** يحرّر العامل ويحرر الذاكرة — يُستدعى عند مغادرة صفحة المسح */
export async function terminateOcr(): Promise<void> {
  const current = workerPromise;
  workerPromise = null;
  workerLang = '';
  if (!current) return;
  try {
    const worker = await current;
    await worker.terminate();
  } catch {
    /* لا شيء لتحريره */
  }
}

export type OcrInput = Blob | HTMLCanvasElement | HTMLImageElement | ImageData;

/** ينفّذ التعرّف على النص ويعيد النص والثقة والسطور */
export async function recognize(
  input: OcrInput,
  onProgress?: (p: OcrProgress) => void,
): Promise<OcrResult> {
  const worker = await getWorker(onProgress);
  try {
    // نص + كتل (للحصول على ثقة كل سطر) — بدون preserve_interword_spaces كي لا تُدمج الأرقام
    const result = await worker.recognize(input as never, {}, { text: true, blocks: true });
    const data = result.data as unknown as {
      text?: string;
      confidence?: number;
      blocks?: {
        paragraphs?: { lines?: { text?: string; confidence?: number }[] }[];
      }[];
    };
    const lines: OcrLine[] = [];
    for (const block of data.blocks ?? []) {
      for (const paragraph of block.paragraphs ?? []) {
        for (const line of paragraph.lines ?? []) {
          const text = (line.text ?? '').trim();
          if (text) lines.push({ text, confidence: line.confidence ?? 0 });
        }
      }
    }
    const text = (data.text ?? '').trim();
    if (!text) throw new OcrError('EMPTY_RESULT', 'لم يُعثر على نص في الصورة. جرّب صورة أوضح.');
    return {
      text,
      confidence: Math.round(data.confidence ?? 0),
      lines,
      engine: OCR_ENGINE_LABEL,
    };
  } catch (err) {
    if (err instanceof OcrError) throw err;
    throw new OcrError('ENGINE_FAILED', err instanceof Error ? err.message : String(err));
  }
}

/** تشغيل التعرّف ثم التحليل إلى بيانات منظمة */
export async function scanInvoiceImage(
  input: OcrInput,
  onProgress?: (p: OcrProgress) => void,
): Promise<{ ocr: OcrResult; parsed: ParsedInvoice }> {
  const ocr = await recognize(input, onProgress);
  const lineConfidenceMap = new Map<string, number>();
  for (const line of ocr.lines) {
    const key = line.text.replace(/\s+/g, ' ').trim();
    lineConfidenceMap.set(key, line.confidence);
  }
  const parseOptions: ParseOptions = {
    engineConfidence: ocr.confidence,
    lineConfidence: (line) => {
      const key = line.replace(/\s+/g, ' ').trim();
      return lineConfidenceMap.get(key);
    },
  };
  const parsed = parseInvoiceText(ocr.text, parseOptions);
  return { ocr, parsed };
}
