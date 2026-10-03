import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(() => {
  cleanup();
});

/**
 * L'environnement jsdom de Vitest 4 ne recopie pas `localStorage` sur
 * `globalThis` (absent de sa liste de clés à exposer), alors que jsdom
 * lui-même le fournit bien sur sa propre fenêtre. Sans ce correctif, un test
 * qui appelle `localStorage` directement (comme un vrai navigateur le permet)
 * échoue avec « Cannot read properties of undefined ».
 */
if (typeof globalThis.localStorage === 'undefined') {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    get: () => (globalThis as unknown as { jsdom?: { window: { localStorage: Storage } } }).jsdom?.window?.localStorage,
  });
}
