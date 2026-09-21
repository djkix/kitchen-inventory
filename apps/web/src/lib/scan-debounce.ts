/**
 * Filtre des lectures de code-barres en mode rafale.
 *
 * La caméra relit le même code plusieurs fois par seconde, et la détection est
 * suspendue pendant qu'un tiroir de validation est ouvert. Un code déjà traité
 * n'est donc réaccepté que lorsque les deux conditions sont réunies : il a
 * quitté le champ de la caméra, et le délai de garde est écoulé. La seconde
 * condition seule laissait réajouter l'article resté devant l'objectif ; la
 * première seule laissait passer un scintillement d'une image.
 */
export interface ScanGate {
  /** Codes lus sur l'image courante ; renvoie celui à traiter, ou `null`. */
  offer(codes: readonly string[], now?: number): string | null;
  reset(): void;
}

export function createScanGate(cooldownMs = 2000): ScanGate {
  /** Dernier traitement par code. */
  const handledAt = new Map<string, number>();
  /** Codes traités qui n'ont pas encore quitté le champ. */
  const stillInView = new Set<string>();

  return {
    offer(codes, now = Date.now()) {
      for (const code of [...stillInView]) {
        if (!codes.includes(code)) stillInView.delete(code);
      }
      // Purge des codes anciens et absents, pour ne pas croître sur une longue session.
      for (const [code, seenAt] of handledAt) {
        if (!stillInView.has(code) && now - seenAt > cooldownMs * 30) handledAt.delete(code);
      }
      for (const code of codes) {
        const last = handledAt.get(code);
        const accepted = last === undefined || (!stillInView.has(code) && now - last >= cooldownMs);
        if (!accepted) continue;
        handledAt.set(code, now);
        stillInView.add(code);
        return code;
      }
      return null;
    },
    reset() {
      handledAt.clear();
      stillInView.clear();
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
