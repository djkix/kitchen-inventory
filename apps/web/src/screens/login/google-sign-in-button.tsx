import { useEffect, useRef, useState } from 'react';

/** Seule la part de Google Identity Services réellement utilisée est déclarée. */
interface GoogleAccountsId {
  initialize(options: { client_id: string; callback: (response: { credential: string }) => void }): void;
  renderButton(parent: HTMLElement, options: Record<string, string | number>): void;
}

declare global {
  interface Window {
    google?: { accounts: { id: GoogleAccountsId } };
  }
}

const GSI_SRC = 'https://accounts.google.com/gsi/client';

/** Charge le script Google une seule fois, même si le composant est remonté. */
function loadGoogleScript(): Promise<void> {
  if (window.google?.accounts?.id) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${GSI_SRC}"]`);
    const script = existing ?? document.createElement('script');
    script.addEventListener('load', () => resolve(), { once: true });
    script.addEventListener('error', () => reject(new Error('script')), { once: true });
    if (!existing) {
      script.src = GSI_SRC;
      script.async = true;
      document.head.appendChild(script);
    }
  });
}

/**
 * Bouton « Se connecter avec Google » rendu par Google lui-même (flux jeton
 * d'identité, sans redirection). Le Client ID est passé par l'appelant, qui le
 * lit à l'exécution : une variable `import.meta.env` serait figée au build de
 * l'image et vide en production.
 */
export function GoogleSignInButton({ clientId, onCredential }: { clientId: string; onCredential: (credential: string) => void }) {
  const host = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  // Le callback posé dans `initialize` vit aussi longtemps que le script : il
  // lit la dernière fonction reçue plutôt que celle du premier rendu.
  const latest = useRef(onCredential);
  latest.current = onCredential;

  useEffect(() => {
    let cancelled = false;
    loadGoogleScript().then(
      () => {
        const id = window.google?.accounts?.id;
        if (cancelled || !id || !host.current) return;
        id.initialize({ client_id: clientId, callback: (response) => latest.current(response.credential) });
        // Largeur mesurée puis bornée : Google n'accepte que 200 à 400 px, et
        // l'application est utilisée en très grande majorité au téléphone.
        const width = Math.min(Math.max(host.current.clientWidth || 320, 200), 400);
        id.renderButton(host.current, { type: 'standard', theme: 'outline', size: 'large', shape: 'pill', text: 'continue_with', locale: 'fr', width });
      },
      () => {
        if (!cancelled) setFailed(true);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [clientId]);

  if (failed) {
    return (
      <p role="status" className="rounded-xl bg-raised px-3 py-2 text-center text-[14px] text-muted">
        Le service de connexion Google n’a pas pu être chargé. Vérifiez le réseau, puis rechargez la page.
      </p>
    );
  }
  return <div ref={host} className="flex justify-center" />;
}
