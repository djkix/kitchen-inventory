import { useEffect, useRef, type ReactNode } from 'react';
import { cn } from '../../lib/cn';

interface SheetProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  description?: string;
  children: ReactNode;
  /** Empêche la fermeture par le fond ou Échap (par exemple pendant un envoi). */
  locked?: boolean;
  className?: string;
}

/**
 * Tiroir ancré en bas : les actions restent dans le tiers inférieur de l'écran (section 8).
 * Fermeture par le fond, par Échap, et par le bouton de fermeture.
 */
export function Sheet({ open, onClose, title, description, children, locked = false, className }: SheetProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !locked) onClose();
    };
    document.addEventListener('keydown', onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [open, locked, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center" role="presentation">
      <button type="button" aria-label="Fermer" tabIndex={-1} onClick={locked ? undefined : onClose} className="absolute inset-0 bg-black/60" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cn('anim-sheet safe-bottom relative w-full max-w-lg rounded-t-sheet border-t border-line bg-surface shadow-2xl', className)}
      >
        <div className="mx-auto mt-2.5 h-1 w-10 rounded-full bg-line" aria-hidden />
        {(title || description) && (
          <header className="px-5 pt-3 pb-1">
            {title && <h2 className="text-[19px] font-semibold leading-tight">{title}</h2>}
            {description && <p className="mt-1 text-[14px] text-muted">{description}</p>}
          </header>
        )}
        <div className="max-h-[80vh] overflow-y-auto px-5 pt-3 pb-5">{children}</div>
      </div>
    </div>
  );
}
