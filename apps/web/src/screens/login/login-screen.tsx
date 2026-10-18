import type { CurrentUser } from '@kitchen/shared';
import { useState } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router';
import { useAuth } from '../../hooks/use-auth';
import { api, errorMessage, isApiError } from '../../lib/api';
import { useGoogleClientIdQuery } from '../../lib/queries';
import { AuthLayout } from './auth-layout';
import { GoogleSignInButton } from './google-sign-in-button';

/** Message affiché après un refus : une information (demande en attente) ou une erreur. */
type Notice = { tone: 'info' | 'error'; text: string };

export function LoginScreen() {
  const auth = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const clientId = useGoogleClientIdQuery();
  const [notice, setNotice] = useState<Notice | null>(null);

  const next = safeNext(params.get('next'));
  if (auth.state === 'authenticated') return <Navigate to={next} replace />;
  // Base vide : plus d'écran d'installation, c'est la première connexion
  // Google qui crée l'administrateur (D7).
  const firstRun = auth.state === 'setup_required';

  const signIn = async (credential: string) => {
    setNotice(null);
    try {
      await api.post<CurrentUser>('/auth/google', { credential }, { skipAuthRedirect: true });
      await auth.refresh();
      navigate(next, { replace: true });
    } catch (error) {
      // 403 : le compte attend une validation, ou a été écarté. L'API rend le
      // même message dans les deux cas, et l'utilisateur n'a rien fait de mal.
      if (isApiError(error, 'forbidden')) setNotice({ tone: 'info', text: errorMessage(error) });
      else if (isApiError(error, 'rate_limited')) setNotice({ tone: 'error', text: 'Trop de tentatives. Patientez quelques minutes avant de réessayer.' });
      else if (isApiError(error, 'unauthenticated')) setNotice({ tone: 'error', text: 'Connexion refusée : ce compte Google n’a pas pu être vérifié.' });
      else setNotice({ tone: 'error', text: errorMessage(error) });
    }
  };

  return (
    <AuthLayout
      title="Connexion"
      lead={
        firstRun
          ? 'Aucun compte n’existe encore : la première connexion Google créera le compte administrateur du foyer.'
          : 'Retrouvez le stock partagé de la maison.'
      }
    >
      <div className="flex flex-col gap-4">
        {clientId.isPending ? (
          <p className="text-center text-[14px] text-muted">Chargement…</p>
        ) : clientId.isError ? (
          <p role="alert" className="rounded-xl bg-danger-deep px-3 py-2 text-[14px] text-danger">
            {errorMessage(clientId.error)}
          </p>
        ) : clientId.data.clientId ? (
          <GoogleSignInButton clientId={clientId.data.clientId} onCredential={(credential) => void signIn(credential)} />
        ) : (
          <p role="status" className="rounded-xl bg-raised px-3 py-2 text-[14px] text-muted">
            La connexion Google n’est pas configurée sur ce serveur. Renseignez <code>GOOGLE_CLIENT_ID</code>, puis redémarrez le service.
          </p>
        )}
        {notice &&
          (notice.tone === 'info' ? (
            <p role="status" className="rounded-xl bg-raised px-3 py-2 text-[14px] text-muted">
              {notice.text}
            </p>
          ) : (
            <p role="alert" className="rounded-xl bg-danger-deep px-3 py-2 text-[14px] text-danger">
              {notice.text}
            </p>
          ))}
      </div>
    </AuthLayout>
  );
}

function safeNext(value: string | null): string {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return '/';
  if (value.startsWith('/connexion') || value.startsWith('/installation')) return '/';
  return value;
}
