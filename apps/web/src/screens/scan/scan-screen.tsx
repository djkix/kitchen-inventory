import type { LocationNode } from '@kitchen/shared';
import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation as useRouterLocation, useNavigate } from 'react-router';
import { BarcodeScanner } from '../../components/scanner/barcode-scanner';
import { CameraError } from '../../components/scanner/camera-error';
import { primeAudio } from '../../components/scanner/feedback';
import { useBarcodeDetector } from '../../components/scanner/use-barcode-detector';
import { useCamera } from '../../components/scanner/use-camera';
import { Button, IconButton } from '../../components/ui/button';
import { CameraIcon, CloseIcon, KeyboardIcon, PinIcon } from '../../components/ui/icons';
import { Sheet } from '../../components/ui/sheet';
import { useUndo } from '../../hooks/use-undo';
import { cn } from '../../lib/cn';
import { flattenLocations, useLocationsQuery } from '../../lib/queries';
import { readScanLocation, reconcileScanLocation, writeScanLocation, type ScanLocation } from '../../lib/scan-session';
import { LastAddedBanner, type LastAdded } from './last-added-banner';
import { LocationPicker } from './location-picker';
import { ProductForm } from './product-form';
import { QuickDateSheet } from './quick-date-sheet';
import { RecognitionSheet } from './recognition-sheet';
import { useScanFlow } from './use-scan-flow';

/**
 * Écran scan (sections 3, 8, 14) : caméra plein écran, emplacement courant en
 * bandeau haut, dernier ajout en bandeau bas avec annulation, rafale continue.
 */
export function ScanScreen() {
  const navigate = useNavigate();
  const routerLocation = useRouterLocation();
  const from = (routerLocation.state as { from?: string } | null)?.from ?? '/';
  const undo = useUndo();

  const [location, setLocation] = useState<ScanLocation | null>(() => readScanLocation());
  const [pickerOpen, setPickerOpen] = useState(false);
  const [dateEntry, setDateEntry] = useState<LastAdded | null>(null);
  const locations = useLocationsQuery();

  // L'emplacement mémorisé peut avoir disparu ou changé de nom depuis un autre téléphone.
  useEffect(() => {
    if (!locations.data) return;
    const reconciled = reconcileScanLocation(location, flattenLocations(locations.data));
    if (reconciled?.id !== location?.id || reconciled?.name !== location?.name) {
      setLocation(reconciled);
      writeScanLocation(reconciled);
    }
    if (!reconciled) setPickerOpen(true);
  }, [locations.data, location]);

  const camera = useCamera(true);
  const flow = useScanFlow({ locationId: location?.id ?? null, videoRef: camera.videoRef });

  const detectionEnabled = camera.state.status === 'ready' && flow.phase.kind === 'scanning' && location !== null && !pickerOpen && dateEntry === null;
  const detector = useBarcodeDetector({ videoRef: camera.videoRef, enabled: detectionEnabled, onCode: (code) => void flow.handleCode(code) });

  const chooseLocation = (node: LocationNode) => {
    const next = { id: node.id, name: node.name };
    setLocation(next);
    writeScanLocation(next);
    setPickerOpen(false);
    primeAudio();
  };

  const leave = () => {
    void undo.invalidateStock();
    navigate(from === '/scan' ? '/' : from);
  };

  const cameraBlocked = camera.state.status === 'insecure' || camera.state.status === 'denied' || camera.state.status === 'unsupported' || camera.state.status === 'error';
  const paused = flow.phase.kind !== 'scanning' || pickerOpen;
  const engineLabel = useMemo(() => (detector.engine === 'zxing' ? 'lecture logicielle' : null), [detector.engine]);

  return (
    <div className="fixed inset-0 z-40 bg-black text-fg">
      {cameraBlocked ? (
        <>
          <CloseButton onClick={leave} />
          {camera.state.status !== 'ready' && camera.state.status !== 'starting' && camera.state.status !== 'idle' && (
            <CameraError state={camera.state} onRetry={() => void camera.retry()} onManualCode={(code) => void flow.handleCode(code)} />
          )}
        </>
      ) : (
        <BarcodeScanner attachVideo={camera.attachVideo} busy={flow.phase.kind === 'resolving'} paused={paused}>
          <div className="safe-top absolute inset-x-0 top-0 flex items-start justify-between gap-2 bg-gradient-to-b from-black/70 to-transparent p-3">
            <button
              type="button"
              onClick={() => setPickerOpen(true)}
              className="flex min-h-touch max-w-[75%] items-center gap-2 rounded-full bg-ink/85 px-4 text-left backdrop-blur active:bg-raised"
              aria-label={location ? `Emplacement courant : ${location.name}. Changer` : 'Choisir l’emplacement'}
            >
              <PinIcon size={18} className="shrink-0 text-accent" />
              <span className="truncate text-[15px] font-medium">{location ? location.name : 'Choisir l’emplacement'}</span>
            </button>
            <CloseButton onClick={leave} inline />
          </div>

          {camera.state.status === 'starting' && (
            <p className="absolute inset-x-0 top-1/2 mt-24 text-center text-[14px] text-white/80" role="status">
              Démarrage de la caméra…
            </p>
          )}

          <div className="safe-bottom pointer-events-none absolute inset-x-0 bottom-0 flex flex-col gap-3 bg-gradient-to-t from-black/80 to-transparent pb-4 pt-10">
            <LastAddedBanner lastAdded={flow.lastAdded} onUndo={(entry) => void flow.undoLast(entry)} onSetDate={setDateEntry} />
            <div className="pointer-events-auto flex items-center justify-between px-4">
              <Button variant="ghost" className="text-white/90" icon={<KeyboardIcon size={20} />} onClick={() => flow.openManualForm(null)}>
                À la main
              </Button>
              <button
                type="button"
                aria-label="Photographier un produit sans code-barres"
                disabled={!detectionEnabled}
                onClick={() => void flow.takePhoto(null)}
                className={cn('flex size-[68px] items-center justify-center rounded-full border-4 border-white/90 bg-white/10 text-white active:bg-white/30 disabled:opacity-40')}
              >
                <CameraIcon size={30} />
              </button>
              <p className="tnum w-[92px] text-right text-[13px] text-white/70">
                {flow.addedCount > 0 ? `${flow.addedCount} ajouté${flow.addedCount > 1 ? 's' : ''}` : engineLabel ?? ''}
              </p>
            </div>
            {detector.failed && (
              <p className="pointer-events-auto mx-4 rounded-xl bg-danger-deep px-3 py-2 text-[13px] text-danger">
                Le lecteur de code-barres n’a pas pu se charger. Utilisez la photo ou la{' '}
                <button type="button" className="underline" onClick={() => flow.openManualForm(null)}>
                  saisie manuelle
                </button>
                .
              </p>
            )}
          </div>
        </BarcodeScanner>
      )}

      <LocationPicker open={pickerOpen} selectedId={location?.id ?? null} onSelect={chooseLocation} onClose={() => setPickerOpen(false)} required={!location} />

      <RecognitionSheet phase={flow.phase} onPhoto={(barcode) => void flow.takePhoto(barcode)} onManual={flow.openManualForm} onDismiss={flow.backToScanning} />

      {flow.phase.kind === 'form' && location && (
        <Sheet open onClose={flow.backToScanning} title={flow.phase.recognition ? 'Fiche proposée' : 'Nouveau produit'} description={`Sera rangé dans ${location.name}`}>
          <ProductForm defaults={{ ...flow.phase.defaults, locationId: location.id }} recognition={flow.phase.recognition} lockLocation onSaved={flow.onFormSaved} onCancel={flow.backToScanning} />
        </Sheet>
      )}

      <QuickDateSheet entry={dateEntry} onClose={() => setDateEntry(null)} onConfirm={flow.setDate} />

      {location === null && !pickerOpen && locations.isSuccess && flattenLocations(locations.data).length === 0 && (
        <div className="absolute inset-x-0 bottom-0 z-50 bg-ink p-5 pb-[calc(env(safe-area-inset-bottom,0px)+20px)]">
          <p className="text-[15px] text-muted">Aucun emplacement n’existe encore. Créez au moins un placard pour commencer à scanner.</p>
          <Link to="/reglages/emplacements" className="mt-3 inline-flex min-h-touch items-center rounded-xl bg-accent px-4 font-semibold text-ink">
            Créer un emplacement
          </Link>
        </div>
      )}
    </div>
  );
}

function CloseButton({ onClick, inline = false }: { onClick: () => void; inline?: boolean }) {
  return (
    <IconButton label="Fermer le scan" onClick={onClick} className={cn('rounded-full bg-ink/85 backdrop-blur', !inline && 'safe-top absolute right-3 top-3 z-10 mt-3')}>
      <CloseIcon />
    </IconButton>
  );
}
