import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GoogleSignInButton } from './google-sign-in-button';

interface InitOptions {
  client_id: string;
  callback: (response: { credential: string }) => void;
}

/** Doublure de `window.google.accounts.id` : le script réel ne se charge pas sous jsdom. */
/** Dernier appel à `initialize`, ou un échec explicite s'il n'a pas eu lieu. */
function lastInit(init: { mock: { calls: [InitOptions][] } }): InitOptions {
  const call = init.mock.calls.at(-1);
  if (!call) throw new Error('google.accounts.id.initialize n’a pas été appelé');
  return call[0];
}

function stubGoogle() {
  const init = vi.fn<(options: InitOptions) => void>();
  const renderButton = vi.fn<(parent: HTMLElement) => void>((parent) => {
    const button = parent.ownerDocument.createElement('button');
    button.textContent = 'Se connecter avec Google';
    parent.appendChild(button);
  });
  Object.defineProperty(window, 'google', {
    configurable: true,
    writable: true,
    value: { accounts: { id: { initialize: init, renderButton } } },
  });
  return { init, renderButton };
}

describe('GoogleSignInButton', () => {
  beforeEach(() => {
    Reflect.deleteProperty(window, 'google');
  });

  it('initialise Google avec le Client ID reçu à l’exécution et pose le bouton', async () => {
    const { init, renderButton } = stubGoogle();

    render(<GoogleSignInButton clientId="123-abc.apps.googleusercontent.com" onCredential={vi.fn()} />);

    await waitFor(() => expect(init).toHaveBeenCalledTimes(1));
    expect(lastInit(init).client_id).toBe('123-abc.apps.googleusercontent.com');
    expect(renderButton).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole('button', { name: /google/i })).toBeTruthy();
  });

  it('remonte le jeton rendu par le callback de Google', async () => {
    const { init } = stubGoogle();
    const onCredential = vi.fn();

    render(<GoogleSignInButton clientId="abc" onCredential={onCredential} />);

    await waitFor(() => expect(init).toHaveBeenCalledTimes(1));
    lastInit(init).callback({ credential: 'jeton-google' });
    expect(onCredential).toHaveBeenCalledWith('jeton-google');
  });
});
