import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { cn } from '../../lib/cn';

export interface ToastOptions {
  message: string;
  tone?: 'neutral' | 'danger' | 'success';
  /** Durée d'affichage ; 5 000 ms par défaut, la fenêtre d'annulation de la section 14. */
  durationMs?: number;
  action?: { label: string; onClick: () => void | Promise<void> };
}

interface ToastEntry extends ToastOptions {
  id: number;
}

interface ToastContextValue {
  show: (options: ToastOptions) => number;
  dismiss: (id: number) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastEntry[]>([]);
  const counter = useRef(0);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const show = useCallback((options: ToastOptions) => {
    const id = ++counter.current;
    // Un seul toast à la fois : le plus récent remplace les précédents pour rester lisible à une main.
    setToasts([{ ...options, id }]);
    return id;
  }, []);

  const value = useMemo(() => ({ show, dismiss }), [show, dismiss]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-[calc(var(--spacing-nav)+env(safe-area-inset-bottom,0px)+12px)] z-50 flex flex-col items-center gap-2 px-4">
        {toasts.map((toast) => (
          <ToastItem key={toast.id} toast={toast} onDone={() => dismiss(toast.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastItem({ toast, onDone }: { toast: ToastEntry; onDone: () => void }) {
  const duration = toast.durationMs ?? 5000;
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(onDone, duration);
    return () => window.clearTimeout(timer);
  }, [duration, onDone]);

  const runAction = async () => {
    if (!toast.action || busy) return;
    setBusy(true);
    try {
      await toast.action.onClick();
    } finally {
      onDone();
    }
  };

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        'anim-toast pointer-events-auto flex w-full max-w-md items-center gap-3 rounded-2xl border px-4 py-3 shadow-xl',
        toast.tone === 'danger' ? 'border-danger/40 bg-danger-deep text-fg' : toast.tone === 'success' ? 'border-accent/40 bg-accent-deep text-fg' : 'border-line bg-raised text-fg',
      )}
    >
      <p className="flex-1 text-[15px] leading-snug">{toast.message}</p>
      {toast.action && (
        <button
          type="button"
          onClick={runAction}
          disabled={busy}
          className="min-h-[40px] shrink-0 rounded-lg px-3 text-[15px] font-semibold text-accent active:bg-black/20 disabled:text-faint"
        >
          {toast.action.label}
        </button>
      )}
    </div>
  );
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast doit être utilisé sous ToastProvider');
  return context;
}
