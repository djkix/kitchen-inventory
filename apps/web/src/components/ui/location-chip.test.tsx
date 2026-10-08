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
   * `recipe-screen.tsx` — la pastille y était invisible. Ce test échoue si
   * l'une des trois pastilles redevient le fond de l'un des deux conteneurs
   * connus (`bg-surface` dans `recipe-screen.tsx`, `bg-raised` dans
   * `suggestion-sheet.tsx`).
   */
  it.each(['ambient', 'chilled', 'frozen'] as const)('%s se détache des deux conteneurs connus (bg-surface, bg-raised)', (temperature) => {
    const { container } = render(<LocationChip name="Test" temperature={temperature} />);
    const className = container.firstElementChild?.className ?? '';
    expect(className).not.toMatch(/(^|\s)bg-surface(\s|$)/);
    expect(className).not.toMatch(/(^|\s)bg-raised(\s|$)/);
  });
});
