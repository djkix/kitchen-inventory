import { cn } from '../../lib/cn';

interface FavoriteStarProps {
  favorite: boolean;
  /** Titre de la recette : nomme l'étoile (plusieurs recettes se côtoient dans une liste, EF-23). */
  recipeTitle: string;
  onToggle: () => void;
  disabled?: boolean;
  className?: string;
}

/**
 * Étoile de favori (A2, D4) : bouton bascule réutilisé par la carte de
 * « Mes recettes » et par la fiche recette, pour que les deux emplacements ne
 * divergent jamais dans leur comportement. L'état coché se distingue par la
 * forme (étoile pleine contre étoile vide), jamais par la seule couleur, et
 * il est annoncé par `aria-pressed`.
 */
export function FavoriteStar({ favorite, recipeTitle, onToggle, disabled, className }: FavoriteStarProps) {
  return (
    <button
      type="button"
      aria-pressed={favorite}
      aria-label={`Favori : ${recipeTitle}`}
      disabled={disabled}
      onClick={(event) => {
        // La carte entière est un lien de navigation (`recipes-screen.tsx`) :
        // sans ceci, cocher le favori déclencherait aussi l'ouverture de la
        // fiche, le clic remontant jusqu'à l'ancre qui enveloppe la carte.
        event.preventDefault();
        event.stopPropagation();
        onToggle();
      }}
      className={cn(
        'min-h-touch min-w-touch shrink-0 rounded-xl text-[22px] leading-none disabled:opacity-50',
        favorite ? 'text-accent' : 'text-faint',
        className,
      )}
    >
      {favorite ? '★' : '☆'}
    </button>
  );
}
