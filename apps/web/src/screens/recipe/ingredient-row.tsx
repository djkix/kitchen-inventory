import { INGREDIENT_STATE_LABELS_FR, type RecipeIngredientDto } from '@kitchen/shared';
import { LocationChip } from '../../components/ui/location-chip';
import { mediaUrl } from '../../lib/api';
import { cn } from '../../lib/cn';
import { formatQuantity } from '../../lib/quantity-ui';

const STATE_TEXT_LOOK: Record<RecipeIngredientDto['state'], string> = {
  available: 'text-muted',
  insufficient: 'text-warn',
  unverifiable: 'text-faint',
  missing: 'text-danger',
  untracked: 'text-faint',
};

/** `candidates` ne sert qu'au choix à la cuisson (tâche 17) : jamais lu par cette fiche. */
type DisplayedIngredient = Omit<RecipeIngredientDto, 'candidates'>;

/** Détail de l'état (section 15) : dire POURQUOI une ligne n'est pas disponible, jamais seulement l'étiquette brute. */
function stateDetail(ingredient: DisplayedIngredient): string {
  if (ingredient.state === 'insufficient' && ingredient.quantity !== null && ingredient.unit !== null) {
    const available = formatQuantity(ingredient.availableQuantity ?? 0, ingredient.unit);
    const required = formatQuantity(ingredient.quantity, ingredient.unit);
    return `${INGREDIENT_STATE_LABELS_FR.insufficient} : ${available} sur ${required}`;
  }
  if (ingredient.state === 'unverifiable') {
    return `${INGREDIENT_STATE_LABELS_FR.unverifiable} : la quantité en stock ne peut pas être comparée à l’unité de la recette`;
  }
  return INGREDIENT_STATE_LABELS_FR[ingredient.state];
}

interface IngredientRowProps {
  ingredient: DisplayedIngredient;
}

/** Ligne d'ingrédient de la fiche recette (EF-23) : état face au stock réel, jamais recalculé ici. */
export function IngredientRow({ ingredient }: IngredientRowProps) {
  const untracked = ingredient.state === 'untracked';
  const showsOwnQuantity = ingredient.state !== 'insufficient';
  const imageUrl = mediaUrl(ingredient.productImagePath);

  return (
    <li className={cn('flex items-start gap-3 px-4 py-3', untracked && 'opacity-50')}>
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5 text-[15px] leading-tight">
          <span className="truncate">{ingredient.label}</span>
          {ingredient.essential && (
            <span aria-label="Ingrédient essentiel" title="Ingrédient essentiel" className="shrink-0 text-accent">
              ●
            </span>
          )}
        </p>
        {showsOwnQuantity && ingredient.quantity !== null && ingredient.unit !== null && (
          <p className="tnum text-[13px] text-muted">{formatQuantity(ingredient.quantity, ingredient.unit)}</p>
        )}
        <p className={cn('text-[13px]', STATE_TEXT_LOOK[ingredient.state])}>{stateDetail(ingredient)}</p>
        {ingredient.locationName && (
          <p className="mt-1">
            <LocationChip name={ingredient.locationName} temperature={ingredient.locationTemperature} />
          </p>
        )}
      </div>
      {imageUrl && (
        <img
          src={imageUrl}
          alt=""
          loading="lazy"
          className="ml-auto h-12 w-12 shrink-0 rounded-card object-cover"
        />
      )}
    </li>
  );
}
