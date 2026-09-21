import type { ScanBarcodeResult, ScanImageResult } from '@kitchen/shared';
import { useCallback, useRef, useState } from 'react';
import { errorFeedback, scanFeedback } from '../../components/scanner/feedback';
import { useToast } from '../../components/ui/toast';
import { api, errorMessage, isApiError } from '../../lib/api';
import { captureJpeg } from '../../lib/image';
import { stockApi } from '../../lib/stock-api';
import type { LastAdded } from './last-added-banner';
import type { ProductFormDefaults, ProductFormResult } from './product-form';

/** Phases du parcours de scan (section 3) ; `scanning` est l'état de repos, caméra ouverte. */
export type ScanPhase =
  | { kind: 'scanning' }
  | { kind: 'resolving'; barcode: string }
  | { kind: 'unknown'; barcode: string }
  | { kind: 'photo'; barcode: string | null; slow: boolean }
  | { kind: 'rejected'; barcode: string | null }
  | { kind: 'form'; defaults: ProductFormDefaults; recognition: ScanImageResult | null }
  | { kind: 'blocked'; reason: 'quota' | 'provider' | 'disabled'; message: string; barcode: string | null; imagePath: string | null };

interface Options {
  locationId: string | null;
  videoRef: React.RefObject<HTMLVideoElement | null>;
}

export function useScanFlow({ locationId, videoRef }: Options) {
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

  /** Code lu ou saisi : cache produit ou Open Food Facts, puis entrée en stock quantité 1. */
  const handleCode = useCallback(
    async (barcode: string) => {
      if (!locationId || inFlight.current) return;
      inFlight.current = true;
      setPhase({ kind: 'resolving', barcode });
      try {
        const found = await api.post<ScanBarcodeResult>('/scan/barcode', { barcode });
        const result = await stockApi.create({ productId: found.product.id, locationId, quantity: 1, estimateExpiry: false });
        scanFeedback();
        recordAdded(result, found.product.name);
        setPhase({ kind: 'scanning' });
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

  /** Photo depuis la vidéo → `POST /scan/image` ; indicateur explicite au-delà d'une seconde (section 13). */
  const takePhoto = useCallback(
    async (barcode: string | null) => {
      const video = videoRef.current;
      if (!video || video.videoWidth === 0) {
        toast.show({ message: 'La caméra n’est pas prête, réessayez dans un instant.', tone: 'danger' });
        return;
      }
      setPhase({ kind: 'photo', barcode, slow: false });
      const slowTimer = window.setTimeout(() => setPhase((current) => (current.kind === 'photo' ? { ...current, slow: true } : current)), 1000);
      try {
        const blob = await captureJpeg(video);
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
    [toast, videoRef],
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

  return { phase, lastAdded, addedCount, handleCode, takePhoto, openManualForm, backToScanning, onFormSaved, undoLast, setDate };
}
