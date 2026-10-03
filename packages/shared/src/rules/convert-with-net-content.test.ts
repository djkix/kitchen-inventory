import { describe, expect, it } from 'vitest';
import { convertWithNetContent } from './coverage.js';

describe('convertWithNetContent', () => {
  it('convertit directement entre unités de la même famille, sans contenance', () => {
    expect(convertWithNetContent(1500, 'GRAM', 'KILOGRAM', null, null)).toBe(1.5);
  });

  it('ponte du conditionnement vers la mesure (paquets → grammes)', () => {
    expect(convertWithNetContent(3, 'PACK', 'GRAM', 500, 'GRAM')).toBe(1500);
  });

  it('ponte de la mesure vers le conditionnement, sens inverse (grammes → paquets)', () => {
    expect(convertWithNetContent(200, 'GRAM', 'PACK', 500, 'GRAM')).toBe(0.4);
  });

  it('fait l’aller-retour sans perte quand la division tombe juste', () => {
    const packs = convertWithNetContent(200, 'GRAM', 'PACK', 500, 'GRAM');
    expect(packs).toBe(0.4);
    expect(convertWithNetContent(packs!, 'PACK', 'GRAM', 500, 'GRAM')).toBe(200);
  });

  it('renvoie null sans contenance renseignée', () => {
    expect(convertWithNetContent(3, 'PACK', 'GRAM', null, null)).toBeNull();
    expect(convertWithNetContent(200, 'GRAM', 'PACK', null, null)).toBeNull();
  });

  it('ne ponte jamais entre masse et volume, même avec une contenance renseignée', () => {
    expect(convertWithNetContent(1, 'GRAM', 'LITER', 1, 'LITER')).toBeNull();
  });

  it('renvoie null quand la contenance ne partage la famille d’aucune des deux unités', () => {
    expect(convertWithNetContent(3, 'PACK', 'BOX', 500, 'GRAM')).toBeNull();
  });
});
