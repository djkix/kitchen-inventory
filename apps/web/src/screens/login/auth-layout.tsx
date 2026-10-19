import type { ReactNode } from 'react';
import { ScanIcon } from '../../components/ui/icons';

/** Nom affiché de l'application, sur le seul écran qui n'a ni barre de titre ni navigation. */
export const APP_NAME = 'Kitchen';

/**
 * Écran sans session : une carte centrée, verticalement et horizontalement.
 *
 * La première version poussait le contenu en bas de l'écran (`justify-end`),
 * pour mettre le bouton à portée du pouce. À l'usage, djkix l'a trouvée mal
 * finie : sur un écran de téléphone presque vide, un bloc collé en bas se lit
 * comme un défaut de mise en page plutôt que comme une intention. Le bouton
 * reste de toute façon dans la moitié basse une fois la carte centrée, donc le
 * confort du pouce ne coûte rien ici.
 *
 * `min-h-dvh` et non `min-h-screen` : sur mobile, la barre d'adresse fait
 * varier la hauteur, et `dvh` suit cette variation — un centrage calculé sur
 * `vh` sauterait à chaque défilement.
 */
export function AuthLayout({ title, lead, children }: { title: string; lead: string; children: ReactNode }) {
  return (
    <div className="safe-top safe-bottom flex min-h-dvh w-full items-center justify-center px-5 py-10">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center gap-3 text-center">
          <span className="inline-flex size-14 items-center justify-center rounded-2xl bg-accent-deep text-accent">
            <ScanIcon size={30} />
          </span>
          <p className="text-[15px] font-semibold tracking-wide text-muted">{APP_NAME}</p>
        </div>

        <div className="mt-6 rounded-card border border-line bg-surface p-6">
          <h1 className="text-center text-[24px] font-semibold leading-tight">{title}</h1>
          <p className="mt-2 text-center text-[15px] text-muted">{lead}</p>
          <div className="mt-6">{children}</div>
        </div>
      </div>
    </div>
  );
}
