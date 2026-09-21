/**
 * Anti-rebond par code : en mode rafale, la caméra relit le même code-barres
 * plusieurs fois par seconde ; un code n'est accepté qu'une fois par fenêtre.
 */
export interface CodeDebouncer {
  accept(code: string, now?: number): boolean;
  reset(): void;
}

export function createCodeDebouncer(windowMs = 2000): CodeDebouncer {
  const lastSeen = new Map<string, number>();
  return {
    accept(code, now = Date.now()) {
      const previous = lastSeen.get(code);
      // Nettoyage des entrées expirées pour ne pas croître sans fin sur une longue session.
      for (const [key, seenAt] of lastSeen) if (now - seenAt >= windowMs) lastSeen.delete(key);
      if (previous !== undefined && now - previous < windowMs) return false;
      lastSeen.set(code, now);
      return true;
    },
    reset() {
      lastSeen.clear();
    },
  };
}

/** Formats retenus (section 5, niveau 1) dans la nomenclature de BarcodeDetector. */
export const DETECTOR_FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'qr_code'] as const;

/** Mêmes formats dans la nomenclature de zxing-wasm. */
export const ZXING_FORMATS = ['EAN-13', 'EAN-8', 'UPC-A', 'UPC-E', 'QRCode'] as const;

/**
 * Normalise une lecture brute vers un code acceptable par `barcodeSchema` :
 * UPC-A à 12 chiffres devient EAN-13 par un zéro de tête ; UPC-E est laissé tel quel
 * (8 chiffres, comme un EAN-8, accepté par l'API).
 */
export function normalizeBarcode(raw: string): string | null {
  const digits = raw.trim();
  if (!/^\d+$/.test(digits)) return null;
  if (digits.length === 12) return `0${digits}`;
  if (digits.length === 8 || digits.length === 13 || digits.length === 14) return digits;
  return null;
}
