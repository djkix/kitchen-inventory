import type { ScanBarcodeResult, ScanImageResult } from '@kitchen/shared';
import { useCallback, useRef, useState } from 'react';
import { errorFeedback, scanFeedback } from '../../components/scanner/feedback';
import { useToast } from '../../components/ui/toast';
import { api, errorMessage, isApiError } from '../../lib/api';
import { isAcceptedPhoto, photoFileToJpeg } from '../../lib/image';
import { stockApi } from '../../lib/stock-api';
import type { ConfirmTarget } from './confirm-sheet';
import type { LastAdded } from './last-added-banner';
import type { ProductFormDefaults, ProductFormResult } from './product-form';

/** Phases du parcours de scan (section 3) ; `scanning` est l'état de repos, caméra ouverte. */
export type ScanPhase =
  | { kind: 'scanning' }
  | { kind: 'resolving'; barcode: string }
  | { kind: 'confirm'; target: ConfirmTarget; saving: boolean }
  | { kind: 'unknown'; barcode: string }
  | { kind: 'photo'; barcode: string | null; slow: boolean }
  | { kind: 'rejected'; barcode: string | null }
  | { kind: 'form'; defaults: ProductFormDefaults; recognition: ScanImageResult | null }
  | { kind: 'blocked'; reason: 'quota' | 'provider' | 'disabled'; message: string; barcode: string | null; imagePath: string | null };

interface Options {
  locationId: string | null;
}

export function useScanFlow({ locationId }: Options) {
  const toast = useToast();
  const [phase, setPhase] = useState<ScanPhase>({ kind: 'scanning' });
  const [lastAdded, setLastAdded] = useState<LastAdded | null>(null);
  const [addedCount, setAddedCount] = useState(0);
  const inFlight = useRef(false);

  const recordAdded = useCallback((result: ProductFormResult['stock'], name: string) => {
    const delta = result.movement ? Math.abs(result.movement.delta) : result.item.quantity;
    setLastAdded({
      itemId: result.item.id,
      name,
      quantity: result.item.quantity,
      unit: result.item.unit,
      appliedDelta: delta,
      merged: result.merged === true,
      dated: result.item.expiryDate !== null,
      createdAt: Date.now(),
    });
    setAddedCount((n) => n + 1);
  }, []);

  /**
   * Code lu ou saisi : cache produit ou Open Food Facts, puis validation
   * explicite. Rien n'entre en stock avant que l'utilisateur ait confirmé le
   * produit et sa quantité (voir `confirmAdd`).
   */
  const handleCode = useCallback(
    async (barcode: string) => {
      if (!locationId || inFlight.current) return;
      inFlight.current = true;
      setPhase({ kind: 'resolving', barcode });
      try {
        const found = await api.post<ScanBarcodeResult>('/scan/barcode', { barcode });
        scanFeedback();
        setPhase({ kind: 'confirm', target: { product: found.product, source: found.source, barcode }, saving: false });
      } catch (error) {
        if (isApiError(error, 'not_found')) {
          errorFeedback();
          setPhase({ kind: 'unknown', barcode });
        } else {
          errorFeedback();
          toast.show({ message: errorMessage(error), tone: 'danger' });
          setPhase({ kind: 'scanning' });
        }
      } finally {
        inFlight.current = false;
      }
    },
    [locationId, recordAdded, toast],
  );

  /** Ajout effectif, après validation du produit et de la quantité proposés. */
  const confirmAdd = useCallback(
    async (target: ConfirmTarget, quantity: number) => {
      if (!locationId) return;
      setPhase({ kind: 'confirm', target, saving: true });
      try {
        const result = await stockApi.create({ productId: target.product.id, locationId, quantity, estimateExpiry: false });
        recordAdded(result, target.product.name);
        setPhase({ kind: 'scanning' });
      } catch (error) {
        errorFeedback();
        toast.show({ message: errorMessage(error), tone: 'danger' });
        setPhase({ kind: 'confirm', target, saving: false });
      }
    },
    [locationId, recordAdded, toast],
  );

  /**
   * Photo prise par l'appareil natif du téléphone → `POST /scan/image`, avec
   * un indicateur explicite au-delà d'une seconde (section 13).
   *
   * L'appareil natif est préféré à une capture du flux vidéo : il apporte
   * l'autofocus, le flash et la stabilisation, décisifs pour lire une étiquette
   * en idéogrammes dans un placard peu éclairé. Il fonctionne aussi là où la
   * caméra du navigateur est refusée, notamment hors HTTPS.
   */
  const submitPhoto = useCallback(
    async (file: File, barcode: string | null) => {
      if (!isAcceptedPhoto(file)) {
        toast.show({ message: 'Ce fichier n’est pas une photo exploitable.', tone: 'danger' });
        return;
      }
      setPhase({ kind: 'photo', barcode, slow: false });
      const slowTimer = window.setTimeout(() => setPhase((current) => (current.kind === 'photo' ? { ...current, slow: true } : current)), 1000);
      try {
        const blob = await photoFileToJpeg(file);
        const formData = new FormData();
        formData.append('image', blob, 'photo.jpg');
        if (barcode) formData.append('barcode', barcode);
        const result = await api.postForm<ScanImageResult>('/scan/image', formData);
        if (result.rejected) {
          errorFeedback();
          setPhase({ kind: 'rejected', barcode });
          return;
        }
        scanFeedback();
        setPhase({
          kind: 'form',
          recognition: result,
          defaults: {
            barcode,
            name: result.suggestion.name,
            originalName: result.suggestion.originalName,
            brand: result.suggestion.brand,
            categoryId: result.categoryId,
            expiryDate: result.suggestion.expiryDate,
            imagePath: result.imagePath,
            recognitionLogId: result.rawId,
          },
        });
      } catch (error) {
        errorFeedback();
        if (isApiError(error, 'rate_limited')) {
          const today = error.detail<number>('callsToday');
          const quota = error.detail<number>('dailyQuota');
          const counter = today !== undefined && quota !== undefined ? ` (${today}/${quota} aujourd’hui)` : '';
          setPhase({ kind: 'blocked', reason: 'quota', message: `${error.message}${counter}.`, barcode, imagePath: null });
        } else if (isApiError(error, 'provider_unavailable')) {
          setPhase({
            kind: 'blocked',
            reason: 'provider',
            message: 'Fournisseur injoignable, photo conservée à identifier. Vous pouvez créer la fiche à la main : la photo y sera rattachée.',
            barcode,
            imagePath: error.detail<string>('imagePath') ?? null,
          });
        } else if (isApiError(error, 'business_rule')) {
          setPhase({ kind: 'blocked', reason: 'disabled', message: error.message, barcode, imagePath: null });
        } else {
          toast.show({ message: errorMessage(error), tone: 'danger' });
          setPhase({ kind: barcode ? 'unknown' : 'scanning', barcode: barcode ?? '' } as ScanPhase);
        }
      } finally {
        window.clearTimeout(slowTimer);
      }
    },
    [toast],
  );

  const openManualForm = useCallback((barcode: string | null, imagePath: string | null = null) => {
    setPhase({ kind: 'form', recognition: null, defaults: { barcode, imagePath } });
  }, []);

  const backToScanning = useCallback(() => setPhase({ kind: 'scanning' }), []);

  const onFormSaved = useCallback(
    (result: ProductFormResult) => {
      scanFeedback();
      recordAdded(result.stock, result.product.name);
      setPhase({ kind: 'scanning' });
    },
    [recordAdded],
  );

  /** Annulation du dernier ajout : delta inverse, nouveau clientOpId. */
  const undoLast = useCallback(
    async (entry: LastAdded) => {
      try {
        await stockApi.adjust(entry.itemId, -entry.appliedDelta, 'Annulation du scan');
        setLastAdded(null);
        setAddedCount((n) => Math.max(0, n - 1));
        toast.show({ message: `${entry.name} retiré`, durationMs: 2000 });
      } catch (error) {
        toast.show({ message: `Annulation impossible : ${errorMessage(error)}`, tone: 'danger' });
      }
    },
    [toast],
  );

  const setDate = useCallback(
    async (entry: LastAdded, expiryDate: string, dateType: 'USE_BY' | 'BEST_BEFORE') => {
      await stockApi.update(entry.itemId, { expiryDate, dateType, dateEstimated: false });
      setLastAdded((current) => (current && current.itemId === entry.itemId ? { ...current, dated: true } : current));
    },
    [],
  );

  return { phase, lastAdded, addedCount, handleCode, confirmAdd, submitPhoto, openManualForm, backToScanning, onFormSaved, undoLast, setDate };
}
