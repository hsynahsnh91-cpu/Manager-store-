import type { ReactNode } from 'react';
import { useAnimatedNumber } from '../hooks/useAnimatedNumber';
import { useApp } from '../context/AppContext';
import { formatMoney } from '../utils/money';

/**
 * رقم مالي يتحوّل سلسًا عند تغيّر البيانات (يحترم prefers-reduced-motion).
 * يُستخدم داخل StatCard عبر القيمة amount.
 */
export function AnimatedMoney({ amount }: { amount: number }) {
  const { settings } = useApp();
  const animated = useAnimatedNumber(amount);
  return <>{formatMoney(animated, settings.currency)}</>;
}

/** بطاقة إحصائية مالية */
export function StatCard({
  title,
  value,
  amount,
  icon,
  accent = 'brand',
  sub,
  loading,
}: {
  title: string;
  /** نص جاهز للعرض — يُفضَّل amount للتحريك */
  value?: string;
  /** مبلغ مالي يُعرض مع حركة تحديث سلسة */
  amount?: number;
  icon: ReactNode;
  accent?: 'brand' | 'emerald' | 'amber' | 'rose' | 'violet';
  sub?: ReactNode;
  loading?: boolean;
}) {
  const accents: Record<string, string> = {
    brand: 'bg-brand-50 text-brand-600 dark:bg-brand-950 dark:text-brand-400',
    emerald: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950 dark:text-emerald-400',
    amber: 'bg-amber-50 text-amber-600 dark:bg-amber-950 dark:text-amber-400',
    rose: 'bg-rose-50 text-rose-600 dark:bg-rose-950 dark:text-rose-400',
    violet: 'bg-violet-50 text-violet-600 dark:bg-violet-950 dark:text-violet-400',
  };
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-card transition-shadow hover:shadow-md dark:border-slate-700/60 dark:bg-slate-900">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-xs font-medium text-slate-500 dark:text-slate-400">{title}</p>
          {loading ? (
            <div className="mt-2 h-7 w-24 animate-pulse-soft rounded bg-slate-200 dark:bg-slate-700" />
          ) : (
            <p className="mt-1 truncate text-xl font-bold text-slate-800 dark:text-slate-100" dir="ltr" style={{ textAlign: 'start' }}>
              {amount !== undefined ? <AnimatedMoney amount={amount} /> : value}
            </p>
          )}
          {sub && <div className="mt-1 text-xs text-slate-400">{sub}</div>}
        </div>
        <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${accents[accent]}`}>{icon}</span>
      </div>
    </div>
  );
}

/** حالة فارغة مفيدة */
export function EmptyState({
  icon,
  title,
  hint,
  action,
}: {
  icon: ReactNode;
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center animate-fade-in">
      <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-slate-400 dark:bg-slate-800">
        {icon}
      </div>
      <h3 className="text-sm font-bold text-slate-600 dark:text-slate-300">{title}</h3>
      {hint && <p className="mt-1 max-w-sm text-xs leading-relaxed text-slate-400">{hint}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/** هياكل تحميل للجداول */
export function SkeletonRows({ rows = 6, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className="divide-y divide-slate-100 dark:divide-slate-800">
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex items-center gap-4 px-4 py-3.5">
          {Array.from({ length: cols }).map((__, c) => (
            <div
              key={c}
              className="h-3.5 animate-pulse-soft rounded bg-slate-200 dark:bg-slate-700"
              style={{ width: c === 0 ? '28%' : `${18 - c}%`, animationDelay: `${(r * cols + c) * 40}ms` }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

/** شارة حالة */
export function Badge({ children, tone = 'slate' }: { children: ReactNode; tone?: 'slate' | 'green' | 'amber' | 'rose' | 'blue' }) {
  const tones: Record<string, string> = {
    slate: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
    green: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400',
    amber: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400',
    rose: 'bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-400',
    blue: 'bg-brand-100 text-brand-700 dark:bg-brand-950 dark:text-brand-300',
  };
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-bold ${tones[tone]}`}>
      {children}
    </span>
  );
}

/** شريط مخزون متحرك */
export function StockBar({ value, max }: { value: number; max: number }) {
  const pct = max <= 0 ? 0 : Math.min(100, Math.max(0, (value / max) * 100));
  const tone = value <= 0 ? 'bg-rose-500' : pct <= 30 ? 'bg-amber-500' : 'bg-emerald-500';
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
      <div
        className={`h-full rounded-full transition-all duration-500 ${tone}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
