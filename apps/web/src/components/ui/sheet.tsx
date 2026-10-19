import { useEffect, useId, useRef, type ReactNode } from 'react';
import { cn } from '../../lib/cn';

/**
 * Pile des tiroirs qui ont posé une entrée d'historique, du plus ancien au
 * plus récent. Un `popstate` est entendu par TOUS les tiroirs ouverts : sans
 * cette pile, ouvrir un tiroir par-dessus un autre puis revenir en arrière
 * les fermerait tous les deux d'un coup. Seul celui du dessus réagit.
 */
const openSheets: string[] = [];

/** Clé posée dans `history.state` pour reconnaître l'entrée d'un tiroir. */
const MARKER = 'kitchenSheet';

function pushMarker(id: string) {
  // L'état du routeur (`usr`, `key`, `idx`) est conservé : l'entrée porte la
  // même adresse que la page en dessous, seule la marque s'y ajoute.
  window.history.pushState({ ...window.history.state, [MARKER]: id }, '');
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
   * (Franck, 2026-10-19 : « quand je swipe vers la gauche, au lieu d'avoir un
   * retour aux suggestions, je bascule sur Mes recettes »). Rien n'écoutait ce
   * glissement : c'est le navigateur qui remontait l'historique, puisque
   * l'ouverture d'un tiroir n'y ajoutait aucune entrée.
   *
   * À l'ouverture, le tiroir empile donc une entrée ; un retour arrière la
   * dépile et le ferme. Fermé autrement (croix, Échap, Annuler), il retire son
   * entrée — sans quoi un premier Retour ne ferait rien de visible et il en
   * faudrait deux pour quitter l'écran.
   *
   * L'effet ne dépend que de `open` : `locked` et `onClose` passent par des
   * références, parce qu'un réabonnement empilerait une entrée de plus.
   */
  useEffect(() => {
    if (!open) return;
    openSheets.push(id);
    pushMarker(id);
    let closedByBack = false;

    const onPop = () => {
      if (openSheets[openSheets.length - 1] !== id) return;
      // Envoi en cours : on remet l'entrée, le tiroir reste verrouillé.
      if (lockedRef.current) {
        pushMarker(id);
        return;
      }
      closedByBack = true;
      openSheets.pop();
      onCloseRef.current();
    };

    window.addEventListener('popstate', onPop);
    return () => {
      window.removeEventListener('popstate', onPop);
      const index = openSheets.lastIndexOf(id);
      if (index >= 0) openSheets.splice(index, 1);
      // Une navigation volontaire (conserver une suggestion mène à la fiche)
      // a déjà empilé la sienne par-dessus : la dépiler mangerait le passage
      // à la fiche. On ne retire que notre propre entrée, restée au sommet.
      if (!closedByBack && (window.history.state as Record<string, unknown> | null)?.[MARKER] === id) window.history.back();
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
