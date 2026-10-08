import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { LocationChip } from './location-chip';

describe('LocationChip', () => {
  it('écrit le nom de l’emplacement, la couleur ne porte jamais seule l’information', () => {
    render(<LocationChip name="Réfrigérateur" temperature="chilled" />);
    expect(screen.getByText('Réfrigérateur')).toBeTruthy();
  });

  it('reste lisible sans température renseignée', () => {
    const { container } = render(<LocationChip name="Cellier" temperature={null} />);
    expect(screen.getByText('Cellier')).toBeTruthy();
    expect(container.firstElementChild?.className).toBeTruthy();
  });

  /**
   * Round de correction 1 : l'`ambient` utilisait `bg-surface`, exactement le
   * fond du conteneur qui enveloppe la liste d'ingrédients dans
   * `recipe-screen.tsx` — la pastille y était invisible.
   *
   * Portée exacte de ce test, pour qu'on ne lui prête pas plus : il compare des
   * NOMS DE CLASSES, pas des couleurs rendues. Il rattrape le retour littéral
   * de `bg-surface` ou `bg-raised` sur une pastille ; il ne verrait pas une
   * variable de thème redéfinie à la même valeur, ni une classe arbitraire
   * produisant le même fond. Vérifier la couleur effective demanderait un
   * rendu réel avec résolution des variables CSS, qu'aucun test du projet ne
   * fait aujourd'hui.
   */
  it.each(['ambient', 'chilled', 'frozen'] as const)('%s se détache des deux conteneurs connus (bg-surface, bg-raised)', (temperature) => {
    const { container } = render(<LocationChip name="Test" temperature={temperature} />);
    const className = container.firstElementChild?.className ?? '';
    expect(className).not.toMatch(/(^|\s)bg-surface(\s|$)/);
    expect(className).not.toMatch(/(^|\s)bg-raised(\s|$)/);
  });
});
