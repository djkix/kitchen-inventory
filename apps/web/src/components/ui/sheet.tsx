import { useEffect, useId, useRef, type ReactNode } from 'react';
import { cn } from '../../lib/cn';

/**
 * Pile des tiroirs qui s'appuient sur l'entrée d'historique, du plus ancien au
 * plus récent. Un `popstate` est entendu par TOUS les tiroirs ouverts : sans
 * cette pile, ouvrir un tiroir par-dessus un autre puis revenir en arrière les
 * fermerait tous les deux d'un coup. Seul celui du dessus réagit.
 */
const openSheets: string[] = [];

/** Clé posée dans `history.state` pour reconnaître l'entrée des tiroirs. */
const MARKER = 'kitchenSheet';

/**
 * **Une seule** entrée d'historique pour toute la pile, et non une par tiroir.
 * Un tiroir qui en remplace un autre — « Code-barres inconnu » puis « Nouveau
 * produit », au scan — démonte le premier avant de monter le second : avec une
 * entrée par tiroir, celle du premier était dépilée (`history.back()` est
 * asynchrone) APRÈS que le second eut posé la sienne, et le second se fermait
 * aussitôt sur ce `popstate`. Les deux parcours de rangement cassés par la CI
 * du 2026-10-19 viennent exactement de là.
 */
let entryPushed = false;

function pushEntry() {
  if (entryPushed) return;
  // L'état du routeur (`usr`, `key`, `idx`) est conservé : l'entrée porte la
  // même adresse que la page en dessous, seule la marque s'y ajoute.
  window.history.pushState({ ...window.history.state, [MARKER]: true }, '');
  entryPushed = true;
}

/** Retire l'entrée dès que plus aucun tiroir ne s'en sert — et seulement si elle est encore au sommet. */
function dropEntryIfUnused() {
  if (openSheets.length > 0 || !entryPushed) return;
  entryPushed = false;
  // Une navigation volontaire (conserver une suggestion mène à sa fiche) a
  // déjà empilé la sienne par-dessus : la dépiler mangerait ce passage.
  if ((window.history.state as Record<string, unknown> | null)?.[MARKER] === true) window.history.back();
}

interface SheetProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  description?: string;
  children: ReactNode;
  /** Empêche la fermeture par le fond ou Échap (par exemple pendant un envoi). */
  locked?: boolean;
  className?: string;
}

/**
 * Tiroir ancré en bas : les actions restent dans le tiers inférieur de l'écran (section 8).
 * Fermeture par le fond, par Échap, et par le bouton de fermeture.
 */
export function Sheet({ open, onClose, title, description, children, locked = false, className }: SheetProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const id = useId();
  // Lus par un gestionnaire qui ne doit PAS se réabonner à chaque rendu :
  // réexécuter l'effet empilerait une seconde entrée d'historique.
  const lockedRef = useRef(locked);
  const onCloseRef = useRef(onClose);
  lockedRef.current = locked;
  onCloseRef.current = onClose;

  /**
   * Le geste « page précédente » ferme le tiroir au lieu de quitter l'écran
   * (le propriétaire, 2026-10-19 : « quand je swipe vers la gauche, au lieu d'avoir un
   * retour aux suggestions, je bascule sur Mes recettes »). Rien n'écoutait ce
   * glissement : c'est le navigateur qui remontait l'historique, puisque
   * l'ouverture d'un tiroir n'y ajoutait aucune entrée.
   *
   * À l'ouverture, la pile des tiroirs s'assure qu'une entrée est posée ; un
   * retour arrière la dépile et ferme le tiroir du dessus. Quand le dernier
   * tiroir se ferme autrement (croix, Échap, Annuler), l'entrée est retirée —
   * sans quoi un premier Retour ne ferait rien de visible et il en faudrait
   * deux pour quitter l'écran.
   *
   * L'effet ne dépend que de `open` : `locked` et `onClose` passent par des
   * références, parce qu'un réabonnement rejouerait tout l'enchaînement.
   */
  useEffect(() => {
    if (!open) return;
    openSheets.push(id);
    pushEntry();

    const onPop = () => {
      if (openSheets[openSheets.length - 1] !== id) return;
      // Le navigateur vient de dépiler l'entrée commune.
      entryPushed = false;
      // Envoi en cours : on la remet, le tiroir reste verrouillé.
      if (lockedRef.current) {
        pushEntry();
        return;
      }
      openSheets.pop();
      // Un tiroir reste ouvert en dessous : il lui faut son propre piège.
      if (openSheets.length > 0) pushEntry();
      onCloseRef.current();
    };

    window.addEventListener('popstate', onPop);
    return () => {
      window.removeEventListener('popstate', onPop);
      const index = openSheets.lastIndexOf(id);
      if (index >= 0) openSheets.splice(index, 1);
      // Différé d'un tour : un tiroir qui en remplace un autre est monté juste
      // après le démontage du premier, et reprend l'entrée au lieu d'en poser
      // une seconde. Retirer tout de suite la dépilerait sous ses pieds.
      setTimeout(dropEntryIfUnused, 0);
    };
  }, [open, id]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !locked) onClose();
    };
    document.addEventListener('keydown', onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [open, locked, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center" role="presentation">
      <button type="button" aria-label="Fermer" tabIndex={-1} onClick={locked ? undefined : onClose} className="absolute inset-0 bg-black/60" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cn('anim-sheet safe-bottom relative w-full max-w-lg rounded-t-sheet border-t border-line bg-surface shadow-2xl', className)}
      >
        <div className="mx-auto mt-2.5 h-1 w-10 rounded-full bg-line" aria-hidden />
        {(title || description) && (
          <header className="px-5 pt-3 pb-1">
            {title && <h2 className="text-[19px] font-semibold leading-tight">{title}</h2>}
            {description && <p className="mt-1 text-[14px] text-muted">{description}</p>}
          </header>
        )}
        <div className="max-h-[80vh] overflow-y-auto px-5 pt-3 pb-5">{children}</div>
      </div>
    </div>
  );
}
