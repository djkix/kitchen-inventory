import type { Unit } from '@kitchen/shared';
import { useEffect, useState } from 'react';
import { Button } from '../../components/ui/button';
import { CheckIcon } from '../../components/ui/icons';
import { formatQuantity } from '../../lib/quantity-ui';

export interface LastAdded {
  itemId: string;
  name: string;
  quantity: number;
  unit: Unit;
  /** Delta appliqué par l'ajout, pour l'annulation. */
  appliedDelta: number;
  /** Vrai si l'entrée a rejoint un lot existant (même date). */
  merged: boolean;
  /** Vrai une fois la date renseignée depuis le bandeau. */
  dated: boolean;
  createdAt: number;
}

interface LastAddedBannerProps {
  lastAdded: LastAdded | null;
  onUndo: (entry: LastAdded) => void;
  onSetDate: (entry: LastAdded) => void;
  windowMs?: number;
}

/** Bandeau bas « Ajouté : … » avec annulation pendant 5 s, sans ouvrir de fiche (section 8). */
export function LastAddedBanner({ lastAdded, onUndo, onSetDate, windowMs = 5000 }: LastAddedBannerProps) {
  const [, force] = useState(0);

  useEffect(() => {
    if (!lastAdded) return;
    const remaining = lastAdded.createdAt + windowMs - Date.now();
    if (remaining <= 0) return;
    const timer = window.setTimeout(() => force((n) => n + 1), remaining + 20);
    return () => window.clearTimeout(timer);
  }, [lastAdded, windowMs]);

  if (!lastAdded) return null;
  const undoable = Date.now() - lastAdded.createdAt < windowMs;

  return (
    <div className="pointer-events-auto mx-4 flex items-center gap-3 rounded-2xl border border-accent/40 bg-ink/95 px-4 py-3 shadow-xl backdrop-blur">
      <CheckIcon size={22} className="shrink-0 text-accent" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[15px] font-medium">
          Ajouté : {lastAdded.name}
          {lastAdded.merged && <span className="text-muted"> (lot existant)</span>}
        </p>
        <p className="tnum text-[13px] text-muted">
          {formatQuantity(lastAdded.quantity, lastAdded.unit)}
          {lastAdded.dated && ' · date enregistrée'}
        </p>
      </div>
      {!lastAdded.dated && (
        <Button size="sm" variant="outline" onClick={() => onSetDate(lastAdded)}>
          + DLC
        </Button>
      )}
      {undoable && (
        <Button size="sm" variant="ghost" className="text-accent" onClick={() => onUndo(lastAdded)}>
          Annuler
        </Button>
      )}
    </div>
  );
}
