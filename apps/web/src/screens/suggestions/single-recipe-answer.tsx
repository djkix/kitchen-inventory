import type { SingleRecipeDto, SuggestionDto } from '@kitchen/shared';
import { SuggestionCard, suggestionAccessibleName } from './suggestion-card';

/**
 * La réponse à une demande en langage naturel (spécification du 2026-11-24),
 * partagée par les deux entrées : la phrase tapée et la demande parlée.
 *
 * L'ordre est celui de la lecture : ce que le modèle a compris, puis ses
 * remarques, puis la recette. La lecture d'abord, toujours — c'est elle qui
 * permet de reconnaître un contresens avant de lire une recette à côté de la
 * plaque (D2). Elle n'est affichée que pour la demande parlée (`showHeard`) :
 * par écrit, la phrase est déjà à l'écran.
 *
 * Les remarques sont ici **et** dans le tiroir : ici parce qu'elles sont la
 * moitié de ce qu'on est venu chercher, dans le tiroir parce qu'on y lit les
 * ingrédients qu'elles expliquent.
 */
export function SingleRecipeAnswer({
  answer,
  showHeard,
  onSelect,
}: {
  answer: SingleRecipeDto;
  showHeard: boolean;
  onSelect: (suggestion: SuggestionDto) => void;
}) {
  const { ingredients, orientation } = answer.heard;
  return (
    <>
      {showHeard && (
        <div data-testid="lecture-du-modele" className="mx-4 mb-3 rounded-card bg-raised px-4 py-3 text-[14px] leading-snug">
          <p className="font-medium">Ce que j’ai compris</p>
          <p className="text-muted">
            {ingredients.length > 0 ? ingredients.join(', ') : 'aucun ingrédient nommé'}
            {orientation ? ` · ${orientation}` : ''}
          </p>
        </div>
      )}

      {answer.recipe.notes && <p className="mx-4 mb-3 text-[14px] leading-snug text-muted">{answer.recipe.notes}</p>}

      <div className="px-4 pb-6">
        <button
          type="button"
          aria-label={suggestionAccessibleName(answer.recipe)}
          className="block w-full text-left"
          onClick={() => onSelect(answer.recipe)}
        >
          <SuggestionCard suggestion={answer.recipe} />
        </button>
      </div>
    </>
  );
}

/**
 * Un résultat de demande différée écrit AVANT le 2026-11-24 porte l'ancienne
 * forme — une fournée, avec `items` — et il est relu tel quel depuis la base.
 * Le reconnaître évite de lire `recipe.title` sur `undefined`.
 */
export function isSingleRecipeAnswer(result: unknown): result is SingleRecipeDto {
  return typeof result === 'object' && result !== null && 'recipe' in result && (result as { recipe: unknown }).recipe !== null;
}
