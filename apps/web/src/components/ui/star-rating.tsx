import type { KeyboardEvent } from 'react';
import { cn } from '../../lib/cn';

export const STAR_VALUES = [1, 2, 3, 4, 5] as const;

interface StarRatingProps {
  value: number | null;
  onChange: (value: number) => void;
  disabled?: boolean;
  className?: string;
}

/**
 * Sélecteur de note à cinq étoiles (EF-28) : un seul contrôle, partagé par la
 * notation d'une réalisation (tâche 15) et le tiroir de cuisson (tâche 17),
 * pour que les deux ne divergent pas au fil des évolutions. Groupe de boutons
 * radio (et non de simples boutons) : une seule valeur possible à la fois.
 *
 * Le groupe se parcourt au clavier comme un vrai groupe radio : une seule
 * tabulation pour y entrer, puis les flèches pour changer de note. Sans cela,
 * cinq étoiles coûteraient cinq tabulations et les flèches ne feraient rien.
 */
export function StarRating({ value, onChange, disabled, className }: StarRatingProps) {
  // L'étoile qui reçoit le focus à la tabulation : celle qui est cochée, sinon
  // la première, pour qu'un groupe encore vierge reste atteignable.
  const focusable = value === null ? STAR_VALUES[0] : value;

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, star: number): void => {
    const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1
      : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1
        : 0;
    if (step === 0) return;
    event.preventDefault();
    const next = Math.min(STAR_VALUES.length, Math.max(1, star + step));
    onChange(next);
    event.currentTarget.parentElement?.querySelectorAll('button')[next - 1]?.focus();
  };

  return (
    <div role="radiogroup" aria-label="Note" className={cn('flex items-center justify-center gap-1', className)}>
      {STAR_VALUES.map((star) => (
        <button
          key={star}
          type="button"
          role="radio"
          aria-checked={value === star}
          aria-label={`${star} étoile${star > 1 ? 's' : ''}`}
          tabIndex={star === focusable ? 0 : -1}
          onClick={() => onChange(star)}
          onKeyDown={(event) => onKeyDown(event, star)}
          disabled={disabled}
          className={cn(
            'min-h-touch min-w-touch rounded-xl text-[32px] leading-none disabled:opacity-50',
            value !== null && star <= value ? 'text-accent' : 'text-faint',
          )}
        >
          ★
        </button>
      ))}
    </div>
  );
}
