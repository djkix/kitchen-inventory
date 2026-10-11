import { DISH_TYPES, DISH_TYPE_LABELS_FR, type DishType } from '@kitchen/shared';
import { useState } from 'react';
import { cn } from '../../lib/cn';

/**
 * Question bloquante posée à l'entrée de l'écran Suggestions (section 12,
 * EF-25, décision D2 du 2026-10-11) : tant qu'aucun type n'est choisi, ni
 * liste, ni squelette, ni barre de filtres ne sont affichés. Franck a choisi
 * cette variante en connaissant son coût — une tape de plus à chaque visite.
 *
 * Les sept types sont ceux de la taxonomie existante (`DISH_TYPES`), affichés
 * en grille de deux colonnes pour tenir sans défilement sur un téléphone
 * (375 px) tout en restant atteignables au pouce (`min-h-touch`).
 */
export function DishTypeQuestion({ onSelect }: { onSelect: (dishType: DishType) => void }) {
  return (
    <div className="flex flex-col gap-4 px-4 py-6">
      <div>
        <h2 className="text-[17px] font-semibold">Que cherchez-vous ?</h2>
        <p className="mt-1 text-[14px] text-muted">Choisissez un type de plat pour démarrer la recherche de recettes.</p>
      </div>
      <div role="group" aria-label="Type de plat" className="grid grid-cols-2 gap-2">
        {DISH_TYPES.map((type) => (
          <DishTypeButton key={type} dishType={type} onClick={() => onSelect(type)} />
        ))}
      </div>
    </div>
  );
}

function DishTypeButton({ dishType, onClick }: { dishType: DishType; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'min-h-touch rounded-xl border border-line bg-raised px-3 text-[15px] font-medium text-fg active:border-accent active:bg-accent-deep active:text-accent',
      )}
    >
      {DISH_TYPE_LABELS_FR[dishType]}
    </button>
  );
}

/**
 * Réponse à la question, en mémoire pour la durée de la session de
 * l'application (tâche 2, pièges du retour depuis une fiche de recette et du
 * rafraîchissement de fournée).
 *
 * Volontairement hors de React (variable de module plutôt que contexte ou
 * stockage navigateur) : `/recettes` et `/recettes/:id` sont deux routes
 * distinctes, l'écran se démonte donc en visitant une recette créée puis se
 * remonte au retour — un simple `useState` local oublierait la réponse à
 * cette occasion, ce qui obligerait à répondre deux fois pour une seule
 * intention. Une variable de module survit à ce remontage car le module
 * reste chargé tant que l'application tourne, mais s'efface à un
 * rechargement complet (nouvelle visite, coût accepté par la décision D2) :
 * pas de `localStorage`/`sessionStorage`, qui survivraient trop longtemps et
 * finiraient par ne plus jamais reposer la question.
 */
let answeredDishType: DishType | null = null;

export function useDishTypeAnswer() {
  const [dishType, setDishType] = useState<DishType | null>(answeredDishType);

  const answer = (type: DishType) => {
    answeredDishType = type;
    setDishType(type);
  };

  /** A5 : revenir à la question pour repartir d'un autre type, sans recharger l'application. */
  const askAgain = () => {
    answeredDishType = null;
    setDishType(null);
  };

  return { dishType, answer, askAgain };
}

/** Réservé aux tests : isole les scénarios qui, sinon, partageraient la réponse mémorisée. */
export function resetDishTypeAnswerForTests(): void {
  answeredDishType = null;
}
