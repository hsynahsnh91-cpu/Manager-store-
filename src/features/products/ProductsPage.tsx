import { useMemo, useState } from 'react';
import { Archive, ArchiveRestore, Boxes, PackageMinus, Pencil, Plus, Search } from 'lucide-react';
import type { Product, ProductCategory } from '../../types';
import {
  archiveProduct,
  createProduct,
  isLowStock,
  listProducts,
  updateProduct,
  type ProductInput,
} from '../../services/products';
import { listSuppliers } from '../../services/suppliers';
import { listCategories } from '../../services/categories';
import { searchProducts } from '../../services/productSearch';
import { writeOffStock, StockError } from '../../services/stock';
import { expiryInfo } from '../../services/expiry';
import { useAsync } from '../../hooks/useAsync';
import { useApp } from '../../context/AppContext';
import { useI18n } from '../../i18n';
import { Button } from '../../components/Button';
import { Input, Select, Textarea } from '../../components/Form';
import { ConfirmDialog, Modal } from '../../components/Modal';
import { Badge, EmptyState, SkeletonRows, StockBar } from '../../components/UI';
import { formatMoney, formatUnitPrice } from '../../utils/money';
import { UNITS, normalizeUnit, unitLabel } from '../../utils/units';
import type { Supplier } from '../../types';

interface FormState {
  name: string;
  shortName: string;
  brand: string;
  aliases: string;
  code: string;
  barcode: string;
  category: string;
  purchasePrice: string;
  salePrice: string;
  quantity: string;
  alertThreshold: string;
  supplierId: string;
  description: string;
  saleUnit: string;
  purchaseUnit: string;
  unitsPerPurchase: string;
  marginPercent: string;
  sizeValue: string;
  perishable: boolean;
  expiryDate: string;
  batchNumber: string;
  catalogueOnly: boolean;
}

const emptyForm: FormState = {
  name: '',
  shortName: '',
  brand: '',
  aliases: '',
  code: '',
  barcode: '',
  category: '',
  purchasePrice: '',
  salePrice: '',
  quantity: '0',
  alertThreshold: '5',
  supplierId: '',
  description: '',
  saleUnit: 'piece',
  purchaseUnit: 'piece',
  unitsPerPurchase: '',
  marginPercent: '',
  sizeValue: '',
  perishable: false,
  expiryDate: '',
  batchNumber: '',
  catalogueOnly: false,
};

function toDateInput(ts?: number | null): string {
  if (!ts) return '';
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function fromDateInput(value: string): number | null {
  if (!value) return null;
  const ts = new Date(`${value}T00:00:00`).getTime();
  return Number.isFinite(ts) ? ts : null;
}

export function ProductsPage() {
  const { t } = useI18n();
  const { settings, toast } = useApp();
  const { data, loading, reload } = useAsync(() => listProducts(), []);
  const { data: suppliers } = useAsync(() => listSuppliers() as Promise<Supplier[]>, []);
  const { data: categoryList } = useAsync(() => listCategories(), []);

  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [stockFilter, setStockFilter] = useState<'all' | 'low' | 'out' | 'expiring' | 'archived'>('all');
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [errors, setErrors] = useState<Partial<Record<keyof FormState, string>>>({});
  const [saving, setSaving] = useState(false);
  const [confirm, setConfirm] = useState<{ title: string; message: string; action: () => Promise<void> } | null>(null);
  const [writeOffProduct, setWriteOffProduct] = useState<Product | null>(null);
  const [woff, setWoff] = useState({ quantity: '1', kind: 'damage', reason: '' });
  const [woffError, setWoffError] = useState('');
  const [woffSaving, setWoffSaving] = useState(false);

  const products = data ?? [];

  const categories = useMemo(() => {
    const set = new Set<string>([
      ...(categoryList ?? []).map((c: ProductCategory) => c.name),
      ...products.map((p) => p.category).filter(Boolean),
    ]);
    return [...set].sort((a, b) => a.localeCompare(b, 'ar'));
  }, [products, categoryList]);

  const filtered = useMemo(() => {
    const q = search.trim();
    const bySearch = q ? searchProducts(products, q, { settings, includeArchived: stockFilter === 'archived', includeCatalogDrafts: true }) : null;
    const ids = bySearch ? new Set(bySearch.map((h) => h.product.id)) : null;
    const ordered = bySearch ? bySearch.map((h) => h.product) : products;
    return ordered.filter((p) => {
      if (stockFilter === 'archived') {
        if (!p.archived) return false;
      } else if (p.archived) {
        return false;
      }
      if (ids && !ids.has(p.id)) return false;
      if (stockFilter === 'low' && !isLowStock(p)) return false;
      if (stockFilter === 'out' && p.quantity > 0) return false;
      if (stockFilter === 'expiring') {
        const info = expiryInfo(p);
        if (info.daysLeft === null || info.daysLeft > (settings.expiryAlertDays ?? 30)) return false;
      }
      if (category && p.category !== category) return false;
      return true;
    });
  }, [products, search, category, stockFilter, settings]);

  const stats = useMemo(() => {
    const active = products.filter((p) => !p.archived && !p.catalogDraft);
    return {
      count: active.length,
      low: active.filter((p) => isLowStock(p)).length,
      value: active.reduce((acc, p) => acc + p.quantity * p.purchasePrice, 0),
      expiring: active.filter((p) => {
        const info = expiryInfo(p);
        return info.daysLeft !== null && info.daysLeft <= (settings.expiryAlertDays ?? 30) && p.quantity > 0;
      }).length,
    };
  }, [products, (settings.expiryAlertDays ?? 30)]);

  const openAdd = () => {
    setEditing(null);
    setForm({ ...emptyForm, alertThreshold: String(settings.lowStockDefault) });
    setErrors({});
    setFormOpen(true);
  };

  const openEdit = (p: Product) => {
    setEditing(p);
    setForm({
      name: p.name,
      shortName: p.shortName ?? '',
      brand: p.brand ?? '',
      aliases: (p.aliases ?? []).join(', '),
      code: p.code,
      barcode: p.barcode,
      category: p.category,
      purchasePrice: String(p.purchasePrice),
      salePrice: String(p.salePrice),
      quantity: String(p.quantity),
      alertThreshold: String(p.alertThreshold),
      supplierId: p.supplierId ?? '',
      description: p.description,
      saleUnit: normalizeUnit(p.saleUnit ?? p.unit ?? 'piece'),
      purchaseUnit: normalizeUnit(p.purchaseUnit ?? p.saleUnit ?? p.unit ?? 'piece'),
      unitsPerPurchase: p.unitsPerPurchase != null ? String(p.unitsPerPurchase) : '',
      marginPercent: p.marginPercent != null ? String(p.marginPercent) : '',
      sizeValue: p.sizeValue != null ? String(p.sizeValue) : '',
      perishable: p.perishable ?? false,
      expiryDate: toDateInput(p.expiryDate),
      batchNumber: p.batchNumber ?? '',
      catalogueOnly: p.catalogDraft ?? false,
    });
    setErrors({});
    setFormOpen(true);
  };

  const validate = (): boolean => {
    const e: typeof errors = {};
    if (!form.name.trim()) e.name = t('required');
    const sp = Number(form.purchasePrice);
    const sale = Number(form.salePrice);
    if (!form.catalogueOnly && (form.purchasePrice === '' || !Number.isFinite(sp) || sp < 0)) e.purchasePrice = t('required');
    if (!form.catalogueOnly && (form.salePrice === '' || !Number.isFinite(sale) || sale < 0)) e.salePrice = t('required');
    if (!Number.isFinite(Number(form.quantity)) || Number(form.quantity) < 0) e.quantity = t('required');
    if (!Number.isFinite(Number(form.alertThreshold)) || Number(form.alertThreshold) < 0) e.alertThreshold = t('required');
    if (form.unitsPerPurchase !== '' && (!Number.isFinite(Number(form.unitsPerPurchase)) || Number(form.unitsPerPurchase) <= 0)) {
      e.unitsPerPurchase = t('required');
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const submit = async () => {
    if (!validate()) return;
    setSaving(true);
    try {
      const purchaseUnit = normalizeUnit(form.purchaseUnit);
      const payload: ProductInput = {
        name: form.name.trim(),
        shortName: form.shortName.trim(),
        brand: form.brand.trim(),
        aliases: form.aliases
          .split(/[,،]/)
          .map((a) => a.trim())
          .filter(Boolean),
        code: form.code.trim(),
        barcode: form.barcode.trim(),
        category: form.category.trim(),
        purchasePrice: form.catalogueOnly ? 0 : Number(form.purchasePrice),
        salePrice: form.catalogueOnly ? 0 : Number(form.salePrice),
        quantity: form.catalogueOnly ? 0 : Number(form.quantity),
        catalogDraft: form.catalogueOnly,
        alertThreshold: Number(form.alertThreshold),
        supplierId: form.supplierId || null,
        description: form.description.trim(),
        unit: normalizeUnit(form.saleUnit),
        marginPercent: form.marginPercent !== '' && Number.isFinite(Number(form.marginPercent)) ? Number(form.marginPercent) : null,
        saleUnit: normalizeUnit(form.saleUnit),
        purchaseUnit,
        unitsPerPurchase:
          purchaseUnit !== normalizeUnit(form.saleUnit) && form.unitsPerPurchase !== ''
            ? Number(form.unitsPerPurchase)
            : null,
        sizeValue: form.sizeValue !== '' && Number.isFinite(Number(form.sizeValue)) ? Number(form.sizeValue) : null,
        sizeUnit: form.sizeValue !== '' ? normalizeUnit(form.saleUnit) : '',
        perishable: form.perishable,
        expiryDate: form.perishable || form.expiryDate ? fromDateInput(form.expiryDate) : null,
        batchNumber: form.batchNumber.trim(),
      };
      if (editing) {
        await updateProduct(editing.id, payload);
        toast(t('saved'));
      } else {
        await createProduct(payload);
        toast(t('saved'));
      }
      setFormOpen(false);
      reload();
    } catch {
      toast(t('error'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const askArchive = (p: Product) => {
    setConfirm({
      title: p.archived ? t('unarchive') : t('archive'),
      message: t('archiveConfirm'),
      action: async () => {
        await archiveProduct(p.id, !p.archived);
        toast(t('success'));
        reload();
      },
    });
  };

  const openWriteOff = (p: Product) => {
    setWriteOffProduct(p);
    setWoff({ quantity: '1', kind: 'damage', reason: '' });
    setWoffError('');
  };

  const submitWriteOff = async () => {
    if (!writeOffProduct || woffSaving) return;
    const qty = Number(woff.quantity);
    if (!Number.isFinite(qty) || qty <= 0) {
      setWoffError(t('required'));
      return;
    }
    setWoffSaving(true);
    setWoffError('');
    try {
      await writeOffStock({
        productId: writeOffProduct.id,
        quantity: qty,
        kind: woff.kind as 'damage' | 'expiry' | 'loss' | 'other',
        reason: woff.reason.trim(),
      });
      toast(t('writeOffDone'));
      setWriteOffProduct(null);
      reload();
    } catch (err) {
      if (err instanceof StockError && err.code === 'INSUFFICIENT_STOCK') setWoffError(t('insufficientStock'));
      else setWoffError(t('errGeneric'));
    } finally {
      setWoffSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-extrabold text-slate-800 dark:text-white">{t('productsTitle')}</h1>
          <p className="mt-0.5 text-xs text-slate-400">
            {stats.count} · {t('lowStock')}: {stats.low} · {t('stockValue')}: {formatMoney(stats.value, settings.currency)}
            {stats.expiring > 0 ? ` · ${t('expiryAlerts')}: ${stats.expiring}` : ''}
          </p>
        </div>
        <Button icon={<Plus size={16} />} onClick={openAdd}>
          {t('addProduct')}
        </Button>
      </div>

      {/* أدوات البحث والتصفية */}
      <div className="card flex flex-wrap items-center gap-2 p-3">
        <div className="min-w-[200px] flex-1">
          <Input
            placeholder={t('searchPlaceholder')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            icon={<Search size={15} />}
            aria-label={t('search')}
          />
        </div>
        <Select value={category} onChange={(e) => setCategory(e.target.value)} className="w-40" aria-label={t('category')}>
          <option value="">{t('category')}: {t('all')}</option>
          {categories.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </Select>
        <Select
          value={stockFilter}
          onChange={(e) => setStockFilter(e.target.value as typeof stockFilter)}
          className="w-44"
          aria-label={t('filter')}
        >
          <option value="all">{t('all')}</option>
          <option value="low">{t('lowStock')}</option>
          <option value="out">{t('outOfStock')}</option>
          <option value="expiring">{t('expiryAlerts')}</option>
          <option value="archived">{t('archivedOnly')}</option>
        </Select>
        {(search || category || stockFilter !== 'all') && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setSearch('');
              setCategory('');
              setStockFilter('all');
            }}
          >
            {t('reset')}
          </Button>
        )}
      </div>

      {/* الجدول */}
      <div className="card overflow-hidden">
        {loading ? (
          <SkeletonRows rows={7} cols={6} />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={<Boxes size={26} />}
            title={t('noData')}
            hint={t('emptyHint')}
            action={
              <Button size="sm" icon={<Plus size={15} />} onClick={openAdd}>
                {t('addProduct')}
              </Button>
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th>{t('productName')}</th>
                  <th>{t('category')}</th>
                  <th className="th-numeric">{t('purchasePrice')}</th>
                  <th className="th-numeric">{t('salePrice')}</th>
                  <th style={{ minWidth: 150 }}>{t('stock')}</th>
                  <th>{t('expiryDate')}</th>
                  <th className="text-end">{t('actions')}</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((p) => {
                  const info = expiryInfo(p);
                  const nearExpiry = info.daysLeft !== null && info.daysLeft <= (settings.expiryAlertDays ?? 30);
                  const unit = p.saleUnit ?? p.unit ?? '';
                  return (
                    <tr key={p.id} className={p.archived ? 'opacity-55' : ''}>
                      <td>
                        <div className="font-semibold text-slate-800 dark:text-slate-100">{p.name}</div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-400">
                          <span dir="ltr">{p.code}</span>
                          {p.barcode && <span dir="ltr">· {p.barcode}</span>}
                          {p.brand && <span>· {p.brand}</span>}
                          {unit && <span>· {unitLabel(unit)}</span>}
                          {p.catalogDraft && <Badge tone="amber">{t('catalogue')}</Badge>}
                          {p.archived && <Badge tone="slate">{t('archived')}</Badge>}
                        </div>
                      </td>
                      <td className="text-xs">{p.category || '—'}</td>
                      <td className="td-numeric">{formatUnitPrice(p.purchasePrice, settings.currency)}</td>
                      <td className="td-numeric font-semibold">{formatMoney(p.salePrice, settings.currency)}</td>
                      <td>
                        <div className="flex items-center justify-between gap-2 text-xs">
                          <span
                            className={`font-bold ${
                              p.quantity <= 0
                                ? 'text-rose-600'
                                : isLowStock(p)
                                  ? 'text-amber-600'
                                  : 'text-slate-700 dark:text-slate-200'
                            }`}
                          >
                            {p.quantity} {unit ? unitLabel(unit) : ''}
                          </span>
                          {isLowStock(p) && (
                            <Badge tone={p.quantity <= 0 ? 'rose' : 'amber'}>
                              {p.quantity <= 0 ? t('outOfStock') : t('lowStock')}
                            </Badge>
                          )}
                        </div>
                        <div className="mt-1.5">
                          <StockBar value={p.quantity} max={Math.max(p.alertThreshold * 4, p.quantity, 1)} />
                        </div>
                      </td>
                      <td className="text-[11px]">
                        {info.daysLeft === null ? (
                          <span className="text-slate-400">{t('noExpiry')}</span>
                        ) : nearExpiry ? (
                          <Badge tone={info.daysLeft < 0 ? 'rose' : 'amber'}>
                            {info.daysLeft < 0 ? t('expired') : `${info.daysLeft} ${t('daysLeft')}`}
                          </Badge>
                        ) : (
                          <span className="text-slate-400" dir="ltr">{toDateInput(p.expiryDate)}</span>
                        )}
                      </td>
                      <td>
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => openWriteOff(p)}
                            className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-slate-800"
                            title={t('writeOff')}
                          >
                            <PackageMinus size={15} />
                          </button>
                          <button
                            onClick={() => openEdit(p)}
                            className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-brand-50 hover:text-brand-600 dark:hover:bg-slate-800"
                            title={t('edit')}
                          >
                            <Pencil size={15} />
                          </button>
                          <button
                            onClick={() => askArchive(p)}
                            className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800"
                            title={p.archived ? t('unarchive') : t('archive')}
                          >
                            {p.archived ? <ArchiveRestore size={15} /> : <Archive size={15} />}
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

      {/* نموذج الإضافة/التعديل */}
      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editing ? t('editProduct') : t('addProduct')}
        size="lg"
        footer={
          <>
            <Button variant="secondary" onClick={() => setFormOpen(false)}>
              {t('cancel')}
            </Button>
            <Button onClick={submit} loading={saving}>
              {t('save')}
            </Button>
          </>
        }
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Input
            label={t('productName')}
            required
            value={form.name}
            error={errors.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="sm:col-span-2"
          />
          <Input
            label={t('shortName')}
            value={form.shortName}
            onChange={(e) => setForm({ ...form, shortName: e.target.value })}
          />
          <Input
            label={t('brand')}
            value={form.brand}
            onChange={(e) => setForm({ ...form, brand: e.target.value })}
          />
          <Input
            label={t('alternateNames')}
            value={form.aliases}
            onChange={(e) => setForm({ ...form, aliases: e.target.value })}
            hint={t('customSynonymsHint')}
            className="sm:col-span-2"
          />
          <Input
            label={t('productCode')}
            value={form.code}
            error={errors.code}
            onChange={(e) => setForm({ ...form, code: e.target.value })}
            dir="ltr"
            hint={t('optional')}
          />
          <Input
            label={t('barcode')}
            value={form.barcode}
            onChange={(e) => setForm({ ...form, barcode: e.target.value })}
            dir="ltr"
          />
          <Input
            label={t('category')}
            value={form.category}
            onChange={(e) => setForm({ ...form, category: e.target.value })}
            list="product-categories"
          />
          <datalist id="product-categories">
            {categories.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
          <Select
            label={t('supplier')}
            value={form.supplierId}
            onChange={(e) => setForm({ ...form, supplierId: e.target.value })}
            placeholder={t('none')}
          >
            {(suppliers ?? []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>

          <label className="sm:col-span-2 flex items-center gap-2 text-xs font-semibold text-slate-600 dark:text-slate-300">
            <input
              type="checkbox"
              checked={form.catalogueOnly}
              onChange={(e) => setForm({ ...form, catalogueOnly: e.target.checked })}
              className="h-4 w-4 rounded border-slate-300 text-brand-600"
            />
            {t('catalogueOnly')}
          </label>

          <Input
            label={t('purchasePrice')}
            required
            type="number"
            min="0"
            step="0.0001"
            value={form.purchasePrice}
            error={errors.purchasePrice}
            onChange={(e) => setForm({ ...form, purchasePrice: e.target.value })}
          />
          <Input
            label={t('salePrice')}
            required
            type="number"
            min="0"
            step="0.01"
            value={form.salePrice}
            error={errors.salePrice}
            onChange={(e) => setForm({ ...form, salePrice: e.target.value })}
          />
          <Input
            label={t('stock')}
            required
            type="number"
            min="0"
            step="0.001"
            value={form.quantity}
            error={errors.quantity}
            onChange={(e) => setForm({ ...form, quantity: e.target.value })}
          />
          <Input
            label={t('alertThreshold')}
            required
            type="number"
            min="0"
            step="1"
            value={form.alertThreshold}
            error={errors.alertThreshold}
            onChange={(e) => setForm({ ...form, alertThreshold: e.target.value })}
          />

          <div className="sm:col-span-2 mt-1 border-t border-dashed border-slate-200 pt-3 dark:border-slate-700">
            <p className="mb-2 text-xs font-bold text-slate-500 dark:text-slate-400">{t('unitLabel')}</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Select label={t('saleUnit')} value={form.saleUnit} onChange={(e) => setForm({ ...form, saleUnit: e.target.value })}>
                {UNITS.map((u) => (
                  <option key={u.code} value={u.code}>{unitLabel(u.code)}</option>
                ))}
              </Select>
              <Select
                label={t('purchaseUnit')}
                value={form.purchaseUnit}
                onChange={(e) => setForm({ ...form, purchaseUnit: e.target.value })}
              >
                {UNITS.map((u) => (
                  <option key={u.code} value={u.code}>{unitLabel(u.code)}</option>
                ))}
              </Select>
              <Input
                label={t('unitsPerPurchase')}
                type="number"
                min="1"
                step="1"
                value={form.unitsPerPurchase}
                error={errors.unitsPerPurchase}
                disabled={form.purchaseUnit === form.saleUnit}
                onChange={(e) => setForm({ ...form, unitsPerPurchase: e.target.value })}
                hint={t('unitsPerPurchaseHint')}
              />
              <Input
                label={t('size')}
                type="number"
                min="0"
                step="0.01"
                value={form.sizeValue}
                onChange={(e) => setForm({ ...form, sizeValue: e.target.value })}
              />
              <Input
                label={t('marginPercent')}
                type="number"
                min="0"
                step="1"
                value={form.marginPercent}
                onChange={(e) => setForm({ ...form, marginPercent: e.target.value })}
                hint={t('pricingHint')}
              />
            </div>
          </div>

          <div className="sm:col-span-2 rounded-lg border border-slate-200 p-3 dark:border-slate-700">
            <label className="flex items-center gap-2 text-xs font-semibold text-slate-600 dark:text-slate-300">
              <input
                type="checkbox"
                checked={form.perishable}
                onChange={(e) => setForm({ ...form, perishable: e.target.checked })}
                className="h-4 w-4 rounded border-slate-300 text-brand-600"
              />
              {t('perishable')}
            </label>
            {(form.perishable || form.expiryDate) && (
              <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Input
                  label={t('expiryDate')}
                  type="date"
                  value={form.expiryDate}
                  onChange={(e) => setForm({ ...form, expiryDate: e.target.value })}
                />
                <Input
                  label={t('batchNumber')}
                  value={form.batchNumber}
                  onChange={(e) => setForm({ ...form, batchNumber: e.target.value })}
                />
              </div>
            )}
          </div>

          <Textarea
            label={t('description')}
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            className="sm:col-span-2"
          />
        </div>
      </Modal>

      {/* إتلاف بضاعة */}
      <Modal
        open={!!writeOffProduct}
        onClose={() => setWriteOffProduct(null)}
        title={t('writeOff')}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setWriteOffProduct(null)}>
              {t('cancel')}
            </Button>
            <Button variant="danger" onClick={submitWriteOff} loading={woffSaving}>
              {t('confirm')}
            </Button>
          </>
        }
      >
        <p className="mb-3 text-sm font-semibold text-slate-700 dark:text-slate-200">{writeOffProduct?.name}</p>
        <div className="space-y-3">
          <Input
            label={t('writeOffQty')}
            type="number"
            min="0.001"
            step="0.001"
            value={woff.quantity}
            error={woffError}
            onChange={(e) => setWoff({ ...woff, quantity: e.target.value })}
          />
          <Select label={t('writeOffReason')} value={woff.kind} onChange={(e) => setWoff({ ...woff, kind: e.target.value })}>
            <option value="damage">{t('writeOff')}</option>
            <option value="expiry">{t('expired')}</option>
            <option value="loss">{t('lost')}</option>
            <option value="other">{t('other')}</option>
          </Select>
          <Input label={t('notes')} value={woff.reason} onChange={(e) => setWoff({ ...woff, reason: e.target.value })} />
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-[11px] text-amber-700 dark:bg-amber-950 dark:text-amber-400">
            {t('inventoryNotProfit')}
          </p>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!confirm}
        title={confirm?.title ?? ''}
        message={confirm?.message ?? ''}
        danger
        onCancel={() => setConfirm(null)}
        onConfirm={async () => {
          if (!confirm) return;
          try {
            await confirm.action();
          } catch {
            toast(t('error'), 'error');
          }
          setConfirm(null);
        }}
      />
    </div>
  );
}
