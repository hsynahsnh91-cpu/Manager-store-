import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Barcode, Minus, Plus, Search, ShoppingCart, Trash2, User, X } from 'lucide-react';
import type { Invoice, Product } from '../../types';
import { listProducts } from '../../services/products';
import { listCustomers } from '../../services/customers';
import { createSale, computeCartTotals, SaleError, getNextInvoiceNumber } from '../../services/sales';
import { useAsync } from '../../hooks/useAsync';
import { useApp } from '../../context/AppContext';
import { useI18n } from '../../i18n';
import { Button } from '../../components/Button';
import { Input, Select } from '../../components/Form';
import { EmptyState } from '../../components/UI';
import { formatMoney, round2 } from '../../utils/money';
import { uid } from '../../utils/id';
import { useNavigate } from 'react-router-dom';

interface CartLine {
  productId: string;
  name: string;
  code: string;
  unitPrice: number;
  unitStock: number;
  quantity: number;
}

export function POSPage() {
  const { t } = useI18n();
  const { settings, toast } = useApp();
  const navigate = useNavigate();

  const { data: products, loading } = useAsync(() => listProducts(), []);
  const { data: customers } = useAsync(() => listCustomers(), []);

  const [query, setQuery] = useState('');
  const [cart, setCart] = useState<CartLine[]>([]);
  const [discount, setDiscount] = useState('0');
  const [customerId, setCustomerId] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'bank' | 'credit'>('cash');
  const [paidStr, setPaidStr] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [lastSale, setLastSale] = useState<Invoice | null>(null);
  const [stockError, setStockError] = useState<string | null>(null);

  // مفتاح فريد لكل عملية — يُنشأ مرة واحدة ويرسل مع الطلب لمنع التكرار
  const tokenRef = useRef<string>(uid('tok'));
  const searchRef = useRef<HTMLInputElement>(null);

  const activeProducts = useMemo(() => (products ?? []).filter((p) => !p.archived), [products]);

  const suggestions = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return activeProducts.slice(0, 8);
    return activeProducts
      .filter((p) => `${p.name} ${p.code} ${p.barcode}`.toLowerCase().includes(q))
      .slice(0, 8);
  }, [activeProducts, query]);

  const totals = useMemo(() => {
    const lines = cart.map((l) => ({ productId: l.productId, quantity: l.quantity, unitPrice: l.unitPrice }));
    return computeCartTotals(lines, Number(discount) || 0, Number(paidStr) || 0);
  }, [cart, discount, paidStr]);

  const selectedCustomer = useMemo(() => (customers ?? []).find((c) => c.id === customerId), [customers, customerId]);

  const addToCart = useCallback(
    (p: Product) => {
      setStockError(null);
      setCart((prev) => {
        const existing = prev.find((l) => l.productId === p.id);
        if (existing) {
          const nextQty = existing.quantity + 1;
          if (!settings.allowNegativeStock && nextQty > p.quantity) {
            setStockError(`${p.name}: ${t('insufficientStock')} (${p.quantity})`);
            return prev;
          }
          return prev.map((l) => (l.productId === p.id ? { ...l, quantity: nextQty } : l));
        }
        if (!settings.allowNegativeStock && p.quantity <= 0) {
          setStockError(`${p.name}: ${t('insufficientStock')}`);
          return prev;
        }
        return [
          ...prev,
          { productId: p.id, name: p.name, code: p.code, unitPrice: p.salePrice, unitStock: p.quantity, quantity: 1 },
        ];
      });
      setQuery('');
      searchRef.current?.focus();
    },
    [settings.allowNegativeStock, t],
  );

  const changeQty = (productId: string, delta: number) => {
    setStockError(null);
    setCart((prev) =>
      prev.flatMap((l) => {
        if (l.productId !== productId) return [l];
        const next = l.quantity + delta;
        if (next <= 0) return [];
        if (!settings.allowNegativeStock && next > l.unitStock) {
          setStockError(`${l.name}: ${t('insufficientStock')} (${l.unitStock})`);
          return [l];
        }
        return [{ ...l, quantity: next }];
      }),
    );
  };

  const removeLine = (productId: string) => setCart((prev) => prev.filter((l) => l.productId !== productId));
  const clearCart = () => {
    setCart([]);
    setDiscount('0');
    setPaidStr('');
    setCustomerId('');
    setPaymentMethod('cash');
    setStockError(null);
    tokenRef.current = uid('tok');
  };

  // احترام إعداد السماح بالبيع السالب: عند تغيّر الإعداد نتحقق من السلة
  useEffect(() => {
    if (settings.allowNegativeStock) setStockError(null);
  }, [settings.allowNegativeStock]);

  // المبلغ المدفوع الافتراضي = الإجمالي عند تغيّره نقديًا
  useEffect(() => {
    if (paymentMethod !== 'credit' && cart.length > 0 && paidStr === '') {
      setPaidStr(String(totals.total));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [totals.total, paymentMethod]);

  const paid = paymentMethod === 'credit' ? 0 : Number(paidStr) || 0;
  const computed = useMemo(
    () => computeCartTotals(cart.map((l) => ({ productId: l.productId, quantity: l.quantity, unitPrice: l.unitPrice })), Number(discount) || 0, paid),
    [cart, discount, paid],
  );

  const creditInvalid = computed.remaining > 0 && !customerId;
  const canSubmit =
    cart.length > 0 && !submitting && !stockError && !creditInvalid && computed.paid >= 0;

  const submit = async () => {
    if (!canSubmit) {
      if (creditInvalid) toast(t('errSelectCustomer'), 'error');
      return;
    }
    setSubmitting(true);
    try {
      const invoice = await createSale(
        {
          lines: cart.map((l) => ({ productId: l.productId, quantity: l.quantity, unitPrice: l.unitPrice })),
          customerId: customerId || null,
          customerName: selectedCustomer?.name ?? '',
          discount: Number(discount) || 0,
          paid: paymentMethod === 'credit' ? 0 : Number(paidStr) || 0,
          paymentMethod,
          clientToken: tokenRef.current,
          notes: '',
        },
        {
          allowNegativeStock: settings.allowNegativeStock,
          nextInvoiceNumber: await getNextInvoiceNumber(settings.invoicePrefix),
        },
      );
      setLastSale(invoice);
      toast(t('saleSuccess'));
      clearCart();
      searchRef.current?.focus();
    } catch (err) {
      if (err instanceof SaleError) {
        if (err.code === 'INSUFFICIENT_STOCK') toast(`${t('errInsufficientStock')}${err.detail ? ` — ${err.detail}` : ''}`, 'error');
        else if (err.code === 'EMPTY_CART') toast(t('errEmptyCart'), 'error');
        else toast(t('errGeneric'), 'error');
      } else {
        toast(t('errGeneric'), 'error');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
      {/* عمود البحث والمنتجات */}
      <div className="space-y-3 lg:col-span-3">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-extrabold text-slate-800 dark:text-white">{t('posTitle')}</h1>
          {cart.length > 0 && (
            <Button variant="ghost" size="sm" icon={<X size={14} />} onClick={clearCart}>
              {t('clearCart')}
            </Button>
          )}
        </div>

        <div className="card p-3">
          <Input
            ref={searchRef}
            placeholder={t('scanOrSearch')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            icon={<Search size={15} />}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && suggestions.length > 0) {
                e.preventDefault();
                addToCart(suggestions[0]);
              }
            }}
            autoFocus
          />
          {stockError && (
            <p className="mt-2 animate-fade-in rounded-lg bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-600 dark:bg-rose-950">
              {stockError}
            </p>
          )}

          <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
            {loading
              ? Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="h-[72px] animate-pulse-soft rounded-lg bg-slate-100 dark:bg-slate-800" />
                ))
              : suggestions.map((p) => {
                  const out = !settings.allowNegativeStock && p.quantity <= 0;
                  const inCart = cart.find((l) => l.productId === p.id)?.quantity ?? 0;
                  return (
                    <button
                      key={p.id}
                      onClick={() => addToCart(p)}
                      disabled={out}
                      className="group flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white p-3 text-start transition-all hover:border-brand-400 hover:bg-brand-50/50 disabled:cursor-not-allowed disabled:opacity-45 dark:border-slate-700 dark:bg-slate-900 dark:hover:border-brand-600 dark:hover:bg-slate-800"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-bold text-slate-700 dark:text-slate-200">{p.name}</p>
                        <p className="mt-0.5 text-[11px] text-slate-400" dir="ltr">
                          {p.code} · {p.barcode || '—'}
                        </p>
                      </div>
                      <div className="text-end">
                        <p className="text-sm font-extrabold text-brand-600 dark:text-brand-400">
                          {formatMoney(p.salePrice, settings.currency)}
                        </p>
                        <p className={`text-[10px] font-bold ${out ? 'text-rose-500' : p.quantity <= p.alertThreshold ? 'text-amber-500' : 'text-emerald-500'}`}>
                          {p.quantity} {inCart > 0 ? `(${inCart})` : ''}
                        </p>
                      </div>
                    </button>
                  );
                })}
          </div>
          {!loading && suggestions.length === 0 && (
            <EmptyState icon={<Barcode size={24} />} title={t('noData')} hint={t('emptyHint')} />
          )}
        </div>
      </div>

      {/* عمود السلة */}
      <div className="lg:col-span-2">
        <div className="card sticky top-[72px] flex max-h-[calc(100vh-100px)] flex-col">
          <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-3 dark:border-slate-700">
            <ShoppingCart size={16} className="text-brand-600" />
            <h2 className="text-sm font-bold text-slate-700 dark:text-slate-200">{t('cart')}</h2>
            <span className="ms-auto rounded-full bg-brand-50 px-2 py-0.5 text-[11px] font-bold text-brand-600 dark:bg-brand-950">
              {cart.reduce((a, l) => a + l.quantity, 0)} {t('items')}
            </span>
          </div>

          {/* الأصناف */}
          <div className="min-h-[120px] flex-1 overflow-y-auto px-3 py-2">
            {cart.length === 0 ? (
              <EmptyState icon={<ShoppingCart size={24} />} title={t('emptyCart')} hint={t('emptyCartHint')} />
            ) : (
              <ul className="space-y-2">
                {cart.map((l) => (
                  <li key={l.productId} className="animate-slide-up rounded-lg border border-slate-200 p-2.5 dark:border-slate-700">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-xs font-bold text-slate-700 dark:text-slate-200">{l.name}</p>
                        <p className="text-[11px] text-slate-400">
                          {formatMoney(l.unitPrice)} × {l.quantity} ={' '}
                          <span className="font-bold text-slate-600 dark:text-slate-300">
                            {formatMoney(round2(l.unitPrice * l.quantity), settings.currency)}
                          </span>
                        </p>
                      </div>
                      <button
                        onClick={() => removeLine(l.productId)}
                        className="rounded p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-500 dark:hover:bg-rose-950"
                        title={t('removeFromCart')}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                    <div className="mt-2 flex items-center justify-between">
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => changeQty(l.productId, -1)}
                          className="flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 text-slate-500 transition-colors hover:bg-slate-100 dark:border-slate-600 dark:hover:bg-slate-800"
                        >
                          <Minus size={13} />
                        </button>
                        <span className="w-9 text-center text-sm font-bold text-slate-700 dark:text-slate-200">{l.quantity}</span>
                        <button
                          onClick={() => changeQty(l.productId, 1)}
                          className="flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 text-slate-500 transition-colors hover:bg-slate-100 dark:border-slate-600 dark:hover:bg-slate-800"
                        >
                          <Plus size={13} />
                        </button>
                      </div>
                      <span className="text-xs font-bold text-slate-600 dark:text-slate-300">
                        {t('stock')}: {l.unitStock}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* الإجماليات والدفع */}
          <div className="space-y-2.5 border-t border-slate-200 px-4 py-3 dark:border-slate-700">
            <div className="grid grid-cols-2 gap-2">
              <Input
                label={t('applyDiscount')}
                type="number"
                min="0"
                step="0.01"
                value={discount}
                onChange={(e) => setDiscount(e.target.value)}
              />
              <Select
                label={t('customer')}
                value={customerId}
                onChange={(e) => setCustomerId(e.target.value)}
                placeholder={t('walkInCustomer')}
              >
                {(customers ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </div>

            <div>
              <span className="mb-1.5 block text-xs font-semibold text-slate-600 dark:text-slate-300">
                {t('paymentMethod')}
              </span>
              <div className="grid grid-cols-3 gap-1.5 rounded-lg bg-slate-100 p-1 dark:bg-slate-800">
                {(['cash', 'bank', 'credit'] as const).map((m) => (
                  <button
                    key={m}
                    onClick={() => {
                      setPaymentMethod(m);
                      if (m === 'credit') setPaidStr('0');
                      else setPaidStr(String(totals.total));
                    }}
                    className={`rounded-md px-2 py-1.5 text-xs font-bold transition-all ${
                      paymentMethod === m
                        ? 'bg-white text-brand-600 shadow-sm dark:bg-slate-900 dark:text-brand-400'
                        : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
                    }`}
                  >
                    {t(m === 'bank' ? 'bank' : m === 'credit' ? 'credit' : 'cash')}
                  </button>
                ))}
              </div>
            </div>

            {paymentMethod !== 'credit' && (
              <Input
                label={t('amountPaid')}
                type="number"
                min="0"
                step="0.01"
                value={paidStr}
                onChange={(e) => setPaidStr(e.target.value)}
              />
            )}

            <div className="space-y-1 rounded-lg bg-slate-50 p-3 text-xs dark:bg-slate-800/70">
              <Row label={t('subtotal')} value={formatMoney(totals.subtotal)} />
              <Row label={t('discount')} value={`− ${formatMoney(totals.discount)}`} />
              <div className="my-1 border-t border-dashed border-slate-200 dark:border-slate-700" />
              <div className="flex items-center justify-between">
                <span className="text-sm font-extrabold text-slate-700 dark:text-slate-200">{t('total')}</span>
                <span className="text-lg font-extrabold text-brand-600 dark:text-brand-400" dir="ltr">
                  {formatMoney(totals.total, settings.currency)}
                </span>
              </div>
              <Row
                label={paymentMethod === 'credit' ? t('due') : t('change')}
                value={
                  paymentMethod === 'credit'
                    ? formatMoney(computed.remaining, settings.currency)
                    : formatMoney(Math.max(0, round2(computed.paid - totals.total)), settings.currency)
                }
                strong
              />
            </div>

            {creditInvalid && (
              <p className="rounded-lg bg-amber-50 px-3 py-2 text-[11px] font-semibold text-amber-700 dark:bg-amber-950 dark:text-amber-400">
                <User size={11} className="me-1 inline" />
                {t('selectCustomerForCredit')}
              </p>
            )}

            <Button block size="lg" onClick={submit} loading={submitting} disabled={!canSubmit} icon={<ShoppingCart size={17} />}>
              {submitting ? t('processing') : t('completeSale')}
            </Button>

            {lastSale && (
              <div className="animate-slide-up rounded-lg border border-emerald-200 bg-emerald-50 p-2.5 text-[11px] text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-400">
                <p className="font-bold">
                  {t('saleSuccess')} — {lastSale.number}
                </p>
                <button
                  className="mt-1 underline"
                  onClick={() => navigate('/invoices', { state: { openInvoice: lastSale.id } })}
                >
                  {t('invoiceDetails')}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className={strong ? 'font-bold text-slate-600 dark:text-slate-300' : 'text-slate-500 dark:text-slate-400'}>{label}</span>
      <span className={`font-mono ${strong ? 'font-extrabold text-slate-700 dark:text-slate-200' : 'text-slate-600 dark:text-slate-300'}`} dir="ltr">
        {value}
      </span>
    </div>
  );
}
