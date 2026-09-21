/**
 * Session de scan (EF-06) : l'emplacement courant est « collant », il survit
 * au rechargement de la page et aux allers-retours entre écrans.
 */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const SCAN_LOCATION_KEY = 'kitchen.scan.locationId';
export const SCAN_LOCATION_NAME_KEY = 'kitchen.scan.locationName';

export interface ScanLocation {
  id: string;
  name: string;
}

function safeStorage(storage?: StorageLike): StorageLike | null {
  if (storage) return storage;
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

export function readScanLocation(storage?: StorageLike): ScanLocation | null {
  const store = safeStorage(storage);
  if (!store) return null;
  try {
    const id = store.getItem(SCAN_LOCATION_KEY);
    const name = store.getItem(SCAN_LOCATION_NAME_KEY);
    if (!id) return null;
    return { id, name: name ?? '' };
  } catch {
    return null;
  }
}

export function writeScanLocation(location: ScanLocation | null, storage?: StorageLike): void {
  const store = safeStorage(storage);
  if (!store) return;
  try {
    if (!location) {
      store.removeItem(SCAN_LOCATION_KEY);
      store.removeItem(SCAN_LOCATION_NAME_KEY);
      return;
    }
    store.setItem(SCAN_LOCATION_KEY, location.id);
    store.setItem(SCAN_LOCATION_NAME_KEY, location.name);
  } catch {
    /* stockage plein ou interdit : l'emplacement reste en mémoire pour la session en cours */
  }
}

/**
 * Vérifie que l'emplacement mémorisé existe toujours dans l'arbre reçu de l'API
 * (il a pu être supprimé depuis un autre téléphone) et rafraîchit son nom.
 */
export function reconcileScanLocation(saved: ScanLocation | null, known: ReadonlyArray<{ id: string; name: string }>): ScanLocation | null {
  if (!saved) return null;
  const match = known.find((location) => location.id === saved.id);
  return match ? { id: match.id, name: match.name } : null;
}
