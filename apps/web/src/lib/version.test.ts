import { describe, expect, it } from 'vitest';
import { versionState } from './version';

describe('versionState', () => {
  it('affiche la version du serveur quand elle est connue', () => {
    expect(versionState('0.4.1', '0.4.1')).toEqual({ label: '0.4.1', stale: false });
  });

  it('se rabat sur la version de l’interface tant que le serveur n’a pas répondu', () => {
    expect(versionState(undefined, '0.4.1')).toEqual({ label: '0.4.1', stale: false });
  });

  it('signale une interface servie depuis un cache périmé', () => {
    expect(versionState('0.4.1', '0.3.0')).toEqual({ label: '0.4.1', stale: true });
  });

  it('ne signale rien en développement, où les versions ne sont pas publiées', () => {
    expect(versionState('0.0.0-dev', 'dev').stale).toBe(false);
    expect(versionState('0.4.1', 'dev').stale).toBe(false);
  });
});
