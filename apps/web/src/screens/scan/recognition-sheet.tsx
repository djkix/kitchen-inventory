import { Link } from 'react-router';
import { Button, Spinner } from '../../components/ui/button';
import { CameraIcon, KeyboardIcon } from '../../components/ui/icons';
import { Sheet } from '../../components/ui/sheet';
import type { ScanPhase } from './use-scan-flow';

interface RecognitionSheetProps {
  phase: ScanPhase;
  onPhoto: (barcode: string | null) => void;
  onManual: (barcode: string | null, imagePath?: string | null) => void;
  onDismiss: () => void;
}

/**
 * Tiroir des cas hors chemin nominal : code inconnu, analyse en cours, photo
 * inutilisable, quota ou fournisseur indisponible (section 17).
 */
export function RecognitionSheet({ phase, onPhoto, onManual, onDismiss }: RecognitionSheetProps) {
  if (phase.kind === 'unknown') {
    return (
      <Sheet open onClose={onDismiss} title="Code-barres inconnu" description={`${phase.barcode} n’est ni dans votre référentiel ni dans Open Food Facts.`}>
        <div className="flex flex-col gap-2">
          <Button variant="primary" size="lg" block icon={<CameraIcon size={20} />} onClick={() => onPhoto(phase.barcode)}>
            Photographier l’emballage
          </Button>
          <Button size="lg" block icon={<KeyboardIcon size={20} />} onClick={() => onManual(phase.barcode)}>
            Créer à la main
          </Button>
          <Button variant="ghost" size="lg" block onClick={onDismiss}>
            Ignorer ce code
          </Button>
        </div>
      </Sheet>
    );
  }

  if (phase.kind === 'photo') {
    return (
      <Sheet open onClose={() => undefined} locked title="Photo envoyée">
        <div className="flex items-center gap-3 py-2" role="status" aria-live="polite">
          <Spinner className="size-5 text-accent" />
          <p className="text-[15px]">{phase.slow ? 'Analyse de la photo… cela peut prendre quelques secondes.' : 'Envoi de la photo…'}</p>
        </div>
      </Sheet>
    );
  }

  if (phase.kind === 'rejected') {
    return (
      <Sheet open onClose={onDismiss} title="Photo inutilisable" description="Le modèle n’a pas reconnu le produit avec assez de certitude. Aucune fiche n’est proposée : rapprochez-vous, éclairez l’étiquette et reprenez la photo.">
        <div className="flex flex-col gap-2">
          <Button variant="primary" size="lg" block icon={<CameraIcon size={20} />} onClick={() => onPhoto(phase.barcode)}>
            Reprendre la photo
          </Button>
          <Button size="lg" block onClick={() => onManual(phase.barcode)}>
            Créer à la main
          </Button>
          <Button variant="ghost" size="lg" block onClick={onDismiss}>
            Abandonner
          </Button>
        </div>
      </Sheet>
    );
  }

  if (phase.kind === 'blocked') {
    const title = phase.reason === 'quota' ? 'Quota photo atteint' : phase.reason === 'provider' ? 'Fournisseur injoignable' : 'Reconnaissance photo désactivée';
    return (
      <Sheet open onClose={onDismiss} title={title} description={phase.message}>
        <div className="flex flex-col gap-2">
          {phase.reason === 'disabled' && (
            <p className="rounded-xl bg-surface px-3 py-2 text-[14px] text-muted">
              Un administrateur doit définir <code className="text-fg">VISION_PROVIDER</code> et <code className="text-fg">VISION_API_KEY</code> dans le fichier <code className="text-fg">.env</code> du serveur, puis redémarrer. L’état est visible dans{' '}
              <Link to="/reglages" className="text-accent">
                Réglages › Reconnaissance
              </Link>
              .
            </p>
          )}
          {phase.reason === 'quota' && <p className="text-[14px] text-muted">Le scan de code-barres continue de fonctionner normalement.</p>}
          <Button variant="primary" size="lg" block onClick={() => onManual(phase.barcode, phase.imagePath)}>
            Créer la fiche à la main
          </Button>
          <Button variant="ghost" size="lg" block onClick={onDismiss}>
            Continuer à scanner
          </Button>
        </div>
      </Sheet>
    );
  }

  return null;
}
