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
        // Défense en profondeur : la carte de « Mes recettes » pose cette
        // étoile à côté du lien de navigation, jamais dedans (un bouton dans
        // une ancre est du HTML invalide, mal exploré au doigt par les
        // lecteurs d'écran mobiles — `recipes-screen.tsx`). `stopPropagation`
        // protège quand même un futur écran qui réutiliserait ce composant à
        // l'intérieur d'un conteneur cliquable.
        event.preventDefault();
        event.stopPropagation();
        onToggle();
      }}
      className={cn(
        // `pointer-events-auto` : la carte qui pose cette étoile est elle-même
        // `pointer-events-none` (le clic traverse jusqu'au lien de navigation
        // posé derrière elle), sauf ici, où l'étoile doit rester cliquable.
        'pointer-events-auto min-h-touch min-w-touch shrink-0 rounded-xl text-[22px] leading-none disabled:opacity-50',
        favorite ? 'text-accent' : 'text-faint',
        className,
      )}
    >
      {favorite ? '★' : '☆'}
    </button>
  );
}
