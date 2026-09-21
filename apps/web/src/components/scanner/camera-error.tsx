import { barcodeSchema } from '@kitchen/shared';
import { useState } from 'react';
import { Button } from '../ui/button';
import { KeyboardIcon, WarningIcon } from '../ui/icons';
import { Input } from '../ui/input';
import type { CameraState } from './use-camera';

interface CameraErrorProps {
  state: Exclude<CameraState, { status: 'ready' } | { status: 'starting' } | { status: 'idle' }>;
  onRetry: () => void;
  onManualCode: (code: string) => void;
}

function browserHint(): string {
  const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent;
  if (/iPhone|iPad/.test(ua)) return 'Sur iPhone : Réglages › Safari › Caméra › Autoriser, ou appuyez sur « AA » dans la barre d’adresse puis « Réglages du site web ». Dans l’application installée : Réglages › Inventaire.';
  if (/Android/.test(ua)) return 'Sur Android : appuyez sur le cadenas dans la barre d’adresse › Autorisations › Caméra › Autoriser. Dans l’application installée : Paramètres › Applications › Inventaire › Autorisations.';
  return 'Dans le navigateur : cliquez sur l’icône de cadenas ou de caméra dans la barre d’adresse et autorisez la caméra pour ce site, puis réessayez.';
}

/** Section 17 : caméra refusée ou contexte non sécurisé → explication et repli sur la saisie manuelle. */
export function CameraError({ state, onRetry, onManualCode }: CameraErrorProps) {
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = () => {
    const parsed = barcodeSchema.safeParse(code);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Code invalide');
      return;
    }
    setError(null);
    onManualCode(parsed.data);
    setCode('');
  };

  let title: string;
  let explanation: string;
  if (state.status === 'insecure') {
    title = 'Le scan exige HTTPS';
    explanation = 'Le navigateur n’autorise la caméra qu’en connexion sécurisée (HTTPS ou localhost). Ouvrez l’application par son adresse HTTPS, celle du reverse proxy, et non par l’adresse IP en HTTP.';
  } else if (state.status === 'denied') {
    title = 'Caméra refusée';
    explanation = browserHint();
  } else if (state.status === 'unsupported') {
    title = 'Aucune caméra utilisable';
    explanation = 'Aucune caméra arrière n’a été trouvée, ou ce navigateur ne permet pas d’y accéder. Vous pouvez saisir le code-barres à la main.';
  } else {
    title = 'La caméra ne démarre pas';
    explanation = `${state.message}. Fermez les autres applications qui utilisent la caméra, puis réessayez.`;
  }

  return (
    <div className="flex h-dvh flex-col justify-end gap-5 bg-ink px-5 pb-[calc(env(safe-area-inset-bottom,0px)+24px)]">
      <div className="flex flex-col gap-3">
        <WarningIcon size={36} className="text-soon" />
        <h2 className="text-[24px] font-semibold leading-tight">{title}</h2>
        <p className="text-[15px] text-muted">{explanation}</p>
      </div>
      {state.status !== 'insecure' && (
        <Button size="lg" onClick={onRetry}>
          Réessayer la caméra
        </Button>
      )}
      <form
        className="flex flex-col gap-3 rounded-card bg-surface p-4"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <p className="flex items-center gap-2 text-[14px] text-muted">
          <KeyboardIcon size={18} /> Saisie manuelle du code-barres
        </p>
        <Input label="Code EAN-8, EAN-13 ou UPC" inputMode="numeric" autoComplete="off" value={code} onChange={(event) => setCode(event.target.value)} error={error ?? undefined} placeholder="3017620422003" />
        <Button type="submit" variant="primary" size="lg" block>
          Rechercher ce code
        </Button>
      </form>
    </div>
  );
}
