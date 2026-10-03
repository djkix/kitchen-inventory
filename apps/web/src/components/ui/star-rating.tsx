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
 */
export function StarRating({ value, onChange, disabled, className }: StarRatingProps) {
  return (
    <div role="radiogroup" aria-label="Note" className={cn('flex items-center justify-center gap-1', className)}>
      {STAR_VALUES.map((star) => (
        <button
          key={star}
          type="button"
          role="radio"
          aria-checked={value === star}
          aria-label={`${star} étoile${star > 1 ? 's' : ''}`}
          onClick={() => onChange(star)}
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
