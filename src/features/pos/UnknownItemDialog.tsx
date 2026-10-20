import { useEffect, useMemo, useState } from 'react';
import { PackagePlus } from 'lucide-react';
import type { ProductCategory } from '../../types';
import { Modal } from '../../components/Modal';
import { Button } from '../../components/Button';
import { Input, Select } from '../../components/Form';
import { useI18n } from '../../i18n';
import { useApp } from '../../context/AppContext';
import { createCategory, suggestCategory } from '../../services/categories';
import { createProduct } from '../../services/products';
import { UNITS, normalizeUnit, unitLabel } from '../../utils/units';

export interface UnknownLine {
  name: string;
  unit: string;
  unitPrice: number;
  quantity: number;
}

interface Props {
  open: boolean;
  initialName: string;
  categories: ProductCategory[];
  currency: string;
  onClose: () => void;
  onAdd: (line: UnknownLine, savedToCatalogue: boolean) => void;
}

/**
 * بيع صنف غير مسجّل: يُسجَّل الاسم والسعر في الفاتورة فقط (لا مخزون)،
 * ويمكن اختياريًا إضافته إلى دليل الأصناف كمسودة بلا كميات — لا يُنشأ مخزون وهمي.
 */
export function UnknownItemDialog({ open, initialName, categories, currency, onClose, onAdd }: Props) {
  const { t } = useI18n();
  const { toast } = useApp();
  const [name, setName] = useState(initialName);
  const [category, setCategory] = useState('');
  const [newCategory, setNewCategory] = useState('');
  const [brand, setBrand] = useState('');
  const [size, setSize] = useState('');
  const [unit, setUnit] = useState('piece');
  const [price, setPrice] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [saveToCatalogue, setSaveToCatalogue] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(initialName);
    setBrand('');
    setSize('');
    setUnit('piece');
    setPrice('');
    setQuantity('1');
    setNewCategory('');
    setSaveToCatalogue(true);
    setCategory('');
    setSaving(false);
  }, [open, initialName]);

  const suggestion = useMemo(
    () => (name.trim() ? suggestCategory(name, categories) : { category: null, confidence: 0, reason: 'none' as const }),
    [name, categories],
  );
  const suggestedName = suggestion.category;

  const qty = Number(quantity);
  const unitPrice = Number(price);
  const valid = name.trim().length > 0 && qty > 0 && unitPrice >= 0 && price.trim() !== '';

  const submit = async () => {
    if (!valid || saving) return;
    setSaving(true);
    try {
      let finalCategory = category;
      if (saveToCatalogue) {
        if (newCategory.trim()) {
          const created = await createCategory(newCategory.trim());
          finalCategory = created.name;
        } else if (!finalCategory) {
          finalCategory = suggestedName ?? '';
        }
      }
      if (saveToCatalogue) {
        const sizeValue = Number(size.replace(',', '.'));
        await createProduct({
          name: name.trim(),
          code: '',
          barcode: '',
          category: finalCategory || 'منتجات أخرى',
          purchasePrice: 0,
          salePrice: unitPrice,
          quantity: 0,
          alertThreshold: 0,
          supplierId: null,
          description: '',
          unit: normalizeUnit(unit),
          saleUnit: normalizeUnit(unit),
          purchaseUnit: normalizeUnit(unit),
          unitsPerPurchase: null,
          brand: brand.trim(),
          aliases: [],
          sizeValue: Number.isFinite(sizeValue) && sizeValue > 0 ? sizeValue : null,
          sizeUnit: Number.isFinite(sizeValue) && sizeValue > 0 ? normalizeUnit(unit) : '',
          perishable: false,
          expiryDate: null,
          batchNumber: '',
          catalogDraft: true,
        });
        toast(t('saved'));
      }
      onAdd({ name: name.trim(), unit: normalizeUnit(unit), unitPrice, quantity: qty }, saveToCatalogue);
      onClose();
    } catch {
      toast(t('errGeneric'), 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('unknownItem')}
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button onClick={submit} disabled={!valid} loading={saving} icon={<PackagePlus size={16} />}>
            {t('quickSale')}
          </Button>
        </>
      }
    >
      <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-[11px] font-semibold text-amber-700 dark:bg-amber-950 dark:text-amber-400">
        {t('catalogueHint')}
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Input label={t('productName')} required value={name} onChange={(e) => setName(e.target.value)} />
        <Select label={t('category')} value={category} onChange={(e) => setCategory(e.target.value)} placeholder={t('selectCategory')}>
          {categories.map((c) => (
            <option key={c.id} value={c.name}>
              {c.name}
            </option>
          ))}
        </Select>
        <Input label={t('addNewCategory')} value={newCategory} onChange={(e) => setNewCategory(e.target.value)} />
        <Input label={t('brand')} value={brand} onChange={(e) => setBrand(e.target.value)} />
        <Input label={t('size')} value={size} onChange={(e) => setSize(e.target.value)} placeholder="500 / 1" inputMode="decimal" />
        <Select label={t('unitLabel')} value={unit} onChange={(e) => setUnit(e.target.value)}>
          {UNITS.map((u) => (
            <option key={u.code} value={u.code}>
              {unitLabel(u.code)}
            </option>
          ))}
        </Select>
        <Input
          label={`${t('salePrice')} (${currency})`}
          type="number"
          min="0"
          step="0.01"
          required
          value={price}
          onChange={(e) => setPrice(e.target.value)}
        />
        <Input
          label={t('quantityShort')}
          type="number"
          min="0.001"
          step="0.001"
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
        />
      </div>
      {suggestedName && suggestedName !== category && (
        <button
          type="button"
          onClick={() => setCategory(suggestedName)}
          className="mt-3 w-full rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 text-start text-[11px] font-semibold text-brand-700 dark:border-brand-900 dark:bg-brand-950 dark:text-brand-300"
        >
          {t('suggestedCategory')}: {suggestedName}
        </button>
      )}
      <label className="mt-3 flex items-center gap-2 text-xs font-semibold text-slate-600 dark:text-slate-300">
        <input
          type="checkbox"
          checked={saveToCatalogue}
          onChange={(e) => setSaveToCatalogue(e.target.checked)}
          className="h-4 w-4 rounded border-slate-300 text-brand-600"
        />
        {t('addToStockLater')}
      </label>
    </Modal>
  );
}
