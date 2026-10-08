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
});
