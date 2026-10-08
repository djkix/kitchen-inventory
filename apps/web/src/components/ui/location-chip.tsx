import { cn } from '../../lib/cn';

type Temperature = 'ambient' | 'chilled' | 'frozen' | null;

/**
 * Trois jeux de classes distincts par température, plus un repli neutre pour
 * `null`. La palette du thème (`styles.css`) ne réserve qu'une seule teinte
 * hors nuances de gris (`accent`, céladon) — les trois autres couleurs
 * (`danger`, `warn`, `soon`) sont explicitement réservées à la péremption, pas
 * disponibles ici sans brouiller leur sens ailleurs dans l'application.
 * `chilled` reprend donc la teinte `accent` (le froid lui va), `ambient` et
 * `frozen` se distinguent par deux nuances de gris du thème plutôt que
 * d'inventer une couleur hors palette.
 */
const TEMPERATURE_LOOK: Record<NonNullable<Temperature> | 'unknown', string> = {
  ambient: 'bg-surface text-muted',
  chilled: 'bg-accent-deep text-accent',
  frozen: 'bg-line text-fg',
  unknown: 'bg-surface text-faint',
};

interface LocationChipProps {
  name: string;
  temperature: Temperature;
}

/**
 * Pastille nommant un emplacement (EF-23). La couleur ne porte jamais seule
 * l'information : le nom de l'emplacement est toujours écrit dans la pastille.
 */
export function LocationChip({ name, temperature }: LocationChipProps) {
  const look = TEMPERATURE_LOOK[temperature ?? 'unknown'];
  return (
    <span className={cn('inline-flex max-w-full items-center truncate rounded-full px-2 py-0.5 text-[12px]', look)}>{name}</span>
  );
}
