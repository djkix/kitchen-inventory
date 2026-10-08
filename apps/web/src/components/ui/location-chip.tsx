import type { ComponentType } from 'react';
import { cn } from '../../lib/cn';
import { DropletIcon, SnowflakeIcon, SunIcon, type IconProps } from './icons';

type Temperature = 'ambient' | 'chilled' | 'frozen' | null;

/**
 * Trois jeux de classes distincts par température, plus un repli neutre pour
 * `null` — ni la couleur ni la forme ne portent seules l'information
 * (Franck, round de correction 1) : chaque température a sa propre teinte
 * (`--color-chilled`/`--color-frozen`, ajoutées au thème dans `styles.css`,
 * distinctes des couleurs de péremption `danger`/`warn`/`soon`) et son propre
 * pictogramme décoratif (`aria-hidden`, porté par `icons.tsx`).
 *
 * La pastille doit se détacher de SES DEUX conteneurs connus
 * (`recipe-screen.tsx` : `bg-surface`, `suggestion-sheet.tsx` : `bg-raised`) —
 * d'où `ambient`, resté neutre, qui se distingue par une bordure plutôt qu'un
 * fond, et `bg-ink`, le plus sombre du thème, jamais utilisé comme fond de
 * conteneur de liste.
 */
const TEMPERATURE_LOOK: Record<NonNullable<Temperature> | 'unknown', { classes: string; Icon: ComponentType<IconProps> | null }> = {
  ambient: { classes: 'border border-line bg-ink text-muted', Icon: SunIcon },
  chilled: { classes: 'bg-chilled-deep text-chilled', Icon: DropletIcon },
  frozen: { classes: 'bg-frozen-deep text-frozen', Icon: SnowflakeIcon },
  unknown: { classes: 'border border-line bg-ink text-faint', Icon: null },
};

interface LocationChipProps {
  name: string;
  temperature: Temperature;
}

/**
 * Pastille nommant un emplacement (EF-23). La couleur ne porte jamais seule
 * l'information : le nom de l'emplacement est toujours écrit dans la pastille,
 * et le pictogramme de température (décoratif, `aria-hidden`) se lit avant la
 * couleur et de plus loin.
 */
export function LocationChip({ name, temperature }: LocationChipProps) {
  const { classes, Icon } = TEMPERATURE_LOOK[temperature ?? 'unknown'];
  return (
    <span className={cn('inline-flex max-w-full items-center gap-1 truncate rounded-full px-2 py-0.5 text-[12px]', classes)}>
      {Icon && <Icon size={13} className="shrink-0" />}
      <span className="truncate">{name}</span>
    </span>
  );
}
