import { useMemo, useState } from 'react';
import { Plus, Search, Tags } from 'lucide-react';
import type { ProductCategory } from '../../types';
import { createCategory } from '../../services/categories';
import { useApp } from '../../context/AppContext';
import { useI18n } from '../../i18n';
import { Modal } from '../../components/Modal';
import { Button } from '../../components/Button';
import { Input } from '../../components/Form';
import { normalizeArabic } from '../../utils/text';

interface Props {
  open: boolean;
  categories: ProductCategory[];
  value: string;
  onClose: () => void;
  onSelect: (name: string) => void;
  onCreated?: () => void;
}

/** نافذة «اختر تصنيف المنتج» — بحث + إنشاء تصنيف جديد مع منع التكرار */
export function CategoryPicker({ open, categories, value, onClose, onSelect, onCreated }: Props) {
  const { t } = useI18n();
  const { toast } = useApp();
  const [query, setQuery] = useState('');
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);

  const filtered = useMemo(() => {
    const q = normalizeArabic(query);
    if (!q) return categories;
    return categories.filter((c) => normalizeArabic(c.name).includes(q));
  }, [categories, query]);

  const create = async () => {
    const name = newName.trim();
    if (!name) return;
    setCreating(true);
    try {
      const cat = await createCategory(name);
      toast(t('categorySaved'));
      onCreated?.();
      onSelect(cat.name);
      setNewName('');
      onClose();
    } catch {
      toast(t('error'), 'error');
    } finally {
      setCreating(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('chooseCategory')}
      footer={<Button variant="secondary" onClick={onClose}>{t('close')}</Button>}
    >
      <div className="space-y-4">
        <Input
          icon={<Search size={15} />}
          placeholder={t('search')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label={t('search')}
        />
        <div className="max-h-64 space-y-1 overflow-y-auto">
          {filtered.length === 0 && <p className="px-2 py-6 text-center text-xs text-slate-400">{t('noResults')}</p>}
          {filtered.map((cat) => (
            <button
              key={cat.id}
              type="button"
              onClick={() => {
                onSelect(cat.name);
                onClose();
              }}
              className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-start text-sm transition-colors ${
                cat.name === value
                  ? 'bg-brand-50 font-semibold text-brand-700 dark:bg-brand-900/30 dark:text-brand-300'
                  : 'text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800'
              }`}
            >
              <span className="flex items-center gap-2">
                <Tags size={14} className="text-slate-400" />
                {cat.name}
              </span>
              <span className="text-[10px] text-slate-400">{cat.isDefault ? t('defaultCategory') : ''}</span>
            </button>
          ))}
        </div>
        <div className="rounded-lg border border-dashed border-slate-300 p-3 dark:border-slate-600">
          <p className="mb-2 text-xs font-semibold text-slate-600 dark:text-slate-300">{t('createCategory')}</p>
          <div className="flex gap-2">
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder={t('categoryName')}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void create();
                }
              }}
            />
            <Button type="button" icon={<Plus size={15} />} loading={creating} onClick={() => void create()}>
              {t('add')}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
