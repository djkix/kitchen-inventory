import { useEffect } from 'react';
import { NavLink, useLocation } from 'react-router';
import { cn } from '../../lib/cn';
import { pathForRecipeTab, recipeTabForPath, writeRecipeTab } from './recipe-tab-storage';

/**
 * Bascule à deux volets, Suggestions et Mes recettes, en tête des deux écrans
 * du module recettes (tâche 9). Le volet actif se voit par la bordure, le
 * fond et le poids du texte — jamais par la seule couleur — et est annoncé
 * aux lecteurs d'écran par `aria-current` (posé automatiquement par
 * `NavLink`). Le dernier volet ouvert est mémorisé pour que l'onglet Recettes
 * de la barre du bas y retombe directement.
 */
export function RecipeTabSwitch() {
  const location = useLocation();

  useEffect(() => {
    writeRecipeTab(recipeTabForPath(location.pathname));
  }, [location.pathname]);

  return (
    <nav aria-label="Volet du module recettes" className="flex gap-2 px-4 pb-3">
      <NavLink to={pathForRecipeTab('suggestions')} end className={tabClassName}>
        Suggestions
      </NavLink>
      <NavLink to={pathForRecipeTab('bibliotheque')} className={tabClassName}>
        Mes recettes
      </NavLink>
    </nav>
  );
}

function tabClassName({ isActive }: { isActive: boolean }): string {
  return cn(
    'min-h-touch flex flex-1 items-center justify-center rounded-xl border px-3 text-center text-[15px]',
    isActive ? 'border-accent bg-accent-deep font-semibold text-accent' : 'border-line font-medium text-muted',
  );
}
