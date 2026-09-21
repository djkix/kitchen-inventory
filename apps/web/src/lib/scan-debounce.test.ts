import { describe, expect, it } from 'vitest';
import { createScanGate, normalizeBarcode } from './scan-debounce';

describe('createScanGate', () => {
  it('ne traite un code qu’une fois tant qu’il reste devant l’objectif', () => {
    const gate = createScanGate(2000);
    expect(gate.offer(['3017620422003'], 0)).toBe('3017620422003');
    expect(gate.offer(['3017620422003'], 100)).toBeNull();
    expect(gate.offer(['3017620422003'], 5000)).toBeNull();
  });

  it('réaccepte un code une fois qu’il a quitté le champ et la fenêtre écoulée', () => {
    const gate = createScanGate(2000);
    gate.offer(['A'], 0);
    gate.offer([], 2500);
    expect(gate.offer(['A'], 2600)).toBe('A');
  });

  it('ignore un scintillement : code absent d’une image, mais fenêtre non écoulée', () => {
    const gate = createScanGate(2000);
    gate.offer(['A'], 0);
    gate.offer([], 100);
    expect(gate.offer(['A'], 200)).toBeNull();
  });

  it('ne réaccepte pas le même article après une pause de la détection', () => {
    // Le bug : le tiroir de validation coupe la détection, puis l'article est
    // toujours devant l'objectif à la reprise. Il ne doit pas être réajouté.
    const gate = createScanGate(2000);
    expect(gate.offer(['A'], 0)).toBe('A');
    // Détection suspendue pendant 10 s : aucune image n'est proposée.
    expect(gate.offer(['A'], 10_000)).toBeNull();
    expect(gate.offer(['A'], 12_000)).toBeNull();
  });

  it('accepte un autre code lu dans la même image, un seul par appel', () => {
    const gate = createScanGate(2000);
    expect(gate.offer(['A', 'B'], 0)).toBe('A');
    expect(gate.offer(['A', 'B'], 10)).toBe('B');
    expect(gate.offer(['A', 'B'], 20)).toBeNull();
  });

  it('repart de zéro après reset', () => {
    const gate = createScanGate(2000);
    gate.offer(['A'], 0);
    gate.reset();
    expect(gate.offer(['A'], 1)).toBe('A');
  });
});

describe('normalizeBarcode', () => {
  it('convertit un UPC-A en EAN-13 et garde EAN-8 / EAN-13', () => {
    expect(normalizeBarcode('012345678905')).toBe('0012345678905');
    expect(normalizeBarcode('3017620422003')).toBe('3017620422003');
    expect(normalizeBarcode(' 12345670 ')).toBe('12345670');
  });

  it('rejette les contenus non numériques ou de longueur inattendue (QR d’URL, etc.)', () => {
    expect(normalizeBarcode('https://exemple.fr')).toBeNull();
    expect(normalizeBarcode('12345')).toBeNull();
  });
});
