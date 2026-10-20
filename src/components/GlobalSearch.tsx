import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Tag } from 'lucide-react';
import type { Product } from '../types';
import { listProducts } from '../services/products';
import { useI18n } from '../i18n';
import { useApp } from '../context/AppContext';
import { formatMoney } from '../utils/money';
import { normalizeArabic } from '../utils/text';

/** بحث سريع على مستوى التطبيق: منتج ← الأسعار، أو فاتورة ← المكتبة */
export function GlobalSearch() {
  const { t } = useI18n();
  const { settings } = useApp();
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [products, setProducts] = useState<Product[]>([]);
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const load = (force = false) => {
    if (!force && products.length > 0) return;
    void listProducts().then((rows) => setProducts(rows.filter((p) => !p.archived)));
  };

  const results = useMemo(() => {
    const needle = normalizeArabic(q);
    if (!needle) return [];
    return products
      .filter((p) => normalizeArabic(`${p.name} ${p.code} ${p.barcode} ${p.category}`).includes(needle))
      .slice(0, 7);
  }, [q, products]);

  const goToPrices = (query: string) => {
    setOpen(false);
    navigate(`/prices?q=${encodeURIComponent(query)}`);
  };

  return (
    <div ref={boxRef} className="relative hidden w-56 md:block lg:w-72">
      <div className="relative">
        <Search size={14} className="pointer-events-none absolute inset-y-0 start-2.5 my-auto text-slate-400" />
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
            load();
          }}
          onFocus={() => {
            load(true); // أعِد القراءة حتى تظهر المنتجات المضافة حديثًا
            if (q) setOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && q.trim()) goToPrices(q.trim());
            if (e.key === 'Escape') {
              setOpen(false);
              inputRef.current?.blur();
            }
          }}
          placeholder={t('searchAllRecords')}
          aria-label={t('priceSearch')}
          className="h-8 w-full rounded-lg border border-slate-200 bg-slate-50 ps-8 pe-2 text-xs text-slate-700 placeholder-slate-400 focus:border-brand-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-500/20 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:focus:bg-slate-900"
        />
      </div>
      {open && results.length > 0 && (
        <div className="absolute inset-x-0 top-9 z-40 max-h-72 overflow-y-auto rounded-lg border border-slate-200 bg-white p-1 shadow-lg dark:border-slate-700 dark:bg-slate-900">
          {results.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => goToPrices(p.name)}
              className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-start hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              <span className="min-w-0">
                <span className="block truncate text-xs font-semibold text-slate-700 dark:text-slate-200">{p.name}</span>
                <span className="block truncate text-[10px] text-slate-400">{p.category || '—'}</span>
              </span>
              <span className="shrink-0 text-end">
                <span className="block font-mono text-[11px] font-bold text-slate-700 dark:text-slate-200">{formatMoney(p.salePrice, settings.currency)}</span>
                <span className="block font-mono text-[10px] text-slate-400">{formatMoney(p.purchasePrice, settings.currency)}</span>
              </span>
            </button>
          ))}
          <button
            type="button"
            onClick={() => goToPrices(q.trim())}
            className="mt-1 flex w-full items-center gap-1.5 rounded-md border-t border-slate-100 px-2 py-1.5 text-[11px] font-semibold text-brand-600 hover:bg-brand-50 dark:border-slate-800 dark:text-brand-400 dark:hover:bg-brand-900/20"
          >
            <Tag size={12} /> {t('priceSearch')} — {q}
          </button>
        </div>
      )}
    </div>
  );
}
