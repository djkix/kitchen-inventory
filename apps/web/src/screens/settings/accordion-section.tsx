import type { ReactNode } from 'react';
import { ChevronIcon } from '../../components/ui/icons';

interface AccordionSectionProps {
  title: string;
  /**
   * Résumé lu sans déplier : quota du jour, nombre de comptes, seuil d'alerte…
   * Rend son propre élément (voir `SectionBadge`) ou `null` : une enveloppe
   * fournie ici réserverait une ligne vide le temps du chargement.
   */
  badge?: ReactNode;
  /**
   * Couleur de la puce, en hexadécimal. Volontairement passée ici plutôt que
   * prise dans les jetons du thème : ces teintes n'existent que sur l'écran
   * Réglages (choix de djkix, 2026-10-22, d'après la maquette). Les jetons
   * globaux réservent le rouge, l'orange et l'ambre à la péremption et les
   * bleus à la température de stockage — en faire des couleurs de section
   * ailleurs dans l'application brouillerait ces sens-là.
   */
  dotColor: string;
  children: ReactNode;
}

/**
 * Section pliable des Réglages, sur le `<details>` natif : l'ouverture, le
 * clavier et l'annonce aux lecteurs d'écran sont ceux du navigateur, sans état
 * React ni gestionnaire de clic. Replier n'efface rien — le contenu reste dans
 * le document, donc la recherche du navigateur le trouve toujours.
 *
 * Chaque section porte une puce de couleur, cantonnée à cet écran : elles
 * donnent le repère visuel qui manquait à une liste de cinq replis identiques.
 * Elles n'entrent pas dans les jetons du thème, et ne doivent apparaître nulle
 * part ailleurs — le reste de l'application garde ses couleurs pour la
 * péremption et la température de stockage, qui s'y lisent.
 */
export function AccordionSection({ title, badge, dotColor, children }: AccordionSectionProps) {
  return (
    <details className="group rounded-card bg-surface">
      <summary
        className="flex min-h-touch cursor-pointer list-none items-center gap-3 px-4 py-3 active:bg-raised [&::-webkit-details-marker]:hidden"
      >
        <span
          aria-hidden
          className="size-2 shrink-0 rounded-full"
          style={{ backgroundColor: dotColor, boxShadow: `0 0 8px ${dotColor}` }}
        />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="text-[15px] font-medium">{title}</span>
          {badge}
        </span>
        <ChevronIcon size={18} className="shrink-0 text-faint transition-transform group-open:rotate-90" />
      </summary>
      <div className="flex flex-col gap-2 px-3 pb-3">{children}</div>
    </details>
  );
}

/** Libellé de résumé d'un en-tête de section, à la même casse partout. */
export function SectionBadge({ children }: { children: ReactNode }) {
  return <span className="truncate text-[12px] text-muted">{children}</span>;
}
