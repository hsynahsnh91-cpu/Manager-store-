import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppProvider, useApp } from './context/AppContext';
import { AppShell } from './components/AppShell';
import { DashboardPage } from './features/dashboard/DashboardPage';
import { ProductsPage } from './features/products/ProductsPage';
import { POSPage } from './features/pos/POSPage';
import { InvoicesPage } from './features/invoices/InvoicesPage';
import { PurchasesPage } from './features/purchases/PurchasesPage';
import { CustomersPage } from './features/customers/CustomersPage';
import { SuppliersPage } from './features/suppliers/SuppliersPage';
import { ExpensesPage } from './features/expenses/ExpensesPage';
import { CashPage } from './features/cash/CashPage';
import { ReportsPage } from './features/reports/ReportsPage';
import { SettingsPage } from './features/settings/SettingsPage';
import { SalesLogPage } from './features/sales-log/SalesLogPage';
import { ScanInvoicePage } from './features/scan/ScanInvoicePage';
import { InvoiceLibraryPage } from './features/scan/InvoiceLibraryPage';
import { PricesPage } from './features/prices/PricesPage';

function LoadingScreen() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 dark:bg-slate-950">
      <div className="flex flex-col items-center gap-3">
        <div className="h-9 w-9 animate-spin rounded-full border-[3px] border-brand-600 border-t-transparent" />
        <p className="text-xs font-semibold text-slate-400">Loading…</p>
      </div>
    </div>
  );
}

function AppRoutes() {
  const { ready } = useApp();
  if (!ready) return <LoadingScreen />;
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/sales-log" element={<SalesLogPage />} />
        <Route path="/products" element={<ProductsPage />} />
        <Route path="/prices" element={<PricesPage />} />
        <Route path="/pos" element={<POSPage />} />
        <Route path="/invoices" element={<InvoicesPage />} />
        <Route path="/scan" element={<ScanInvoicePage />} />
        <Route path="/invoice-library" element={<InvoiceLibraryPage />} />
        <Route path="/purchases" element={<PurchasesPage />} />
        <Route path="/customers" element={<CustomersPage />} />
        <Route path="/suppliers" element={<SuppliersPage />} />
        <Route path="/expenses" element={<ExpensesPage />} />
        <Route path="/cash" element={<CashPage />} />
        <Route path="/reports" element={<ReportsPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

export default function App() {
  return (
    <AppProvider>
      <HashRouter>
        <AppRoutes />
      </HashRouter>
    </AppProvider>
  );
}
