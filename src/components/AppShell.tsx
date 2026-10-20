import { NavLink, Outlet, useLocation } from 'react-router-dom';
import {
  BarChart3,
  BookOpenText,
  Boxes,
  Building2,
  CreditCard,
  LayoutDashboard,
  Menu,
  Moon,
  PackagePlus,
  Receipt,
  Settings,
  ShoppingCart,
  Sun,
  Wallet,
  X,
  Users,
} from 'lucide-react';
import { useState } from 'react';
import { useI18n } from '../i18n';
import { useApp } from '../context/AppContext';
import { ToastHost } from '../components/ToastHost';
import type { TranslationKey } from '../i18n/ar';

interface NavItem {
  to: string;
  labelKey: TranslationKey;
  icon: typeof LayoutDashboard;
}

const NAV: NavItem[] = [
  { to: '/', labelKey: 'navDashboard', icon: LayoutDashboard },
  { to: '/pos', labelKey: 'navPos', icon: ShoppingCart },
  { to: '/products', labelKey: 'navProducts', icon: Boxes },
  { to: '/invoices', labelKey: 'navInvoices', icon: Receipt },
  { to: '/purchases', labelKey: 'navPurchases', icon: PackagePlus },
  { to: '/customers', labelKey: 'navCustomers', icon: Users },
  { to: '/suppliers', labelKey: 'navSuppliers', icon: Building2 },
  { to: '/expenses', labelKey: 'navExpenses', icon: CreditCard },
  { to: '/cash', labelKey: 'navCash', icon: Wallet },
  { to: '/reports', labelKey: 'navReports', icon: BarChart3 },
  { to: '/settings', labelKey: 'navSettings', icon: Settings },
];

/** عناصر شريط الهاتف السفلي (أهم 4) */
const MOBILE_NAV = NAV.slice(0, 4);

export function AppShell() {
  const { t } = useI18n();
  const { settings, updateSettings } = useApp();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const location = useLocation();

  const isDark = settings.theme === 'dark';

  const toggleTheme = () => {
    void updateSettings({ theme: isDark ? 'light' : 'dark' });
  };

  const toggleLang = () => {
    void updateSettings({ language: settings.language === 'ar' ? 'en' : 'ar' });
  };

  const navLinkClass = ({ isActive }: { isActive: boolean }) =>
    `group flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-semibold transition-all duration-150 ${
      isActive
        ? 'bg-brand-600 text-white shadow-sm'
        : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white'
    }`;

  const sidebar = (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2.5 px-5 py-5">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-600 text-white">
          <BookOpenText size={18} />
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-extrabold text-slate-800 dark:text-white">{t('appName')}</p>
          <p className="truncate text-[10px] text-slate-400">{t('appTagline')}</p>
        </div>
      </div>
      <nav className="flex-1 space-y-1 overflow-y-auto px-3 pb-4">
        {NAV.map((item) => (
          <NavLink key={item.to} to={item.to} end={item.to === '/'} className={navLinkClass} onClick={() => setDrawerOpen(false)}>
            <item.icon size={17} className="shrink-0" />
            <span className="truncate">{t(item.labelKey)}</span>
          </NavLink>
        ))}
      </nav>
      <div className="border-t border-slate-200 px-4 py-3 text-[10px] text-slate-400 dark:border-slate-700">
        v1.0 · Local DB
      </div>
    </div>
  );

  return (
    <div className="flex min-h-screen bg-slate-50 dark:bg-slate-950">
      {/* القائمة الجانبية — سطح المكتب */}
      <aside className="fixed inset-y-0 start-0 z-30 hidden w-64 border-e border-slate-200 bg-white lg:block dark:border-slate-800 dark:bg-slate-900">
        {sidebar}
      </aside>

      {/* درج القائمة — الجوال */}
      {drawerOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 animate-fade-in bg-slate-900/50" onClick={() => setDrawerOpen(false)} />
          <aside className="absolute inset-y-0 start-0 w-72 animate-slide-up bg-white shadow-xl dark:bg-slate-900 rtl:animate-slide-up">
            <button
              onClick={() => setDrawerOpen(false)}
              className="absolute end-3 top-4 rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
              aria-label={t('close')}
            >
              <X size={18} />
            </button>
            {sidebar}
          </aside>
        </div>
      )}

      {/* المحتوى */}
      <div className="flex w-full flex-col lg:ms-64">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-slate-200 bg-white/90 px-4 backdrop-blur print:hidden dark:border-slate-800 dark:bg-slate-900/90">
          <button
            className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 lg:hidden dark:hover:bg-slate-800"
            onClick={() => setDrawerOpen(true)}
            aria-label={t('menu')}
          >
            <Menu size={19} />
          </button>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-bold text-slate-700 dark:text-slate-200">{settings.storeName}</p>
          </div>
          <button
            onClick={toggleLang}
            className="h-8 rounded-lg border border-slate-200 px-2.5 text-xs font-bold text-slate-600 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
            title={t('language')}
          >
            {settings.language === 'ar' ? 'EN' : 'عربي'}
          </button>
          <button
            onClick={toggleTheme}
            className="rounded-lg p-2 text-slate-500 transition-colors hover:bg-slate-100 dark:hover:bg-slate-800"
            aria-label={t('theme')}
          >
            {isDark ? <Sun size={17} /> : <Moon size={17} />}
          </button>
        </header>

        <main key={location.pathname} className="flex-1 animate-fade-in px-4 pb-24 pt-5 sm:px-6 lg:pb-8">
          <div className="mx-auto max-w-7xl">
            <Outlet />
          </div>
        </main>
      </div>

      {/* شريط التنقل السفلي — الجوال */}
      <nav className="fixed inset-x-0 bottom-0 z-40 flex border-t border-slate-200 bg-white/95 backdrop-blur print:hidden lg:hidden dark:border-slate-800 dark:bg-slate-900/95">
        {MOBILE_NAV.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            className={({ isActive }) =>
              `flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] font-semibold transition-colors ${
                isActive ? 'text-brand-600 dark:text-brand-400' : 'text-slate-400'
              }`
            }
          >
            <item.icon size={18} />
            <span className="max-w-full truncate px-1">{t(item.labelKey)}</span>
          </NavLink>
        ))}
      </nav>

      <ToastHost />
    </div>
  );
}
