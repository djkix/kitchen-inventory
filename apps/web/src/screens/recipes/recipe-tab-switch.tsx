import { NavLink } from 'react-router';
import { cn } from '../../lib/cn';

/**
 * Bascule à deux volets, Suggestions et Mes recettes, en tête des deux écrans
 * du module recettes (tâche 9). Le volet actif se voit par la bordure, le
 * fond et le poids du texte — jamais par la seule couleur — et est annoncé
 * aux lecteurs d'écran par `aria-current` (posé automatiquement par
 * `NavLink`). Suggestions reste l'écran d'entrée du module, toujours (A1) :
 * aucun volet n'est mémorisé.
 */
export function RecipeTabSwitch() {
  return (
    <nav aria-label="Volet du module recettes" className="flex gap-2 px-4 pb-3">
      <NavLink to="/recettes" end className={tabClassName}>
        Suggestions
      </NavLink>
      <NavLink to="/recettes/bibliotheque" className={tabClassName}>
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
