import { describe, expect, it } from 'vitest';
import { readScanLocation, reconcileScanLocation, writeScanLocation, type StorageLike } from './scan-session';

function memoryStorage(): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
  };
}

describe('scan-session', () => {
  it('persiste et relit l’emplacement courant', () => {
    const storage = memoryStorage();
    writeScanLocation({ id: 'loc-1', name: 'Placard' }, storage);
    expect(readScanLocation(storage)).toEqual({ id: 'loc-1', name: 'Placard' });
  });

  it('efface l’emplacement quand on écrit null', () => {
    const storage = memoryStorage();
    writeScanLocation({ id: 'loc-1', name: 'Placard' }, storage);
    writeScanLocation(null, storage);
    expect(readScanLocation(storage)).toBeNull();
    expect(storage.data.size).toBe(0);
  });

  it('renvoie null sans identifiant mémorisé', () => {
    expect(readScanLocation(memoryStorage())).toBeNull();
  });

  it('survit à un stockage qui lève une exception', () => {
    const broken: StorageLike = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('QuotaExceeded');
      },
      removeItem: () => undefined,
    };
    expect(() => writeScanLocation({ id: 'x', name: 'y' }, broken)).not.toThrow();
    expect(readScanLocation(broken)).toBeNull();
  });

  it('oublie un emplacement supprimé et rafraîchit le nom d’un emplacement renommé', () => {
    const known = [{ id: 'loc-1', name: 'Placard haut' }];
    expect(reconcileScanLocation({ id: 'loc-1', name: 'Placard' }, known)).toEqual({ id: 'loc-1', name: 'Placard haut' });
    expect(reconcileScanLocation({ id: 'loc-2', name: 'Cave' }, known)).toBeNull();
    expect(reconcileScanLocation(null, known)).toBeNull();
  });
});
