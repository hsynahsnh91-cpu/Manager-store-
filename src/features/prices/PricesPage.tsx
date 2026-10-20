import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  ArrowDownRight,
  ArrowUpRight,
  Camera,
  Download,
  History,
  Minus,
  Pencil,
  Plus,
  Search,
  Tags,
  Trash2,
  TrendingUp,
} from 'lucide-react';
import type { PriceChange, Product, ProductCategory, ScannedInvoice } from '../../types';
import { useAsync } from '../../hooks/useAsync';
import { useApp } from '../../context/AppContext';
import { useI18n } from '../../i18n';
import { Button } from '../../components/Button';
import { Input, Select } from '../../components/Form';
import { ConfirmDialog, Modal } from '../../components/Modal';
import { Badge, EmptyState, SkeletonRows } from '../../components/UI';
import { formatDate } from '../../utils/dates';
import { formatMoney, round2 } from '../../utils/money';
import { normalizeArabic } from '../../utils/text';
import { downloadCSV } from '../../utils/csv';
import { listProducts } from '../../services/products';
import {
  createCategory,
  deleteCategory,
  listCategories,
  updateCategory,
  countProductsByCategory,
} from '../../services/categories';
import { getPriceHistory, marginPercent, pricingSettings, setProductPrice, suggestSalePrice } from '../../services/prices';
import { listScannedInvoices, invoicesForProduct } from '../../services/scannedInvoices';
import { listSuppliers } from '../../services/suppliers';
import { logAudit } from '../../services/audit';

interface PriceEditor {
  product: Product;
  purchase: string;
  sale: string;
}

export function PricesPage() {
  const { t, lang } = useI18n();
  const { settings, toast } = useApp();
  const pricing = pricingSettings(settings);
  const { data: productData, loading, reload } = useAsync(() => listProducts(), []);
  const { data: categoryData, reload: reloadCategories } = useAsync(() => listCategories(), []);
  const { data: invoiceData } = useAsync(() => listScannedInvoices(), []);
  const { data: historyData, reload: reloadHistory } = useAsync(async () => {
    const { listPriceHistory } = await import('../../services/prices');
    return listPriceHistory();
  }, []);

  const { data: supplierData } = useAsync(() => listSuppliers(), []);
  const products = useMemo(() => productData ?? [], [productData]);
  const supplierName = useMemo(() => {
    const map = new Map((supplierData ?? []).map((s) => [s.id, s.name]));
    return (id: string | null | undefined) => (id ? map.get(id) ?? '' : '');
  }, [supplierData]);
  const categories = useMemo(() => categoryData ?? [], [categoryData]);
  const invoices = useMemo(() => invoiceData ?? [], [invoiceData]);
  const history = useMemo(() => historyData ?? [], [historyData]);

  const location = useLocation();
  const [q, setQ] = useState(() => new URLSearchParams(location.search).get('q') ?? '');
  useEffect(() => {
    const next = new URLSearchParams(location.search).get('q');
    if (next !== null) setQ(next);
  }, [location.search]);
  const [category, setCategory] = useState('');
  const [editor, setEditor] = useState<PriceEditor | null>(null);
  const [saving, setSaving] = useState(false);
  const [historyProduct, setHistoryProduct] = useState<Product | null>(null);
  const [historyRows, setHistoryRows] = useState<PriceChange[]>([]);

  const [newCategory, setNewCategory] = useState('');
  const [editingCategory, setEditingCategory] = useState<ProductCategory | null>(null);
  const [categoryName, setCategoryName] = useState('');
  const [deleteCategoryTarget, setDeleteCategoryTarget] = useState<ProductCategory | null>(null);
  const [categorySaving, setCategorySaving] = useState(false);

  const lastChangeByProduct = useMemo(() => {
    const map = new Map<string, PriceChange>();
    for (const change of [...history].sort((a, b) => b.date - a.date)) {
      const key = `${change.productId}:${change.field}`;
      if (!map.has(key)) map.set(key, change);
    }
    return map;
  }, [history]);

  const filtered = useMemo(() => {
    const needle = normalizeArabic(q);
    return products
      .filter((p) => !p.archived)
      .filter((p) => (category ? p.category === category : true))
      .filter((p) =>
        needle
          ? normalizeArabic(`${p.name} ${p.code} ${p.barcode} ${p.category}`).includes(needle)
          : true,
      )
      .sort((a, b) => a.name.localeCompare(b.name, 'ar'));
  }, [products, q, category]);

  const counts = useMemo(() => countProductsByCategory(products.filter((p) => !p.archived)), [products]);

  const openEditor = (product: Product) => {
    setEditor({ product, purchase: String(product.purchasePrice), sale: String(product.salePrice) });
  };

  const applySuggested = () => {
    if (!editor) return;
    const suggested = suggestSalePrice(round2(Number(editor.purchase)), {
      marginPercent: pricing.margin,
      roundTo: pricing.roundTo,
    });
    if (suggested !== null) setEditor({ ...editor, sale: String(suggested) });
  };

  const savePrices = async () => {
    if (!editor) return;
    const purchase = round2(Number(editor.purchase));
    const sale = round2(Number(editor.sale));
    if (!(purchase > 0) || !(sale > 0)) {
      toast(t('invalidNumber'), 'error');
      return;
    }
    setSaving(true);
    try {
      const p1 = await setProductPrice(editor.product.id, 'purchase', purchase, {
        source: 'manual',
        sourceLabel: t('priceHistoryLabel'),
      });
      const p2 = await setProductPrice(editor.product.id, 'sale', sale, {
        source: 'manual',
        sourceLabel: t('priceHistoryLabel'),
      });
      if (p1.changed || p2.changed) {
        await logAudit({
          action: 'price_update',
          entity: 'product',
          entityId: editor.product.id,
          summary: `${t('priceUpdated')} — ${editor.product.name}`,
          before: `${editor.product.purchasePrice} / ${editor.product.salePrice}`,
          after: `${purchase} / ${sale}`,
        });
        toast(t('priceUpdated'));
      } else {
        toast(t('success'));
      }
      setEditor(null);
      reload();
      reloadHistory();
    } catch {
      toast(t('error'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const openHistory = async (product: Product) => {
    setHistoryProduct(product);
    setHistoryRows(await getPriceHistory(product.id));
  };

  const addCategory = async () => {
    if (!newCategory.trim()) return;
    setCategorySaving(true);
    try {
      const created = await createCategory(newCategory);
      await logAudit({
        action: 'category_create',
        entity: 'category',
        entityId: created.id,
        summary: `${t('categorySaved')}: ${created.name}`,
        before: '',
        after: created.name,
      });
      setNewCategory('');
      reloadCategories();
      toast(t('categorySaved'));
    } catch {
      toast(t('error'), 'error');
    } finally {
      setCategorySaving(false);
    }
  };

  const saveCategoryRename = async () => {
    if (!editingCategory) return;
    setCategorySaving(true);
    try {
      const before = editingCategory.name;
      await updateCategory(editingCategory.id, { name: categoryName });
      await logAudit({
        action: 'category_update',
        entity: 'category',
        entityId: editingCategory.id,
        summary: `${t('editCategory')}: ${before} → ${categoryName}`,
        before,
        after: categoryName,
      });
      setEditingCategory(null);
      reloadCategories();
      reload();
      toast(t('success'));
    } catch {
      toast(t('error'), 'error');
    } finally {
      setCategorySaving(false);
    }
  };

  const removeCategory = async () => {
    if (!deleteCategoryTarget) return;
    setCategorySaving(true);
    try {
      await deleteCategory(deleteCategoryTarget.id);
      await logAudit({
        action: 'category_delete',
        entity: 'category',
        entityId: deleteCategoryTarget.id,
        summary: `${t('deleteCategory')}: ${deleteCategoryTarget.name}`,
        before: deleteCategoryTarget.name,
        after: '',
      });
      setDeleteCategoryTarget(null);
      reloadCategories();
      reload();
      toast(t('success'));
    } catch {
      toast(t('error'), 'error');
    } finally {
      setCategorySaving(false);
    }
  };

  const invoicesFor = (product: Product): ScannedInvoice[] => invoicesForProduct(invoices, product.id, product.name);

  const exportPrices = () => {
    const stamp = new Date().toISOString().slice(0, 10);
    downloadCSV(
      `prices-${stamp}`,
      [t('productName'), t('productCode'), t('barcode'), t('category'), t('supplier'), t('purchasePrice'), t('salePrice'), t('lastUpdate')],
      filtered.map((product) => [
        product.name,
        product.code,
        product.barcode,
        product.category,
        supplierName(product.supplierId ?? product.lastSupplierId),
        product.purchasePrice,
        product.salePrice,
        product.purchasePriceUpdatedAt ? formatDate(product.purchasePriceUpdatedAt, lang) : '',
      ]),
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-extrabold text-slate-800 dark:text-white">{t('pricesTitle')}</h1>
          <p className="mt-0.5 text-xs text-slate-400">{t('pricesSubtitle')}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="ghost" icon={<Download size={15} />} onClick={exportPrices}>
            {t('exportCsv')}
          </Button>
          <Link to="/scan">
            <Button size="sm" variant="secondary" icon={<Camera size={15} />}>{t('scanInvoice')}</Button>
          </Link>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-wrap gap-2">
          <div className="min-w-[240px] flex-1">
            <Input
              icon={<Search size={15} />}
              placeholder={t('productSearchHint')}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              aria-label={t('search')}
            />
          </div>
          <Select value={category} onChange={(e) => setCategory(e.target.value)} className="w-48">
            <option value="">{t('all')}</option>
            {categories.map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}
          </Select>
        </div>
        <p className="mt-2 text-[11px] text-slate-400">{t('resultsCount')}: {filtered.length}</p>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        {loading ? (
          <div className="p-4"><SkeletonRows rows={6} cols={5} /></div>
        ) : filtered.length === 0 ? (
          <EmptyState icon={<Tags size={26} />} title={t('noProductsFound')} hint={t('emptyHint')} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-xs">
              <thead className="bg-slate-50 text-[10px] uppercase text-slate-400 dark:bg-slate-800/50">
                <tr>
                  <th className="px-3 py-2 text-start">{t('productName')}</th>
                  <th className="px-3 py-2 text-start">{t('category')}</th>
                  <th className="px-3 py-2 text-start">{t('currentPurchasePrice')}</th>
                  <th className="px-3 py-2 text-start">{t('currentSalePrice')}</th>
                  <th className="px-3 py-2 text-start">{t('lastUpdate')}</th>
                  <th className="px-3 py-2 text-start">{t('actions')}</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((product) => {
                  const purchaseChange = lastChangeByProduct.get(`${product.id}:purchase`);
                  const saleChange = lastChangeByProduct.get(`${product.id}:sale`);
                  const margin = marginPercent(product.purchasePrice, product.salePrice);
                  return (
                    <tr key={product.id} className="border-t border-slate-100 hover:bg-slate-50/60 dark:border-slate-800 dark:hover:bg-slate-800/40">
                      <td className="px-3 py-2">
                        <p className="font-bold text-slate-800 dark:text-slate-100">{product.name}</p>
                        <p className="text-[10px] text-slate-400">
                          {product.code || product.barcode || '—'}
                          {product.unit && ` · ${product.unit}`}
                          {' · '}{t('inStock')}: {product.quantity}
                        </p>
                        {supplierName(product.supplierId ?? product.lastSupplierId) && (
                          <p className="text-[10px] text-slate-400">
                            {t('supplier')}: {supplierName(product.supplierId ?? product.lastSupplierId)}
                          </p>
                        )}
                      </td>
                      <td className="px-3 py-2 text-slate-500 dark:text-slate-400">{product.category || '—'}</td>
                      <td className="px-3 py-2">
                        <p className="font-mono font-bold text-slate-800 dark:text-slate-100">{formatMoney(product.purchasePrice, settings.currency)}</p>
                        {purchaseChange && (
                          <p className={`flex items-center gap-0.5 text-[10px] ${purchaseChange.newPrice > purchaseChange.oldPrice ? 'text-rose-600' : 'text-emerald-600'}`}>
                            {purchaseChange.newPrice > purchaseChange.oldPrice ? <ArrowUpRight size={11} /> : <ArrowDownRight size={11} />}
                            {formatMoney(purchaseChange.newPrice, settings.currency)}
                          </p>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <p className="font-mono font-bold text-slate-800 dark:text-slate-100">{formatMoney(product.salePrice, settings.currency)}</p>
                        <p className="text-[10px] text-slate-400">{margin === null ? '—' : `${margin}%`}</p>
                      </td>
                      <td className="px-3 py-2">
                        <p className="text-[11px] text-slate-500 dark:text-slate-400">
                          {product.purchasePriceUpdatedAt ? formatDate(product.purchasePriceUpdatedAt, lang) : '—'}
                        </p>
                        <p className="truncate text-[10px] text-slate-400" title={purchaseChange?.sourceLabel ?? saleChange?.sourceLabel ?? ''}>
                          {purchaseChange?.sourceLabel || saleChange?.sourceLabel || (purchaseChange || saleChange ? t('priceHistoryLabel') : '')}
                        </p>
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => openEditor(product)}
                            className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-brand-600 dark:hover:bg-slate-800"
                            aria-label={t('edit')}
                          >
                            <Pencil size={14} />
                          </button>
                          <button
                            type="button"
                            onClick={() => void openHistory(product)}
                            className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-brand-600 dark:hover:bg-slate-800"
                            aria-label={t('changeHistory')}
                          >
                            <History size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* إدارة التصنيفات */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="flex items-center gap-2 text-sm font-bold text-slate-700 dark:text-slate-200">
              <Tags size={16} /> {t('manageCategories')}
            </h2>
            <p className="mt-0.5 text-[11px] text-slate-400">{t('categoriesSubtitle')}</p>
          </div>
          <div className="flex gap-2">
            <Input
              value={newCategory}
              onChange={(e) => setNewCategory(e.target.value)}
              placeholder={t('categoryName')}
              className="h-9 w-40 text-xs"
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void addCategory();
                }
              }}
            />
            <Button size="sm" icon={<Plus size={14} />} loading={categorySaving} onClick={() => void addCategory()}>
              {t('add')}
            </Button>
          </div>
        </div>
        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {categories.map((cat) => (
            <div key={cat.id} className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700">
              <div className="min-w-0">
                <p className="truncate text-xs font-bold text-slate-700 dark:text-slate-200">{cat.name}</p>
                <p className="text-[10px] text-slate-400">
                  {counts.get(cat.name) ?? 0} {t('productsInCategory')} {cat.isDefault && `· ${t('defaultCategory')}`}
                </p>
              </div>
              <div className="flex shrink-0 gap-1">
                <button
                  type="button"
                  onClick={() => { setEditingCategory(cat); setCategoryName(cat.name); }}
                  className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-brand-600 dark:hover:bg-slate-800"
                  aria-label={t('editCategory')}
                >
                  <Pencil size={13} />
                </button>
                <button
                  type="button"
                  onClick={() => setDeleteCategoryTarget(cat)}
                  className="rounded p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-900/20"
                  aria-label={t('deleteCategory')}
                >
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* تعديل الأسعار */}
      <Modal
        open={Boolean(editor)}
        onClose={() => setEditor(null)}
        title={t('priceEdit')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditor(null)}>{t('cancel')}</Button>
            <Button loading={saving} onClick={() => void savePrices()}>{t('save')}</Button>
          </>
        }
      >
        {editor && (
          <div className="space-y-3">
            <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm font-bold text-slate-700 dark:bg-slate-800 dark:text-slate-200">
              {editor.product.name}
            </p>
            <Input
              type="number"
              step="0.01"
              label={t('newPurchasePrice')}
              value={editor.purchase}
              onChange={(e) => setEditor({ ...editor, purchase: e.target.value })}
            />
            <Input
              type="number"
              step="0.01"
              label={t('newSalePriceLabel')}
              value={editor.sale}
              onChange={(e) => setEditor({ ...editor, sale: e.target.value })}
            />
            <div className="flex items-center justify-between rounded-lg border border-dashed border-slate-300 px-3 py-2 dark:border-slate-600">
              <div className="text-[11px] text-slate-500 dark:text-slate-400">
                <p className="font-semibold">{t('suggestedSale')} ({pricing.margin}%)</p>
                <p className="font-mono text-slate-700 dark:text-slate-200">
                  {formatMoney(
                    suggestSalePrice(round2(Number(editor.purchase)), { marginPercent: pricing.margin, roundTo: pricing.roundTo }) ?? 0,
                    settings.currency,
                  )}
                </p>
              </div>
              <Button size="sm" variant="secondary" icon={<TrendingUp size={14} />} onClick={applySuggested}>
                {t('applySuggested')}
              </Button>
            </div>
            <p className="text-[10px] text-slate-400">{t('pricingHint')}</p>
          </div>
        )}
      </Modal>

      {/* سجل الأسعار والفواتير */}
      <Modal
        open={Boolean(historyProduct)}
        onClose={() => setHistoryProduct(null)}
        title={`${t('changeHistory')} — ${historyProduct?.name ?? ''}`}
        size="lg"
        footer={<Button variant="secondary" onClick={() => setHistoryProduct(null)}>{t('close')}</Button>}
      >
        {historyProduct && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="rounded-lg bg-slate-50 px-3 py-2 dark:bg-slate-800">
                <p className="text-[10px] text-slate-400">{t('currentPurchasePrice')}</p>
                <p className="font-mono font-bold text-slate-800 dark:text-slate-100">{formatMoney(historyProduct.purchasePrice, settings.currency)}</p>
              </div>
              <div className="rounded-lg bg-slate-50 px-3 py-2 dark:bg-slate-800">
                <p className="text-[10px] text-slate-400">{t('currentSalePrice')}</p>
                <p className="font-mono font-bold text-slate-800 dark:text-slate-100">{formatMoney(historyProduct.salePrice, settings.currency)}</p>
              </div>
            </div>

            <div>
              <p className="mb-1.5 text-xs font-bold text-slate-700 dark:text-slate-200">{t('changeHistory')}</p>
              {historyRows.length === 0 ? (
                <p className="text-[11px] text-slate-400">{t('noPriceHistory')}</p>
              ) : (
                <div className="space-y-1">
                  {historyRows.map((row) => (
                    <div key={row.id} className="flex flex-wrap items-center justify-between gap-2 rounded border border-slate-100 px-2 py-1.5 text-[11px] dark:border-slate-700">
                      <div className="min-w-0">
                        <p className="font-semibold text-slate-600 dark:text-slate-300">
                          {row.field === 'purchase' ? t('wholesalePrice') : t('currentSalePrice')}
                        </p>
                        <p className="truncate text-[10px] text-slate-400">{row.sourceLabel || '—'} · {formatDate(row.date, lang)}</p>
                      </div>
                      <span className={`flex items-center gap-1 font-mono ${row.newPrice > row.oldPrice ? 'text-rose-600' : row.newPrice < row.oldPrice ? 'text-emerald-600' : 'text-slate-400'}`}>
                        {row.newPrice > row.oldPrice ? <ArrowUpRight size={12} /> : row.newPrice < row.oldPrice ? <ArrowDownRight size={12} /> : <Minus size={12} />}
                        {formatMoney(row.oldPrice, settings.currency)} → {formatMoney(row.newPrice, settings.currency)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div>
              <p className="mb-1.5 text-xs font-bold text-slate-700 dark:text-slate-200">{t('invoicesAppeared')}</p>
              {invoicesFor(historyProduct).length === 0 ? (
                <p className="text-[11px] text-slate-400">{t('noInvoicesForProduct')}</p>
              ) : (
                <div className="space-y-1">
                  {invoicesFor(historyProduct).map((inv) => (
                    <div key={inv.id} className="flex items-center justify-between gap-2 rounded border border-slate-100 px-2 py-1.5 text-[11px] dark:border-slate-700">
                      <div>
                        <p className="font-semibold text-slate-600 dark:text-slate-300">{inv.supplierName || t('unknownSupplier')} {inv.invoiceNumber && `#${inv.invoiceNumber}`}</p>
                        <p className="text-[10px] text-slate-400">{formatDate(inv.invoiceDate, lang)}</p>
                      </div>
                      <Badge tone="blue">{formatMoney(inv.total, settings.currency)}</Badge>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </Modal>

      {/* إعادة تسمية تصنيف */}
      <Modal
        open={Boolean(editingCategory)}
        onClose={() => setEditingCategory(null)}
        title={t('editCategory')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditingCategory(null)}>{t('cancel')}</Button>
            <Button loading={categorySaving} onClick={() => void saveCategoryRename()}>{t('saveCategory')}</Button>
          </>
        }
      >
        <Input label={t('categoryName')} value={categoryName} onChange={(e) => setCategoryName(e.target.value)} />
        <p className="mt-2 text-[11px] text-slate-400">{t('deleteCategoryMsg')}</p>
      </Modal>

      <ConfirmDialog
        open={Boolean(deleteCategoryTarget)}
        title={t('deleteCategory')}
        message={`${t('deleteCategoryMsg')} (${deleteCategoryTarget?.name ?? ''})`}
        confirmLabel={t('delete')}
        danger
        loading={categorySaving}
        onConfirm={() => void removeCategory()}
        onCancel={() => setDeleteCategoryTarget(null)}
      />
    </div>
  );
}
