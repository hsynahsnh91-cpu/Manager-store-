/**
 * معالجة صورة الفاتورة قبل OCR: تدوير، قص، تحسين التباين، تدرّج رمادي،
 * تصحيح الميل، وتحويل PDF إلى صورة. كل الدوال تعمل في المتصفح عبر Canvas.
 */

export interface CropFraction {
  x: number; // 0..1
  y: number;
  width: number;
  height: number;
}

export interface ProcessOptions {
  rotation?: number; // 0 | 90 | 180 | 270
  crop?: CropFraction | null;
  grayscale?: boolean;
  contrast?: number; // 1 = بدون تغيير
  binarize?: boolean;
  deskew?: boolean;
  maxWidth?: number;
}

export interface ProcessedImage {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
  skewAngle: number;
}

const DEFAULT_MAX_WIDTH = 2000;
const MIN_WIDTH = 900;

async function decode(blob: Blob): Promise<{ source: CanvasImageSource; width: number; height: number; cleanup: () => void }> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(blob);
      return { source: bitmap, width: bitmap.width, height: bitmap.height, cleanup: () => bitmap.close() };
    } catch {
      /* fallback */
    }
  }
  const url = URL.createObjectURL(blob);
  const img = new Image();
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error('IMAGE_DECODE_FAILED'));
    img.src = url;
  });
  return {
    source: img,
    width: img.naturalWidth,
    height: img.naturalHeight,
    cleanup: () => URL.revokeObjectURL(url),
  };
}

function makeCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  return canvas;
}

/** يرسم الصورة مع تدوير وقص وتكبير إلى الحجم المناسب لـ OCR */
function drawSource(
  source: CanvasImageSource,
  srcWidth: number,
  srcHeight: number,
  opts: ProcessOptions,
): HTMLCanvasElement {
  const rotation = ((opts.rotation ?? 0) % 360 + 360) % 360;
  const swap = rotation === 90 || rotation === 270;
  const rotatedW = swap ? srcHeight : srcWidth;
  const rotatedH = swap ? srcWidth : srcHeight;

  const rotated = makeCanvas(rotatedW, rotatedH);
  const rctx = rotated.getContext('2d');
  if (!rctx) throw new Error('CANVAS_UNAVAILABLE');
  rctx.save();
  rctx.translate(rotatedW / 2, rotatedH / 2);
  rctx.rotate((rotation * Math.PI) / 180);
  rctx.drawImage(source, -srcWidth / 2, -srcHeight / 2);
  rctx.restore();

  const crop = opts.crop;
  const cx = crop ? Math.round(crop.x * rotatedW) : 0;
  const cy = crop ? Math.round(crop.y * rotatedH) : 0;
  const cw = crop ? Math.max(1, Math.round(crop.width * rotatedW)) : rotatedW;
  const ch = crop ? Math.max(1, Math.round(crop.height * rotatedH)) : rotatedH;

  const target = opts.maxWidth ?? DEFAULT_MAX_WIDTH;
  let scale = 1;
  if (cw > target) scale = target / cw;
  else if (cw < MIN_WIDTH) scale = Math.min(3, MIN_WIDTH / cw);

  const outW = Math.round(cw * scale);
  const outH = Math.round(ch * scale);
  const canvas = makeCanvas(outW, outH);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('CANVAS_UNAVAILABLE');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(rotated, cx, cy, cw, ch, 0, 0, outW, outH);
  return canvas;
}

/** تدرّج رمادي + تباين */
export function enhanceCanvas(canvas: HTMLCanvasElement, opts: { grayscale?: boolean; contrast?: number }): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const { width, height } = canvas;
  const image = ctx.getImageData(0, 0, width, height);
  const data = image.data;
  const contrast = Math.max(0.2, opts.contrast ?? 1);
  const intercept = 128 * (1 - contrast);
  for (let i = 0; i < data.length; i += 4) {
    let r = data[i];
    let g = data[i + 1];
    let b = data[i + 2];
    if (opts.grayscale) {
      const gray = 0.299 * r + 0.587 * g + 0.114 * b;
      r = g = b = gray;
    }
    data[i] = Math.min(255, Math.max(0, r * contrast + intercept));
    data[i + 1] = Math.min(255, Math.max(0, g * contrast + intercept));
    data[i + 2] = Math.min(255, Math.max(0, b * contrast + intercept));
  }
  ctx.putImageData(image, 0, 0);
}

function otsuThreshold(data: Uint8ClampedArray): number {
  const histogram = new Array<number>(256).fill(0);
  let total = 0;
  for (let i = 0; i < data.length; i += 4) {
    const gray = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
    histogram[gray] += 1;
    total += 1;
  }
  let sum = 0;
  for (let t = 0; t < 256; t++) sum += t * histogram[t];
  let sumB = 0;
  let wB = 0;
  let best = 0;
  let bestVar = -1;
  for (let t = 0; t < 256; t++) {
    wB += histogram[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * histogram[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > bestVar) {
      bestVar = between;
      best = t;
    }
  }
  return best;
}

/** ثنائية (أبيض/أسود) باستخدام عتبة Otsu — تفيد الفواتير الباهتة أو ذات الظلال */
export function binarizeCanvas(canvas: HTMLCanvasElement): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const threshold = otsuThreshold(image.data);
  const data = image.data;
  for (let i = 0; i < data.length; i += 4) {
    const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    const value = gray > threshold ? 255 : 0;
    data[i] = data[i + 1] = data[i + 2] = value;
  }
  ctx.putImageData(image, 0, 0);
}

/** يقدّر ميل الصفحة بالدرجات عبر تحليل إسقاط الصفوف */
export function estimateSkew(canvas: HTMLCanvasElement): number {
  const scale = Math.min(1, 600 / canvas.width);
  const w = Math.max(1, Math.round(canvas.width * scale));
  const h = Math.max(1, Math.round(canvas.height * scale));
  const small = makeCanvas(w, h);
  const ctx = small.getContext('2d');
  if (!ctx) return 0;
  ctx.drawImage(canvas, 0, 0, w, h);
  const image = ctx.getImageData(0, 0, w, h).data;
  const dark = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const gray = 0.299 * image[i * 4] + 0.587 * image[i * 4 + 1] + 0.114 * image[i * 4 + 2];
    dark[i] = gray < 150 ? 1 : 0;
  }

  const scoreAt = (angleDeg: number): number => {
    const rad = (angleDeg * Math.PI) / 180;
    const tan = Math.tan(rad);
    const shift = Math.ceil(Math.abs(tan) * w);
    const rows = new Float64Array(h + shift * 2);
    for (let y = 0; y < h; y += 2) {
      for (let x = 0; x < w; x += 2) {
        if (!dark[y * w + x]) continue;
        const yy = Math.round(y + (x - w / 2) * tan) + shift;
        if (yy >= 0 && yy < rows.length) rows[yy] += 1;
      }
    }
    let mean = 0;
    for (let i = 0; i < rows.length; i++) mean += rows[i];
    mean /= rows.length;
    let variance = 0;
    for (let i = 0; i < rows.length; i++) {
      const d = rows[i] - mean;
      variance += d * d;
    }
    return variance;
  };

  let bestAngle = 0;
  let bestScore = -1;
  for (let a = -6; a <= 6; a += 1) {
    const score = scoreAt(a);
    if (score > bestScore) {
      bestScore = score;
      bestAngle = a;
    }
  }
  // لا ندوّر عند ميل ضئيل
  return Math.abs(bestAngle) <= 1 ? 0 : bestAngle;
}

/** دوارة بزاوية عشوائية مع توسيع اللوحة لتفادي القص */
export function rotateCanvas(canvas: HTMLCanvasElement, angleDeg: number): HTMLCanvasElement {
  if (Math.abs(angleDeg) < 0.05) return canvas;
  const rad = (angleDeg * Math.PI) / 180;
  const cos = Math.abs(Math.cos(rad));
  const sin = Math.abs(Math.sin(rad));
  const w = Math.ceil(canvas.width * cos + canvas.height * sin);
  const h = Math.ceil(canvas.width * sin + canvas.height * cos);
  const out = makeCanvas(w, h);
  const ctx = out.getContext('2d');
  if (!ctx) return canvas;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  ctx.translate(w / 2, h / 2);
  ctx.rotate(rad);
  ctx.drawImage(canvas, -canvas.width / 2, -canvas.height / 2);
  return out;
}

/** خط الأنابيب الكامل: فك الترميز ← تدوير/قص/تكبير ← تحسين ← تصحيح ميل ← ثنائية */
export async function processImage(blob: Blob, opts: ProcessOptions = {}): Promise<ProcessedImage> {
  const { source, width, height, cleanup } = await decode(blob);
  try {
    let canvas = drawSource(source, width, height, opts);
    if (opts.grayscale || (opts.contrast ?? 1) !== 1) {
      enhanceCanvas(canvas, { grayscale: opts.grayscale, contrast: opts.contrast });
    }
    let skewAngle = 0;
    if (opts.deskew) {
      skewAngle = estimateSkew(canvas);
      if (skewAngle !== 0) {
        canvas = rotateCanvas(canvas, skewAngle);
        enhanceCanvas(canvas, { grayscale: opts.grayscale, contrast: opts.contrast });
      }
    }
    if (opts.binarize) binarizeCanvas(canvas);
    return { canvas, width: canvas.width, height: canvas.height, skewAngle };
  } finally {
    cleanup();
  }
}

export function canvasToBlob(canvas: HTMLCanvasElement, type = 'image/png', quality = 0.92): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('CANVAS_EXPORT_FAILED'))),
      type,
      quality,
    );
  });
}

export function canvasToDataUrl(canvas: HTMLCanvasElement): string {
  return canvas.toDataURL('image/jpeg', 0.82);
}

/** هل الملف PDF؟ */
export function isPdf(file: File | Blob): boolean {
  return file.type === 'application/pdf' || (file instanceof File && /\.pdf$/i.test(file.name));
}

/**
 * يحوّل أول صفحة من PDF إلى صورة PNG عالية الدقة.
 * pdfjs يُحمَّل ديناميكيًا كي لا يزيد حجم الحزمة الأساسية.
 */
export async function pdfToImage(file: Blob, pageNumber = 1): Promise<{ blob: Blob; pageCount: number; width: number; height: number }> {
  const pdfjs = await import('pdfjs-dist');
  const workerModule = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
  pdfjs.GlobalWorkerOptions.workerSrc = workerModule.default;

  const data = new Uint8Array(await file.arrayBuffer());
  const doc = await pdfjs.getDocument({ data }).promise;
  try {
    const page = await doc.getPage(Math.min(Math.max(1, pageNumber), doc.numPages));
    const viewport = page.getViewport({ scale: 2.2 });
    const canvas = makeCanvas(viewport.width, viewport.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('CANVAS_UNAVAILABLE');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvas, canvasContext: ctx, viewport }).promise;
    return {
      blob: await canvasToBlob(canvas, 'image/png'),
      pageCount: doc.numPages,
      width: canvas.width,
      height: canvas.height,
    };
  } finally {
    // إغلاق المستند وتحرير الموارد
    doc.cleanup();
  }
}
