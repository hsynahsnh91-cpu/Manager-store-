import { useMemo, useState } from 'react';
import { Archive, ArchiveRestore, Boxes, Pencil, Plus, Search } from 'lucide-react';
import type { Product } from '../../types';
import {
  archiveProduct,
  createProduct,
  isLowStock,
  listProducts,
  updateProduct,
  type ProductInput,
} from '../../services/products';
import { listSuppliers } from '../../services/suppliers';
import { useAsync } from '../../hooks/useAsync';
import { useApp } from '../../context/AppContext';
import { useI18n } from '../../i18n';
import { Button } from '../../components/Button';
import { Input, Select, Textarea } from '../../components/Form';
import { ConfirmDialog, Modal } from '../../components/Modal';
import { Badge, EmptyState, SkeletonRows, StockBar } from '../../components/UI';
import { formatMoney } from '../../utils/money';
import type { Supplier } from '../../types';

interface FormState {
  name: string;
  code: string;
  barcode: string;
  category: string;
  purchasePrice: string;
  salePrice: string;
  quantity: string;
  alertThreshold: string;
  supplierId: string;
  description: string;
}

const emptyForm: FormState = {
  name: '',
  code: '',
  barcode: '',
  category: '',
  purchasePrice: '',
  salePrice: '',
  quantity: '0',
  alertThreshold: '5',
  supplierId: '',
  description: '',
};

export function ProductsPage() {
  const { t } = useI18n();
  const { settings, toast } = useApp();
  const { data, loading, reload } = useAsync(() => listProducts(), []);
  const { data: suppliers } = useAsync(() => listSuppliers() as Promise<Supplier[]>, []);

  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [stockFilter, setStockFilter] = useState<'all' | 'low' | 'out' | 'archived'>('all');
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [errors, setErrors] = useState<Partial<Record<keyof FormState, string>>>({});
  const [saving, setSaving] = useState(false);
  const [confirm, setConfirm] = useState<{ title: string; message: string; action: () => Promise<void> } | null>(null);

  const products = data ?? [];

  const categories = useMemo(() => {
    const set = new Set(products.map((p) => p.category).filter(Boolean));
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [products]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products.filter((p) => {
      if (stockFilter === 'archived') {
        if (!p.archived) return false;
      } else if (p.archived) {
        return false;
      }
      if (stockFilter === 'low' && !isLowStock(p)) return false;
      if (stockFilter === 'out' && p.quantity > 0) return false;
      if (category && p.category !== category) return false;
      if (q) {
        const hay = `${p.name} ${p.code} ${p.barcode}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [products, search, category, stockFilter]);

  const stats = useMemo(() => {
    const active = products.filter((p) => !p.archived);
    return {
      count: active.length,
      low: active.filter((p) => isLowStock(p)).length,
      value: active.reduce((acc, p) => acc + p.quantity * p.purchasePrice, 0),
    };
  }, [products]);

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
      code: p.code,
      barcode: p.barcode,
      category: p.category,
      purchasePrice: String(p.purchasePrice),
      salePrice: String(p.salePrice),
      quantity: String(p.quantity),
      alertThreshold: String(p.alertThreshold),
      supplierId: p.supplierId ?? '',
      description: p.description,
    });
    setErrors({});
    setFormOpen(true);
  };

  const validate = (): boolean => {
    const e: typeof errors = {};
    if (!form.name.trim()) e.name = t('required');
    if (!form.code.trim()) e.code = t('required');
    const sp = Number(form.purchasePrice);
    const sale = Number(form.salePrice);
    if (form.purchasePrice === '' || !Number.isFinite(sp) || sp < 0) e.purchasePrice = t('required');
    if (form.salePrice === '' || !Number.isFinite(sale) || sale < 0) e.salePrice = t('required');
    if (!Number.isFinite(Number(form.quantity)) || Number(form.quantity) < 0) e.quantity = t('required');
    if (!Number.isFinite(Number(form.alertThreshold)) || Number(form.alertThreshold) < 0) e.alertThreshold = t('required');
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const submit = async () => {
    if (!validate()) return;
    setSaving(true);
    try {
      const payload: ProductInput = {
        name: form.name.trim(),
        code: form.code.trim(),
        barcode: form.barcode.trim(),
        category: form.category.trim(),
        purchasePrice: Number(form.purchasePrice),
        salePrice: Number(form.salePrice),
        quantity: Number(form.quantity),
        alertThreshold: Number(form.alertThreshold),
        supplierId: form.supplierId || null,
        description: form.description.trim(),
      };
      if (editing) {
        await updateProduct(editing.id, payload);
        toast(t('success'));
      } else {
        await createProduct(payload);
        toast(t('success'));
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

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-extrabold text-slate-800 dark:text-white">{t('productsTitle')}</h1>
          <p className="mt-0.5 text-xs text-slate-400">
            {stats.count} · {t('lowStock')}: {stats.low} · {t('stockValue')}: {formatMoney(stats.value, settings.currency)}
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
            placeholder={t('searchProducts')}
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
          className="w-40"
          aria-label={t('filter')}
        >
          <option value="all">{t('all')}</option>
          <option value="low">{t('lowStock')}</option>
          <option value="out">{t('outOfStock')}</option>
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
                  <th style={{ minWidth: 140 }}>{t('stock')}</th>
                  <th className="text-end">{t('actions')}</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((p) => (
                  <tr key={p.id} className={p.archived ? 'opacity-55' : ''}>
                    <td>
                      <div className="font-semibold text-slate-800 dark:text-slate-100">{p.name}</div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-400">
                        <span dir="ltr">{p.code}</span>
                        {p.barcode && <span dir="ltr">· {p.barcode}</span>}
                        {p.archived && <Badge tone="slate">{t('archived')}</Badge>}
                      </div>
                    </td>
                    <td className="text-xs">{p.category || '—'}</td>
                    <td className="td-numeric">{formatMoney(p.purchasePrice)}</td>
                    <td className="td-numeric font-semibold">{formatMoney(p.salePrice)}</td>
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
                          {p.quantity}
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
                    <td>
                      <div className="flex items-center justify-end gap-1">
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
                ))}
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
            label={t('productCode')}
            required
            value={form.code}
            error={errors.code}
            onChange={(e) => setForm({ ...form, code: e.target.value })}
            dir="ltr"
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
          <Input
            label={t('purchasePrice')}
            required
            type="number"
            min="0"
            step="0.01"
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
            step="1"
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
          <Textarea
            label={t('description')}
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            className="sm:col-span-2"
          />
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
