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
  /** Ouverte à l'arrivée sur l'écran. Une seule l'est : « Reconnaissance ». */
  defaultOpen?: boolean;
  children: ReactNode;
}

/**
 * Section pliable des Réglages, sur le `<details>` natif : l'ouverture, le
 * clavier et l'annonce aux lecteurs d'écran sont ceux du navigateur, sans état
 * React ni gestionnaire de clic. Replier n'efface rien — le contenu reste dans
 * le document, donc la recherche du navigateur le trouve toujours.
 *
 * La puce ne porte pas de couleur propre : le thème réserve le rouge, l'orange
 * et l'ambre à la péremption, les bleus à la température de stockage et le
 * céladon aux actions (voir styles.css). Une puce décorative dans l'une de ces
 * teintes viderait de son sens la seule chose qui compte dans une application
 * de stock. Elle s'allume donc en céladon à l'ouverture, et reste sourde sinon.
 */
export function AccordionSection({ title, badge, defaultOpen = false, children }: AccordionSectionProps) {
  return (
    <details open={defaultOpen} className="group rounded-card bg-surface">
      <summary
        className="flex min-h-touch cursor-pointer list-none items-center gap-3 px-4 py-3 active:bg-raised [&::-webkit-details-marker]:hidden"
      >
        <span aria-hidden className="size-2 shrink-0 rounded-full bg-faint transition-colors group-open:bg-accent" />
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
