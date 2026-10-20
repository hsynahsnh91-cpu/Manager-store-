import { CheckCircle2, Info, XCircle, X } from 'lucide-react';
import { useApp } from '../context/AppContext';

export function ToastHost() {
  const { toasts, dismissToast } = useApp();
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[70] flex flex-col items-center gap-2 px-4 print:hidden">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`pointer-events-auto flex w-full max-w-sm animate-slide-up items-center gap-3 rounded-xl px-4 py-3 text-sm font-semibold text-white shadow-lg ${
            toast.kind === 'success' ? 'bg-emerald-600' : toast.kind === 'error' ? 'bg-rose-600' : 'bg-slate-700'
          }`}
          role="status"
        >
          {toast.kind === 'success' ? (
            <CheckCircle2 size={18} className="shrink-0" />
          ) : toast.kind === 'error' ? (
            <XCircle size={18} className="shrink-0" />
          ) : (
            <Info size={18} className="shrink-0" />
          )}
          <span className="flex-1">{toast.message}</span>
          <button onClick={() => dismissToast(toast.id)} className="rounded p-1 hover:bg-white/15" aria-label="close">
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
