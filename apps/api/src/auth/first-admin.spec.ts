import { describe, expect, it } from 'vitest';
import { firstAdminAllowed } from './auth.service.js';

describe('firstAdminAllowed', () => {
  it('n’autorise que l’adresse désignée quand ADMIN_EMAIL est posée', () => {
    const config = { ADMIN_EMAIL: 'moi@example.org', NODE_ENV: 'production' as const };
    expect(firstAdminAllowed(config, 'moi@example.org')).toBe(true);
    expect(firstAdminAllowed(config, 'autre@example.org')).toBe(false);
  });
  it('refuse toute création automatique en production sans ADMIN_EMAIL', () => {
    expect(firstAdminAllowed({ ADMIN_EMAIL: undefined, NODE_ENV: 'production' }, 'moi@example.org')).toBe(false);
  });
  it('garde le comportement historique en développement et en test', () => {
    expect(firstAdminAllowed({ ADMIN_EMAIL: undefined, NODE_ENV: 'development' }, 'moi@example.org')).toBe(true);
    expect(firstAdminAllowed({ ADMIN_EMAIL: undefined, NODE_ENV: 'test' }, 'moi@example.org')).toBe(true);
  });
});
