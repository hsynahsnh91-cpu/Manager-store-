import { useRef, useState } from 'react';
import {
  AlertTriangle,
  Database,
  Download,
  Globe,
  Moon,
  Store,
  Sun,
  Upload,
  Palette,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useI18n } from '../../i18n';
import { Button } from '../../components/Button';
import { Input, Select } from '../../components/Form';
import { ConfirmDialog } from '../../components/Modal';
import { clearAllData, exportBackup, downloadBackup, importBackup, type BackupFile } from '../../services/backup';
import type { Settings, ThemeMode, Language } from '../../types';

export function SettingsPage() {
  const { t } = useI18n();
  const { settings, updateSettings, toast } = useApp();
  const [form, setForm] = useState<Settings>({ ...settings });
  const [saving, setSaving] = useState(false);
  const [confirm, setConfirm] = useState<{ title: string; message: string; action: () => Promise<void> } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const save = async () => {
    setSaving(true);
    try {
      await updateSettings({
        ...form,
        lowStockDefault: Number(form.lowStockDefault) || 5,
        expenseCategories: form.expenseCategories,
      });
      toast(t('saved'));
    } catch {
      toast(t('error'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const patch = (p: Partial<Settings>) => {
    setForm((f) => ({ ...f, ...p }));
    void updateSettings(p); // اللغة/السمة تُطبَّق فورًا
  };

  const doExport = async () => {
    try {
      const backup = await exportBackup();
      downloadBackup(backup);
      toast(t('success'));
    } catch {
      toast(t('error'), 'error');
    }
  };

  const onImportFile = async (file: File) => {
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as BackupFile;
      await importBackup(parsed);
      toast(t('success'));
      setTimeout(() => window.location.reload(), 600);
    } catch {
      toast(t('error'), 'error');
    }
  };

  return (
    <div className="max-w-3xl space-y-4">
      <h1 className="text-lg font-extrabold text-slate-800 dark:text-white">{t('settingsTitle')}</h1>

      {/* بيانات المتجر */}
      <section className="card p-5">
        <h2 className="mb-4 flex items-center gap-2 text-sm font-bold text-slate-700 dark:text-slate-200">
          <Store size={16} className="text-brand-600" /> {t('storeInfo')}
        </h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Input label={t('storeName')} value={form.storeName} onChange={(e) => setForm({ ...form, storeName: e.target.value })} />
          <Input label={t('storePhone')} value={form.storePhone} onChange={(e) => setForm({ ...form, storePhone: e.target.value })} dir="ltr" />
          <Input label={t('storeAddress')} value={form.storeAddress} onChange={(e) => setForm({ ...form, storeAddress: e.target.value })} className="sm:col-span-2" />
          <Input label={t('currency')} value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })} />
          <Input label={t('defaultAlert')} type="number" min="0" value={form.lowStockDefault} onChange={(e) => setForm({ ...form, lowStockDefault: Number(e.target.value) })} />
        </div>
      </section>

      {/* المظهر واللغة */}
      <section className="card p-5">
        <h2 className="mb-4 flex items-center gap-2 text-sm font-bold text-slate-700 dark:text-slate-200">
          <Palette size={16} className="text-brand-600" /> {t('appearance')}
        </h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <span className="mb-1.5 block text-xs font-semibold text-slate-600 dark:text-slate-300">{t('theme')}</span>
            <div className="grid grid-cols-2 gap-2 rounded-lg bg-slate-100 p-1 dark:bg-slate-800">
              {(
                [
                  { mode: 'light', icon: <Sun size={15} />, label: t('light') },
                  { mode: 'dark', icon: <Moon size={15} />, label: t('dark') },
                ] as { mode: ThemeMode; icon: React.ReactNode; label: string }[]
              ).map((opt) => (
                <button
                  key={opt.mode}
                  onClick={() => patch({ theme: opt.mode })}
                  className={`flex items-center justify-center gap-1.5 rounded-md py-2 text-xs font-bold transition-all ${
                    form.theme === opt.mode
                      ? 'bg-white text-brand-600 shadow-sm dark:bg-slate-900 dark:text-brand-400'
                      : 'text-slate-500'
                  }`}
                >
                  {opt.icon}
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
          <Select
            label={t('language')}
            value={form.language}
            onChange={(e) => patch({ language: e.target.value as Language })}
          >
            <option value="ar">العربية (RTL)</option>
            <option value="en">English (LTR)</option>
          </Select>
        </div>
      </section>

      {/* السياسات */}
      <section className="card p-5">
        <h2 className="mb-4 flex items-center gap-2 text-sm font-bold text-slate-700 dark:text-slate-200">
          <AlertTriangle size={16} className="text-amber-500" /> {t('salesPolicy')}
        </h2>
        <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-slate-200 p-3 dark:border-slate-700">
          <input
            type="checkbox"
            checked={form.allowNegativeStock}
            onChange={(e) => setForm({ ...form, allowNegativeStock: e.target.checked })}
            className="mt-0.5 h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
          />
          <span>
            <span className="block text-sm font-bold text-slate-700 dark:text-slate-200">{t('allowNegativeStock')}</span>
            <span className="block text-xs text-slate-400">{t('allowNegativeStockHint')}</span>
          </span>
        </label>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Input label={t('invoicePrefixLabel')} value={form.invoicePrefix} onChange={(e) => setForm({ ...form, invoicePrefix: e.target.value })} dir="ltr" />
          <Input label={t('purchasePrefixLabel')} value={form.purchasePrefix} onChange={(e) => setForm({ ...form, purchasePrefix: e.target.value })} dir="ltr" />
          <Input
            label={t('expenseCategoriesLabel')}
            value={form.expenseCategories.join(', ')}
            onChange={(e) => setForm({ ...form, expenseCategories: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })}
          />
        </div>
      </section>

      {/* البيانات */}
      <section className="card p-5">
        <h2 className="mb-4 flex items-center gap-2 text-sm font-bold text-slate-700 dark:text-slate-200">
          <Database size={16} className="text-brand-600" /> {t('dataManagement')}
        </h2>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" icon={<Download size={15} />} onClick={() => void doExport()}>
            {t('exportBackup')}
          </Button>
          <Button variant="secondary" icon={<Upload size={15} />} onClick={() => fileRef.current?.click()}>
            {t('importBackup')}
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) {
                setConfirm({
                  title: t('importBackup'),
                  message: t('importConfirm'),
                  action: async () => {
                    await onImportFile(file);
                  },
                });
              }
              e.target.value = '';
            }}
          />
          <Button
            variant="danger"
            icon={<AlertTriangle size={15} />}
            onClick={() =>
              setConfirm({
                title: t('clearData'),
                message: t('clearDataConfirm'),
                action: async () => {
                  await clearAllData();
                  toast(t('success'));
                  setTimeout(() => window.location.reload(), 500);
                },
              })
            }
          >
            {t('clearData')}
          </Button>
        </div>
        <p className="mt-3 flex items-center gap-1.5 text-xs text-slate-400">
          <Globe size={13} /> {t('appTagline')} — IndexedDB · Local-first
        </p>
      </section>

      <div className="flex justify-end gap-2 pb-4">
        <Button loading={saving} onClick={() => void save()}>
          {t('save')}
        </Button>
      </div>

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
