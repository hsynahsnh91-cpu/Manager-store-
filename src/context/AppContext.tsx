import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { Settings } from '../types';
import { DEFAULT_SETTINGS, getSettings, saveSettings } from '../services/settings';
import { I18nProvider } from '../i18n';
import { uid } from '../utils/id';

export type ToastKind = 'success' | 'error' | 'info';
export interface Toast {
  id: string;
  kind: ToastKind;
  message: string;
}

interface AppContextValue {
  settings: Settings;
  ready: boolean;
  toasts: Toast[];
  updateSettings: (patch: Partial<Settings>) => Promise<void>;
  toast: (message: string, kind?: ToastKind) => void;
  dismissToast: (id: string) => void;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [ready, setReady] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => {
    let alive = true;
    getSettings()
      .then((s) => {
        if (alive) {
          setSettings(s);
          setReady(true);
        }
      })
      .catch(() => {
        if (alive) setReady(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  // تطبيق اللغة والاتجاه والسمة على المستند
  useEffect(() => {
    const html = document.documentElement;
    html.lang = settings.language;
    html.dir = settings.language === 'ar' ? 'rtl' : 'ltr';
    html.classList.toggle('dark', settings.theme === 'dark');
  }, [settings.language, settings.theme]);

  const updateSettings = useCallback(async (patch: Partial<Settings>) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    try {
      await saveSettings(next);
    } catch {
      // نعيد الحالة السابقة عند فشل الحفظ
      const reloaded = await getSettings();
      setSettings(reloaded);
      throw new Error('SAVE_FAILED');
    }
  }, [settings]);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback(
    (message: string, kind: ToastKind = 'success') => {
      const id = uid('tst');
      setToasts((prev) => [...prev.slice(-3), { id, kind, message }]);
      window.setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, 3500);
    },
    [],
  );

  const value = useMemo<AppContextValue>(
    () => ({ settings, ready, toasts, updateSettings, toast, dismissToast }),
    [settings, ready, toasts, updateSettings, toast, dismissToast],
  );

  return (
    <AppContext.Provider value={value}>
      <I18nProvider lang={settings.language}>{children}</I18nProvider>
    </AppContext.Provider>
  );
}

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
}
