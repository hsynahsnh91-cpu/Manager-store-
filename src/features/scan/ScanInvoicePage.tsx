import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  Camera,
  CheckCircle2,
  Crop,
  FileText,
  Image as ImageIcon,
  Loader2,
  Minus,
  Plus,
  RotateCcw,
  RotateCw,
  ScanLine,
  Sparkles,
  Trash2,
  Upload,
  Wand2,
} from 'lucide-react';
import type { ScannedInvoice, ScannedInvoiceItem } from '../../types';
import { useAsync } from '../../hooks/useAsync';
import { useApp } from '../../context/AppContext';
import { useI18n } from '../../i18n';
import { Button } from '../../components/Button';
import { Input, Select } from '../../components/Form';
import { Badge, StatCard } from '../../components/UI';
import { Modal } from '../../components/Modal';
import { formatMoney, round2 } from '../../utils/money';
import { formatDate, fromDateInput, startOfDay, toDateInput } from '../../utils/dates';
import { uid } from '../../utils/id';
import { listProducts } from '../../services/products';
import { listCategories, suggestCategory } from '../../services/categories';
import { classifyPriceChange, pricingSettings, suggestSalePrice, summarizePriceChanges } from '../../services/prices';
import { rankProductMatches } from '../../services/ocr/matchProducts';
import { OCR_ENGINE_LABEL, scanInvoiceImage, terminateOcr, type OcrProgress } from '../../services/ocr/engine';
import {
  isPdf,
  pdfToImage,
  processImage,
  type CropFraction,
} from '../../services/ocr/imageProcessing';
import {
  confirmScannedInvoice,
  findDuplicates,
  storeInvoiceImage,
  ScannedInvoiceError,
  type DuplicateCandidate,
} from '../../services/scannedInvoices';

type Stage = 'upload' | 'review' | 'done';

interface ReviewItem {
  id: string;
  rawName: string;
  name: string;
  quantity: string;
  unitPrice: string;
  confidence: number;
  needsReview: boolean;
  unit: string;
  productId: string;
  matchScore: number;
  createNew: boolean;
  ignored: boolean;
  category: string;
  categorySuggested: boolean;
  updateSalePrice: boolean;
  newSalePrice: string;
}

interface HeaderForm {
  supplierName: string;
  invoiceNumber: string;
  invoiceDate: string;
  discount: string;
  tax: string;
}

const STATUS_LABELS: Record<string, string> = {
  'loading tesseract core': 'تحميل محرك التعرّف',
  'initializing tesseract': 'تهيئة المحرك',
  'loading language traineddata': 'تحميل بيانات اللغة (عربي/إنجليزي)',
  'initializing api': 'تهيئة واجهة التعرّف',
  'recognizing text': 'قراءة النص من الصورة',
};

function isImageFile(file: File): boolean {
  return file.type.startsWith('image/');
}

export function ScanInvoicePage() {
  const { t, lang } = useI18n();
  const { settings, toast } = useApp();
  const pricing = pricingSettings(settings);

  const { data: productData, reload: reloadProducts } = useAsync(() => listProducts(), []);
  const { data: categoryData, reload: reloadCategories } = useAsync(() => listCategories(), []);
  const products = productData ?? [];
  const categories = categoryData ?? [];

  const [stage, setStage] = useState<Stage>('upload');
  const [file, setFile] = useState<File | null>(null);
  const [sourceBlob, setSourceBlob] = useState<Blob | null>(null);
  const [imageId, setImageId] = useState<string | null>(null);
  const [imageName, setImageName] = useState('');
  const [imageSize, setImageSize] = useState<{ width: number; height: number } | null>(null);
  const [pdfPages, setPdfPages] = useState<number | null>(null);

  const [rotation, setRotation] = useState(0);
  const [crop, setCrop] = useState<CropFraction | null>(null);
  const [grayscale, setGrayscale] = useState(true);
  const [contrast, setContrast] = useState(1.35);
  const [binarize, setBinarize] = useState(false);
  const [deskew, setDeskew] = useState(true);
  const [cropMode, setCropMode] = useState(false);
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);
  const [dragRect, setDragRect] = useState<CropFraction | null>(null);

  const [previewUrl, setPreviewUrl] = useState('');
  const [previewLoading, setPreviewLoading] = useState(false);
  const [skewAngle, setSkewAngle] = useState(0);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const objectUrlRef = useRef<string>('');

  const [ocrRunning, setOcrRunning] = useState(false);
  const [progress, setProgress] = useState<OcrProgress>({ status: '', progress: 0 });
  const [ocrError, setOcrError] = useState('');
  const [rawText, setRawText] = useState('');
  const [ocrConfidence, setOcrConfidence] = useState(0);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [unparsedLines, setUnparsedLines] = useState<string[]>([]);
  const [showRawText, setShowRawText] = useState(false);
  const [parsedSnapshot, setParsedSnapshot] = useState<{
    supplierName: string;
    invoiceNumber: string;
    invoiceDate: string;
    discount: string;
    tax: string;
    items: { id: string; name: string; quantity: string; unitPrice: string }[];
  } | null>(null);

  const [header, setHeader] = useState<HeaderForm>({
    supplierName: '',
    invoiceNumber: '',
    invoiceDate: toDateInput(Date.now()),
    discount: '0',
    tax: '0',
  });
  const [reviewItems, setReviewItems] = useState<ReviewItem[]>([]);
  const [applyPurchasePrices, setApplyPurchasePrices] = useState(true);
  const [saving, setSaving] = useState(false);
  const [duplicates, setDuplicates] = useState<DuplicateCandidate[] | null>(null);
  const [doneInvoice, setDoneInvoice] = useState<ScannedInvoice | null>(null);

  const totals = useMemo(() => {
    const subtotal = round2(
      reviewItems
        .filter((r) => !r.ignored)
        .reduce((acc, r) => acc + round2(Number(r.quantity || 0) * Number(r.unitPrice || 0)), 0),
    );
    const discount = round2(Number(header.discount || 0));
    const tax = round2(Number(header.tax || 0));
    return { subtotal, discount, tax, total: round2(subtotal - discount + tax) };
  }, [reviewItems, header.discount, header.tax]);

  const activeItems = useMemo(() => reviewItems.filter((r) => !r.ignored), [reviewItems]);

  const priceSummary = useMemo(() => {
    const changes = activeItems
      .filter((r) => r.productId)
      .map((r) => {
        const product = products.find((p) => p.id === r.productId);
        if (!product) return null;
        return classifyPriceChange(product, Number(r.unitPrice || 0));
      })
      .filter((c): c is NonNullable<typeof c> => c !== null);
    return summarizePriceChanges(changes);
  }, [activeItems, products]);

  const staleCount = useMemo(() => {
    const invoiceDay = startOfDay(fromDateInput(header.invoiceDate));
    return activeItems.filter((r) => {
      if (!r.productId) return false;
      const product = products.find((p) => p.id === r.productId);
      if (!product?.purchasePriceUpdatedAt) return false;
      return invoiceDay < startOfDay(product.purchasePriceUpdatedAt);
    }).length;
  }, [activeItems, products, header.invoiceDate]);

  const staleSkippedCount = useMemo(
    () => (doneInvoice?.priceUpdates ?? []).filter((p) => p.action === 'skipped' && p.reason === 'stale').length,
    [doneInvoice],
  );

  const newProductsCount = useMemo(
    () => activeItems.filter((r) => !r.productId && r.createNew).length,
    [activeItems],
  );

  // تنظيف روابط الصور والتحرير عند مغادرة الصفحة
  useEffect(() => {
    return () => {
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
      void terminateOcr();
    };
  }, []);

  // معاينة الصورة بعد المعالجة (تدوير/قص/تحسين)
  useEffect(() => {
    if (!sourceBlob) return;
    let cancelled = false;
    setPreviewLoading(true);
    processImage(sourceBlob, {
      rotation,
      crop: cropMode ? null : crop,
      grayscale,
      contrast,
      binarize,
      deskew,
      maxWidth: 2000,
    })
      .then((result) => {
        if (cancelled) return;
        canvasRef.current = result.canvas;
        setSkewAngle(result.skewAngle);
        setPreviewUrl(result.canvas.toDataURL('image/jpeg', 0.85));
      })
      .catch(() => {
        if (!cancelled) setPreviewUrl('');
      })
      .finally(() => {
        if (!cancelled) setPreviewLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [sourceBlob, rotation, crop, cropMode, grayscale, contrast, binarize, deskew]);

  const resetReview = () => {
    setRawText('');
    setWarnings([]);
    setUnparsedLines([]);
    setReviewItems([]);
    setDuplicates(null);
    setOcrError('');
    setHeader({ supplierName: '', invoiceNumber: '', invoiceDate: toDateInput(Date.now()), discount: '0', tax: '0' });
    setParsedSnapshot(null);
  };

  const onPickFile = useCallback(
    async (picked: File) => {
      if (!picked) return;
      if (!isImageFile(picked) && !isPdf(picked)) {
        toast(t('unsupportedFile'), 'error');
        return;
      }
      if (picked.size > 20 * 1024 * 1024) {
        toast(t('fileTooLarge'), 'error');
        return;
      }
      setFile(picked);
      setStage('upload');
      resetReview();
      setRotation(0);
      setCrop(null);
      setCropMode(false);
      setBinarize(false);
      setPdfPages(null);
      setImageId(null);
      setImageSize(null);
      setImageName(picked.name);

      try {
        let blob: Blob = picked;
        let name = picked.name;
        let size: { width: number; height: number } | null = null;
        if (isPdf(picked)) {
          const pdf = await pdfToImage(picked, 1);
          blob = pdf.blob;
          name = `${picked.name.replace(/\.pdf$/i, '')}-صفحة-1.png`;
          setPdfPages(pdf.pageCount);
          size = { width: pdf.width, height: pdf.height };
        } else {
          const processed = await processImage(blob, { maxWidth: 2400 });
          size = { width: processed.width, height: processed.height };
        }
        setSourceBlob(blob);
        setImageName(name);
        setImageSize(size);
        // حفظ الصورة الأصلية فورًا — حتى لو فشل التعرّف لاحقًا لا تُفقد
        const saved = await storeInvoiceImage(blob, {
          name,
          width: size?.width ?? 0,
          height: size?.height ?? 0,
        });
        setImageId(saved.id);
        if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = URL.createObjectURL(blob);
        toast(t('imageSaved'));
      } catch {
        toast(t('imageError'), 'error');
      }
    },
    [t, toast],
  );

  const runScan = async () => {
    if (!canvasRef.current) return;
    setOcrRunning(true);
    setOcrError('');
    setProgress({ status: 'loading tesseract core', progress: 0 });
    try {
      const { ocr, parsed } = await scanInvoiceImage(canvasRef.current, setProgress);
      setRawText(ocr.text);
      setOcrConfidence(ocr.confidence);
      setWarnings(parsed.warnings);
      setUnparsedLines(parsed.unparsedLines);
      setHeader({
        supplierName: parsed.supplierName,
        invoiceNumber: parsed.invoiceNumber,
        invoiceDate: toDateInput(parsed.invoiceDate ?? Date.now()),
        discount: String(parsed.discount ?? 0),
        tax: String(parsed.tax ?? 0),
      });

      setParsedSnapshot({
        supplierName: parsed.supplierName,
        invoiceNumber: parsed.invoiceNumber,
        invoiceDate: toDateInput(parsed.invoiceDate ?? Date.now()),
        discount: String(parsed.discount ?? 0),
        tax: String(parsed.tax ?? 0),
        items: parsed.items.map((item) => ({
          id: '',
          name: item.name,
          quantity: String(item.quantity),
          unitPrice: String(item.unitPrice),
        })),
      });

      const mapped: ReviewItem[] = parsed.items.map((item) => {
        const candidates = rankProductMatches(item.name, products);
        const best = candidates[0];
        const confident = best && best.score >= 0.78;
        const suggestion = suggestCategory(item.name, categories);
        const suggestedSale = suggestSalePrice(item.unitPrice, { marginPercent: pricing.margin, roundTo: pricing.roundTo });
        return {
          id: uid('row'),
          rawName: item.rawName,
          name: item.name,
          quantity: String(item.quantity),
          unitPrice: String(item.unitPrice),
          confidence: item.confidence,
          needsReview: item.needsReview || !confident,
          unit: item.unit,
          productId: confident ? best.product.id : '',
          matchScore: best?.score ?? 0,
          createNew: false,
          ignored: false,
          category: suggestion.category ?? categories[0]?.name ?? '',
          categorySuggested: Boolean(suggestion.category),
          updateSalePrice: pricing.policy === 'auto' && Boolean(suggestedSale),
          newSalePrice: suggestedSale ? String(suggestedSale) : '',
        };
      });
      setReviewItems(mapped);
      setParsedSnapshot((prev) =>
        prev ? { ...prev, items: mapped.map((r) => ({ id: r.id, name: r.name, quantity: r.quantity, unitPrice: r.unitPrice })) } : prev,
      );
      setStage('review');
      if (mapped.length === 0) {
        toast(t('noItemsFound'), 'error');
      }
    } catch (err) {
      setOcrError(err instanceof Error ? err.message : t('scanFailed'));
    } finally {
      setOcrRunning(false);
    }
  };

  const updateItem = (id: string, patch: Partial<ReviewItem>) => {
    setReviewItems((items) => items.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  };

  const cropMouse = (e: React.MouseEvent<HTMLDivElement>, phase: 'start' | 'move' | 'end') => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    const y = Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height));
    if (phase === 'start') {
      setDragStart({ x, y });
      setDragRect({ x, y, width: 0, height: 0 });
    } else if (phase === 'move' && dragStart) {
      setDragRect({
        x: Math.min(dragStart.x, x),
        y: Math.min(dragStart.y, y),
        width: Math.abs(x - dragStart.x),
        height: Math.abs(y - dragStart.y),
      });
    } else if (phase === 'end') {
      setDragStart(null);
      if (dragRect && dragRect.width > 0.05 && dragRect.height > 0.05) {
        setCrop(dragRect);
        setCropMode(false);
      }
      setDragRect(null);
    }
  };

  const submit = async (allowDuplicate = false) => {
    if (saving) return; // منع الحفظ المزدوج عند النقر المتكرر
    if (activeItems.length === 0) {
      toast(t('noItemsFound'), 'error');
      return;
    }
    const missingCategory = activeItems.find((r) => !r.productId && r.createNew && !r.category.trim());
    if (missingCategory) {
      toast(t('chooseCategory'), 'error');
      return;
    }
    setSaving(true);
    try {
      const items: ScannedInvoiceItem[] = reviewItems.map((r) => ({
        id: r.id,
        rawName: r.rawName,
        name: r.name.trim(),
        quantity: round2(Number(r.quantity || 0)),
        unitPrice: round2(Number(r.unitPrice || 0)),
        lineTotal: round2(Number(r.quantity || 0) * Number(r.unitPrice || 0)),
        discount: 0,
        tax: 0,
        unit: r.unit,
        productId: r.productId || null,
        matchState: r.ignored ? 'ignored' : r.productId ? 'matched' : r.createNew ? 'new' : 'unlinked',
        matchScore: r.matchScore,
        confidence: r.confidence,
        needsReview: r.needsReview,
      }));

      const newProducts = reviewItems
        .filter((r) => !r.ignored && !r.productId && r.createNew)
        .map((r) => ({
          itemId: r.id,
          name: r.name.trim(),
          category: r.category.trim(),
          salePrice: round2(Number(r.newSalePrice || r.unitPrice || 0)),
          unit: r.unit,
        }));

      const priceDecisions = reviewItems
        .filter((r) => !r.ignored && r.productId && r.updateSalePrice && Number(r.newSalePrice) > 0)
        .map((r) => ({ itemId: r.id, newSalePrice: round2(Number(r.newSalePrice)) }));

      const computedEdits: { field: string; from: string; to: string; at: number }[] = [];
      if (parsedSnapshot) {
        const now = Date.now();
        for (const field of ['supplierName', 'invoiceNumber', 'invoiceDate', 'discount', 'tax'] as const) {
          if (parsedSnapshot[field] !== header[field]) {
            computedEdits.push({ field, from: parsedSnapshot[field], to: header[field], at: now });
          }
        }
        for (const row of reviewItems) {
          const original = parsedSnapshot.items.find((i) => i.id === row.id);
          if (!original) continue;
          if (
            original.name !== row.name ||
            original.quantity !== row.quantity ||
            original.unitPrice !== row.unitPrice
          ) {
            computedEdits.push({
              field: `item:${original.name || row.name}`,
              from: `${original.name} · ${original.quantity} × ${original.unitPrice}`,
              to: `${row.name} · ${row.quantity} × ${row.unitPrice}`,
              at: now,
            });
          }
        }
      }

      const invoice = await confirmScannedInvoice({
        supplierName: header.supplierName,
        invoiceNumber: header.invoiceNumber,
        invoiceDate: fromDateInput(header.invoiceDate),
        subtotal: totals.subtotal,
        discount: totals.discount,
        tax: totals.tax,
        total: totals.total,
        items,
        rawText,
        imageId,
        imageName,
        ocrConfidence,
        engine: OCR_ENGINE_LABEL,
        applyPurchasePrices,
        priceDecisions,
        newProducts,
        allowDuplicate,
        edits: computedEdits,
      });

      setDoneInvoice(invoice);
      setDuplicates(null);
      setStage('done');
      reloadProducts();
      reloadCategories();
      toast(t('invoiceSaved'));
    } catch (err) {
      if (err instanceof ScannedInvoiceError && err.code === 'DUPLICATE') {
        setDuplicates(err.duplicates ?? null);
      } else {
        toast(err instanceof Error ? err.message : t('error'), 'error');
      }
    } finally {
      setSaving(false);
    }
  };

  const checkBeforeSave = async () => {
    const dups = await findDuplicates({
      supplierName: header.supplierName,
      invoiceNumber: header.invoiceNumber,
      invoiceDate: fromDateInput(header.invoiceDate),
      total: totals.total,
    });
    if (dups.length > 0) setDuplicates(dups);
    else await submit(false);
  };

  const resetAll = () => {
    setStage('upload');
    setFile(null);
    setSourceBlob(null);
    setImageId(null);
    setImageName('');
    setPreviewUrl('');
    setCrop(null);
    setRotation(0);
    setDoneInvoice(null);
    resetReview();
  };

  const marginFor = (row: ReviewItem): number | null => {
    const cost = Number(row.unitPrice);
    const sale = Number(row.newSalePrice);
    if (!(cost > 0) || !(sale > 0)) return null;
    return round2(((sale - cost) / cost) * 100);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-extrabold text-slate-800 dark:text-white">{t('scanTitle')}</h1>
          <p className="mt-0.5 text-xs text-slate-400">{t('scanSubtitle')}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link to="/invoice-library">
            <Button size="sm" variant="secondary" icon={<FileText size={15} />}>{t('invoiceLibrary')}</Button>
          </Link>
          <Link to="/sales-log">
            <Button size="sm" variant="ghost" icon={<ScanLine size={15} />}>{t('salesLogTitle')}</Button>
          </Link>
        </div>
      </div>

      <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-800 dark:border-amber-900/40 dark:bg-amber-900/20 dark:text-amber-200">
        <span className="font-bold">{t('ocrNoteTitle')}: </span>
        {t('ocrLimitation')}
      </div>

      {stage === 'upload' && (
        <div className="grid gap-4 lg:grid-cols-5">
          <div className="lg:col-span-2">
            <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
              <h2 className="mb-3 text-sm font-bold text-slate-700 dark:text-slate-200">{t('uploadImage')}</h2>
              <label
                className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-300 px-4 py-8 text-center transition-colors hover:border-brand-400 hover:bg-brand-50/40 dark:border-slate-600 dark:hover:border-brand-500 dark:hover:bg-brand-900/10"
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const dropped = e.dataTransfer.files?.[0];
                  if (dropped) void onPickFile(dropped);
                }}
              >
                <Upload size={26} className="text-slate-400" />
                <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">{t('dropHint')}</span>
                <span className="text-[11px] text-slate-400">{t('pdfHint')}</span>
                <input
                  type="file"
                  accept="image/*,application/pdf"
                  capture="environment"
                  className="hidden"
                  onChange={(e) => {
                    const picked = e.target.files?.[0];
                    if (picked) void onPickFile(picked);
                    e.target.value = '';
                  }}
                />
              </label>

              <div className="mt-3 flex items-center gap-2">
                <label className="flex-1">
                  <span className="sr-only">{t('takePhoto')}</span>
                  <span className="flex h-10 cursor-pointer items-center justify-center gap-2 rounded-lg bg-slate-100 text-xs font-semibold text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700">
                    <Camera size={15} /> {t('takePhoto')}
                    <input
                      type="file"
                      accept="image/*"
                      capture="environment"
                      className="hidden"
                      onChange={(e) => {
                        const picked = e.target.files?.[0];
                        if (picked) void onPickFile(picked);
                        e.target.value = '';
                      }}
                    />
                  </span>
                </label>
              </div>

              {file && (
                <div className="mt-3 space-y-1 rounded-lg bg-slate-50 px-3 py-2 text-[11px] text-slate-500 dark:bg-slate-800/60 dark:text-slate-400">
                  <p className="flex items-center gap-1.5 font-semibold text-slate-600 dark:text-slate-300">
                    <ImageIcon size={13} /> {imageName}
                  </p>
                  {imageSize && <p>{imageSize.width} × {imageSize.height}px</p>}
                  {pdfPages && <p>{t('pdfPages')}: {pdfPages} ({t('firstPageOnly')})</p>}
                  {imageId && <p className="text-emerald-600 dark:text-emerald-400">{t('imageSaved')}</p>}
                </div>
              )}

              <div className="mt-3 space-y-2 border-t border-slate-100 pt-3 dark:border-slate-800">
                <p className="text-[11px] font-bold text-slate-500 dark:text-slate-400">{t('imageTools')}</p>
                <div className="flex flex-wrap gap-1.5">
                  <Button size="sm" variant="secondary" icon={<RotateCcw size={14} />} onClick={() => setRotation((r) => (r + 270) % 360)}>
                    {t('rotateLeft')}
                  </Button>
                  <Button size="sm" variant="secondary" icon={<RotateCw size={14} />} onClick={() => setRotation((r) => (r + 90) % 360)}>
                    {t('rotateRight')}
                  </Button>
                  <Button size="sm" variant={cropMode ? 'primary' : 'secondary'} icon={<Crop size={14} />} onClick={() => { setCropMode((v) => !v); setDragRect(null); }}>
                    {t('crop')}
                  </Button>
                  {crop && (
                    <Button size="sm" variant="ghost" icon={<Trash2 size={14} />} onClick={() => setCrop(null)}>
                      {t('resetCrop')}
                    </Button>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-500 dark:text-slate-400">
                  <label className="flex items-center gap-1.5">
                    <input type="checkbox" className="h-3.5 w-3.5 rounded border-slate-300 text-brand-600" checked={grayscale} onChange={(e) => setGrayscale(e.target.checked)} />
                    {t('grayscale')}
                  </label>
                  <label className="flex items-center gap-1.5">
                    <input type="checkbox" className="h-3.5 w-3.5 rounded border-slate-300 text-brand-600" checked={binarize} onChange={(e) => setBinarize(e.target.checked)} />
                    {t('binarize')}
                  </label>
                  <label className="flex items-center gap-1.5">
                    <input type="checkbox" className="h-3.5 w-3.5 rounded border-slate-300 text-brand-600" checked={deskew} onChange={(e) => setDeskew(e.target.checked)} />
                    {t('deskew')}
                  </label>
                </div>
                <div>
                  <label className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
                    <span>{t('contrast')}</span>
                    <span className="font-mono">{contrast.toFixed(2)}</span>
                  </label>
                  <input
                    type="range"
                    min={0.8}
                    max={2.2}
                    step={0.05}
                    value={contrast}
                    onChange={(e) => setContrast(Number(e.target.value))}
                    className="w-full accent-brand-600"
                  />
                </div>
              </div>

              <Button
                block
                className="mt-3"
                icon={<Wand2 size={16} />}
                onClick={() => void runScan()}
                loading={ocrRunning}
                disabled={!canvasRef.current || !sourceBlob}
              >
                {ocrRunning ? t('scanning') : t('startScan')}
              </Button>
            </div>
          </div>

          <div className="lg:col-span-3">
            <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
              <div className="mb-2 flex items-center justify-between">
                <h2 className="text-sm font-bold text-slate-700 dark:text-slate-200">{t('preview')}</h2>
                <div className="flex items-center gap-2 text-[10px] text-slate-400">
                  {skewAngle !== 0 && <Badge tone="amber">{t('skewCorrected')} {skewAngle}°</Badge>}
                  {previewLoading && <Loader2 size={13} className="animate-spin" />}
                </div>
              </div>

              {!sourceBlob ? (
                <div className="flex h-72 flex-col items-center justify-center gap-2 rounded-lg bg-slate-50 text-slate-400 dark:bg-slate-800/40">
                  <ImageIcon size={30} />
                  <p className="text-xs">{t('noImageYet')}</p>
                </div>
              ) : (
                <div>
                  <div
                    className={`relative select-none overflow-hidden rounded-lg bg-slate-100 dark:bg-slate-800 ${cropMode ? 'cursor-crosshair' : ''}`}
                    onMouseDown={(e) => cropMode && cropMouse(e, 'start')}
                    onMouseMove={(e) => cropMode && dragStart && cropMouse(e, 'move')}
                    onMouseUp={(e) => cropMode && cropMouse(e, 'end')}
                  >
                    {previewUrl && (
                      <img src={previewUrl} alt={t('invoicePreview')} className="max-h-[420px] w-full object-contain" draggable={false} />
                    )}
                    {cropMode && dragRect && (
                      <div
                        className="pointer-events-none absolute border-2 border-brand-500 bg-brand-500/15"
                        style={{
                          left: `${dragRect.x * 100}%`,
                          top: `${dragRect.y * 100}%`,
                          width: `${dragRect.width * 100}%`,
                          height: `${dragRect.height * 100}%`,
                        }}
                      />
                    )}
                    {cropMode && !dragRect && (
                      <div className="pointer-events-none absolute inset-0 flex items-end justify-center bg-slate-900/5 pb-3">
                        <span className="rounded bg-slate-900/70 px-2 py-1 text-[10px] text-white">{t('cropHint')}</span>
                      </div>
                    )}
                  </div>
                  <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-400">
                    <span>{t('rotation')}: {rotation}° · {t('engine')}: {OCR_ENGINE_LABEL}</span>
                    {crop && <Badge tone="green">{t('cropped')}</Badge>}
                  </div>

                  {(ocrRunning || progress.progress > 0) && (
                    <div className="mt-3">
                      <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
                        <span>{STATUS_LABELS[progress.status] ?? progress.status ?? t('scanning')}</span>
                        <span className="font-mono">{Math.round(progress.progress * 100)}%</span>
                      </div>
                      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
                        <div className="h-full rounded-full bg-brand-600 transition-all" style={{ width: `${Math.round(progress.progress * 100)}%` }} />
                      </div>
                    </div>
                  )}

                  {ocrError && (
                    <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 p-3 text-[11px] text-rose-700 dark:border-rose-900/40 dark:bg-rose-900/20 dark:text-rose-300">
                      <p className="flex items-center gap-1.5 font-bold"><AlertTriangle size={14} /> {t('scanFailed')}</p>
                      <p className="mt-1 leading-relaxed">{ocrError}</p>
                      <p className="mt-1 text-rose-500">{t('imageKept')}</p>
                      <Button size="sm" variant="secondary" className="mt-2" onClick={() => void runScan()}>
                        {t('retry')}
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {stage === 'review' && (
        <div className="space-y-4">
          {(warnings.length > 0 || unparsedLines.length > 0) && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-[11px] text-amber-800 dark:border-amber-900/40 dark:bg-amber-900/20 dark:text-amber-200">
              <p className="flex items-center gap-1.5 font-bold"><AlertTriangle size={14} /> {t('reviewWarnings')}</p>
              <ul className="mt-1 list-inside list-disc space-y-0.5">
                {warnings.map((w) => <li key={w}>{w}</li>)}
              </ul>
              {unparsedLines.length > 0 && (
                <details className="mt-1">
                  <summary className="cursor-pointer">{t('unparsedLines')} ({unparsedLines.length})</summary>
                  <ul className="mt-1 space-y-0.5 font-mono text-[10px]">
                    {unparsedLines.map((l, i) => <li key={i}>{l}</li>)}
                  </ul>
                </details>
              )}
            </div>
          )}

          <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-bold text-slate-700 dark:text-slate-200">{t('invoiceHeader')}</h2>
              <div className="flex items-center gap-2">
                <Badge tone={ocrConfidence >= 80 ? 'green' : ocrConfidence >= 60 ? 'amber' : 'rose'}>
                  {t('ocrConfidenceLabel')}: {ocrConfidence}%
                </Badge>
                <button type="button" onClick={() => setShowRawText((v) => !v)} className="text-[11px] font-semibold text-brand-600 hover:underline dark:text-brand-400">
                  {showRawText ? t('hideRawText') : t('showRawText')}
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <Input
                  label={t('supplier')}
                  value={header.supplierName}
                  onChange={(e) => setHeader((h) => ({ ...h, supplierName: e.target.value }))}
                />
                {!header.supplierName && <p className="mt-1 text-[10px] font-semibold text-amber-600">{t('needsReview')}</p>}
              </div>
              <Input
                label={t('invoiceNumber')}
                value={header.invoiceNumber}
                onChange={(e) => setHeader((h) => ({ ...h, invoiceNumber: e.target.value }))}
              />
              <Input
                type="date"
                label={t('invoiceDateLabel')}
                value={header.invoiceDate}
                onChange={(e) => setHeader((h) => ({ ...h, invoiceDate: e.target.value }))}
              />
              <Input
                type="number"
                step="0.01"
                label={t('discountLabel')}
                value={header.discount}
                onChange={(e) => setHeader((h) => ({ ...h, discount: e.target.value }))}
              />
              <Input
                type="number"
                step="0.01"
                label={t('taxLabel')}
                value={header.tax}
                onChange={(e) => setHeader((h) => ({ ...h, tax: e.target.value }))}
              />
              <div className="rounded-lg bg-slate-50 px-3 py-2 dark:bg-slate-800/60">
                <p className="text-[10px] text-slate-400">{t('totalComputed')}</p>
                <p className="font-mono text-base font-bold text-slate-800 dark:text-slate-100">{formatMoney(totals.total, settings.currency)}</p>
              </div>
            </div>

            {showRawText && (
              <pre className="mt-3 max-h-48 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-900 p-3 text-[11px] leading-relaxed text-slate-200" dir="auto">
                {rawText}
              </pre>
            )}
          </div>

          <div className="rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-2.5 dark:border-slate-800">
              <h2 className="text-sm font-bold text-slate-700 dark:text-slate-200">{t('reviewItems')}</h2>
              <Button
                size="sm"
                variant="ghost"
                icon={<Plus size={14} />}
                onClick={() =>
                  setReviewItems((items) => [
                    ...items,
                    {
                      id: uid('row'),
                      rawName: '',
                      name: '',
                      quantity: '1',
                      unitPrice: '0',
                      confidence: 1,
                      needsReview: false,
                      unit: '',
                      productId: '',
                      matchScore: 0,
                      createNew: true,
                      ignored: false,
                      category: categories[0]?.name ?? '',
                      categorySuggested: false,
                      updateSalePrice: false,
                      newSalePrice: '',
                    },
                  ])
                }
              >
                {t('addRow')}
              </Button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[880px] text-xs">
                <thead className="bg-slate-50 text-[10px] uppercase text-slate-400 dark:bg-slate-800/50">
                  <tr>
                    <th className="px-3 py-2 text-start">{t('itemName')}</th>
                    <th className="w-20 px-3 py-2 text-start">{t('quantity')}</th>
                    <th className="w-24 px-3 py-2 text-start">{t('unitPrice')}</th>
                    <th className="w-24 px-3 py-2 text-start">{t('lineTotal')}</th>
                    <th className="w-56 px-3 py-2 text-start">{t('linkProduct')}</th>
                    <th className="w-32 px-3 py-2 text-start">{t('priceImpact')}</th>
                    <th className="w-10 px-3 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {reviewItems.map((row) => {
                    const product = products.find((p) => p.id === row.productId);
                    const change = product ? classifyPriceChange(product, Number(row.unitPrice || 0)) : null;
                    const margins = marginFor(row);
                    return (
                      <tr key={row.id} className={`border-t border-slate-100 dark:border-slate-800 ${row.ignored ? 'opacity-40' : ''}`}>
                        <td className="px-3 py-2">
                          <Input
                            value={row.name}
                            onChange={(e) => updateItem(row.id, { name: e.target.value, needsReview: false })}
                            className={row.needsReview ? 'border-amber-400' : ''}
                            aria-invalid={row.needsReview}
                          />
                          <div className="mt-1 flex items-center gap-1.5">
                            {row.needsReview && <Badge tone="amber">{t('needsReview')}</Badge>}
                            <span className="text-[10px] text-slate-400">
                              {t('fieldConfidence')}: {Math.round(row.confidence * 100)}%
                            </span>
                            {row.rawName && row.rawName !== row.name && (
                              <span className="text-[10px] text-slate-400 line-through">{row.rawName}</span>
                            )}
                          </div>
                        </td>
                        <td className="px-3 py-2">
                          <Input
                            type="number"
                            step="any"
                            value={row.quantity}
                            onChange={(e) => updateItem(row.id, { quantity: e.target.value, needsReview: false })}
                            className={row.needsReview ? 'border-amber-400' : ''}
                            aria-invalid={row.needsReview}
                            title={row.needsReview ? t('needsReview') : undefined}
                          />
                        </td>
                        <td className="px-3 py-2">
                          <Input
                            type="number"
                            step="0.01"
                            value={row.unitPrice}
                            onChange={(e) => updateItem(row.id, { unitPrice: e.target.value, needsReview: false })}
                            className={row.needsReview ? 'border-amber-400' : ''}
                            aria-invalid={row.needsReview}
                            title={row.needsReview ? t('needsReview') : undefined}
                          />
                        </td>
                        <td className="px-3 py-2 font-mono text-slate-600 dark:text-slate-300">
                          {formatMoney(round2(Number(row.quantity || 0) * Number(row.unitPrice || 0)), settings.currency)}
                        </td>
                        <td className="px-3 py-2">
                          <Select
                            value={row.ignored ? '__ignore' : row.productId ? row.productId : row.createNew ? '__new' : '__none'}
                            onChange={(e) => {
                              const v = e.target.value;
                              if (v === '__ignore') updateItem(row.id, { ignored: true, productId: '', createNew: false });
                              else if (v === '__none') updateItem(row.id, { ignored: false, productId: '', createNew: false });
                              else if (v === '__new') updateItem(row.id, { ignored: false, productId: '', createNew: true });
                              else updateItem(row.id, { ignored: false, productId: v, createNew: false });
                            }}
                            className="text-xs"
                          >
                            <option value="__none">{t('notLinked')}</option>
                            <option value="__new">{t('createAsNew')}</option>
                            {rankProductMatches(row.name, products).map((m) => (
                              <option key={m.product.id} value={m.product.id}>
                                {m.product.name} ({Math.round(m.score * 100)}%)
                              </option>
                            ))}
                            {row.productId && !rankProductMatches(row.name, products).some((m) => m.product.id === row.productId) && (
                              <option value={row.productId}>{product?.name ?? row.productId}</option>
                            )}
                          </Select>
                          {!row.productId && row.createNew && (
                            <div className="mt-1 space-y-1">
                              <Select value={row.category} onChange={(e) => updateItem(row.id, { category: e.target.value })} className="text-xs">
                                {categories.map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}
                              </Select>
                              {row.categorySuggested && <p className="text-[10px] text-emerald-600 dark:text-emerald-400">{t('categorySuggested')}</p>}
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          {change ? (
                            <div className="space-y-1">
                              <span className={`inline-flex items-center gap-1 text-[11px] font-bold ${
                                change.reason === 'increase' ? 'text-rose-600' : change.reason === 'decrease' ? 'text-emerald-600' : 'text-slate-400'
                              }`}>
                                {change.reason === 'increase' ? <ArrowUpRight size={13} /> : change.reason === 'decrease' ? <ArrowDownRight size={13} /> : <Minus size={13} />}
                                {change.reason === 'increase' ? t('priceIncrease') : change.reason === 'decrease' ? t('priceDecrease') : t('priceSame')}
                              </span>
                              {change.changed && (
                                <p className="font-mono text-[10px] text-slate-400">
                                  {formatMoney(change.oldPrice, settings.currency)} → {formatMoney(change.newPrice, settings.currency)}
                                </p>
                              )}
                              {pricing.policy !== 'never' && change.changed && (
                                <div className="rounded border border-slate-200 p-1.5 dark:border-slate-700">
                                  <label className="flex items-center gap-1 text-[10px] text-slate-500 dark:text-slate-400">
                                    <input
                                      type="checkbox"
                                      className="h-3 w-3 rounded border-slate-300 text-brand-600"
                                      checked={row.updateSalePrice}
                                      onChange={(e) => updateItem(row.id, { updateSalePrice: e.target.checked })}
                                    />
                                    {t('applySalePrice')}
                                  </label>
                                  <div className="mt-1 flex items-center gap-1">
                                    <Input
                                      type="number"
                                      step="0.01"
                                      value={row.newSalePrice}
                                      onChange={(e) => updateItem(row.id, { newSalePrice: e.target.value })}
                                      className="h-7 text-[11px]"
                                    />
                                    {margins !== null && <span className="whitespace-nowrap text-[10px] text-slate-400">{margins}%</span>}
                                  </div>
                                </div>
                              )}
                            </div>
                          ) : (
                            <span className="text-[11px] text-slate-400">—</span>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          <button
                            type="button"
                            onClick={() => setReviewItems((items) => items.filter((i) => i.id !== row.id))}
                            className="rounded p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-900/20"
                            aria-label={t('delete')}
                          >
                            <Trash2 size={14} />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-4 py-3 text-xs dark:border-slate-800">
              <div className="flex flex-wrap items-center gap-3 text-slate-500 dark:text-slate-400">
                <span>{t('subtotalLabel')}: <span className="font-mono font-bold">{formatMoney(totals.subtotal, settings.currency)}</span></span>
                <span>{t('discountLabel')}: <span className="font-mono">{formatMoney(totals.discount, settings.currency)}</span></span>
                <span>{t('taxLabel')}: <span className="font-mono">{formatMoney(totals.tax, settings.currency)}</span></span>
                <span className="text-slate-800 dark:text-slate-100">{t('totalLabel')}: <span className="font-mono font-bold">{formatMoney(totals.total, settings.currency)}</span></span>
              </div>
            </div>
          </div>

          <div className="grid gap-3 lg:grid-cols-3">
            <div className="space-y-2 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
              <p className="text-xs font-bold text-slate-700 dark:text-slate-200">{t('priceSummary')}</p>
              <div className="space-y-1 text-[11px]">
                <p className="flex items-center justify-between">
                  <span className="flex items-center gap-1 text-rose-600"><ArrowUpRight size={13} /> {t('pricesWillIncrease')}</span>
                  <span className="font-bold">{priceSummary.increases.length}</span>
                </p>
                <p className="flex items-center justify-between">
                  <span className="flex items-center gap-1 text-emerald-600"><ArrowDownRight size={13} /> {t('pricesWillDecrease')}</span>
                  <span className="font-bold">{priceSummary.decreases.length}</span>
                </p>
                <p className="flex items-center justify-between">
                  <span className="flex items-center gap-1 text-slate-400"><Minus size={13} /> {t('pricesUnchanged')}</span>
                  <span className="font-bold">{priceSummary.unchanged.length}</span>
                </p>
                <p className="flex items-center justify-between border-t border-slate-100 pt-1 dark:border-slate-800">
                  <span className="flex items-center gap-1 text-brand-600"><Sparkles size={13} /> {t('newProductsLabel')}</span>
                  <span className="font-bold">{newProductsCount}</span>
                </p>
              </div>
              {applyPurchasePrices && staleCount > 0 && (
                <p className="flex items-start gap-1 rounded-lg border border-amber-200 bg-amber-50 p-2 text-[10px] leading-relaxed text-amber-700 dark:border-amber-900/40 dark:bg-amber-900/20 dark:text-amber-300">
                  <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                  <span>{t('stalePriceWarning')} ({staleCount})</span>
                </p>
              )}
              <label className="flex items-start gap-2 rounded-lg bg-slate-50 p-2 text-[11px] dark:bg-slate-800/60">
                <input
                  type="checkbox"
                  className="mt-0.5 h-3.5 w-3.5 rounded border-slate-300 text-brand-600"
                  checked={applyPurchasePrices}
                  onChange={(e) => setApplyPurchasePrices(e.target.checked)}
                />
                <span className="text-slate-500 dark:text-slate-400">{t('applyPurchasePrices')}</span>
              </label>
              <p className="text-[10px] leading-relaxed text-slate-400">{t('noStockFromScan')}</p>
            </div>

            <div className="flex flex-col justify-end gap-2 rounded-xl border border-slate-200 bg-white p-4 lg:col-span-2 dark:border-slate-800 dark:bg-slate-900">
              <div className="flex items-center gap-2 text-[11px] text-slate-400">
                <ImageIcon size={14} />
                {imageName || t('noImageYet')}
                {imageId && <Badge tone="green">{t('imageSaved')}</Badge>}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" onClick={() => setStage('upload')}>{t('backToImage')}</Button>
                <Button icon={<CheckCircle2 size={16} />} loading={saving} onClick={() => void checkBeforeSave()}>
                  {t('confirmInvoice')}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {stage === 'done' && doneInvoice && (
        <div className="rounded-xl border border-emerald-200 bg-white p-6 text-center dark:border-emerald-900/40 dark:bg-slate-900">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400">
            <CheckCircle2 size={26} />
          </div>
          <h2 className="mt-3 text-base font-bold text-slate-800 dark:text-white">{t('invoiceSaved')}</h2>
          <p className="mt-1 text-xs text-slate-400">
            {doneInvoice.supplierName || t('unknownSupplier')} · {doneInvoice.invoiceNumber || '—'} · {formatDate(doneInvoice.invoiceDate, lang)}
          </p>
          <div className="mx-auto mt-4 grid max-w-2xl grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCard title={t('itemsCount')} value={String(doneInvoice.items.filter((i) => i.matchState !== 'ignored').length)} icon={<FileText size={16} />} />
            <StatCard title={t('totalLabel')} amount={doneInvoice.total} icon={<ScanLine size={16} />} accent="emerald" />
            <StatCard title={t('pricesUpdated')} value={String(doneInvoice.priceUpdates.filter((p) => p.action === 'updated').length)} icon={<ArrowUpRight size={16} />} accent="amber" />
            <StatCard title={t('newProductsLabel')} value={String(doneInvoice.items.filter((i) => i.matchState === 'new').length)} icon={<Sparkles size={16} />} accent="violet" />
          </div>
          {staleSkippedCount > 0 && (
            <p className="mx-auto mt-3 max-w-xl rounded-lg border border-amber-200 bg-amber-50 p-3 text-[11px] leading-relaxed text-amber-700 dark:border-amber-900/40 dark:bg-amber-900/20 dark:text-amber-300">
              {t('stalePriceSkipped')} ({staleSkippedCount})
            </p>
          )}
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            <Link to="/invoice-library"><Button icon={<FileText size={16} />}>{t('openLibrary')}</Button></Link>
            <Button variant="secondary" icon={<Camera size={16} />} onClick={resetAll}>{t('scanAnother')}</Button>
          </div>
        </div>
      )}

      {/* تأكيد التكرار */}
      <Modal
        open={Boolean(duplicates)}
        onClose={() => setDuplicates(null)}
        title={t('duplicateInvoice')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setDuplicates(null)}>{t('cancel')}</Button>
            <Button variant="danger" loading={saving} onClick={() => void submit(true)}>{t('saveAnyway')}</Button>
          </>
        }
      >
        <p className="mb-3 text-xs leading-relaxed text-slate-500 dark:text-slate-400">{t('duplicateInvoiceMsg')}</p>
        <div className="space-y-2">
          {(duplicates ?? []).map((dup) => (
            <div key={dup.invoice.id} className="rounded-lg border border-amber-200 bg-amber-50 p-2 text-[11px] dark:border-amber-900/40 dark:bg-amber-900/20">
              <p className="font-bold text-amber-800 dark:text-amber-200">
                {dup.invoice.supplierName || t('unknownSupplier')} — {dup.invoice.invoiceNumber || '—'}
              </p>
              <p className="text-amber-700 dark:text-amber-300">
                {formatDate(dup.invoice.invoiceDate, lang)} · {formatMoney(dup.invoice.total, settings.currency)} · {t('scanDate')}: {formatDate(dup.invoice.scanDate, lang)}
              </p>
              <p className="mt-0.5 text-amber-600 dark:text-amber-400">
                {dup.reason === 'same_number' ? t('dupSameNumber') : dup.reason === 'same_fingerprint' ? t('dupSameFingerprint') : t('dupSameTotalDate')}
              </p>
            </div>
          ))}
        </div>
      </Modal>
    </div>
  );
}
