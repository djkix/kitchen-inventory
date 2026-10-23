import type { NutriscoreGrade } from '@kitchen/shared';
import { gradeColors } from '../../lib/nutrition-ui';
import { cn } from '../../lib/cn';

/**
 * Pastille Nutri-Score (EF-30), aux couleurs officielles. Elles sortent de la
 * palette du thème, qui réserve rouge, orange et ambre à la péremption : c'est
 * pourquoi la pastille reste petite et seule, sans l'échelle à cinq crans.
 */
export function NutriscoreBadge({ grade, size = 'md' }: { grade: NutriscoreGrade; size?: 'sm' | 'md' }) {
  return (
    <span
      style={gradeColors(grade)}
      className={cn(
        'flex shrink-0 items-center justify-center rounded-lg font-semibold uppercase',
        size === 'sm' ? 'size-6 text-[13px]' : 'size-8 text-[17px]',
      )}
      title={`Nutri-Score ${grade.toUpperCase()}`}
    >
      {grade}
    </span>
  );
}
