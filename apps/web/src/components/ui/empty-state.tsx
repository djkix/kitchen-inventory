import type { ReactNode } from 'react';

interface EmptyStateProps {
  title: string;
  /** Toujours expliquer l'action suivante, jamais un simple « aucun résultat » (section 14). */
  description: string;
  action?: ReactNode;
  icon?: ReactNode;
}

export function EmptyState({ title, description, action, icon }: EmptyStateProps) {
  return (
    <div className="mx-4 my-8 flex flex-col items-center gap-3 rounded-card border border-dashed border-line px-6 py-10 text-center">
      {icon && <div className="text-muted">{icon}</div>}
      <h2 className="text-[17px] font-semibold">{title}</h2>
      <p className="max-w-[32ch] text-[14px] text-muted">{description}</p>
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function ErrorState({ title = 'Impossible de charger', message, onRetry }: { title?: string; message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="mx-4 my-8 flex flex-col items-center gap-3 rounded-card border border-danger/40 bg-danger-deep/40 px-6 py-8 text-center">
      <h2 className="text-[17px] font-semibold">{title}</h2>
      <p className="max-w-[36ch] text-[14px] text-muted">{message}</p>
      {onRetry && (
        <button type="button" onClick={onRetry} className="mt-1 min-h-touch rounded-xl bg-raised px-4 text-[15px] font-medium">
          Réessayer
        </button>
      )}
    </div>
  );
}
