import { rateLogSchema } from '@kitchen/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Button } from '../../components/ui/button';
import { Sheet } from '../../components/ui/sheet';
import { StarRating } from '../../components/ui/star-rating';
import { Textarea } from '../../components/ui/input';
import { useToast } from '../../components/ui/toast';
import { errorMessage, isApiError } from '../../lib/api';
import { queryKeys, usePendingRatingQuery } from '../../lib/queries';
import { recipesApi } from '../../lib/recipes-api';
import type { PendingRatingDto } from '../../lib/types';

export type PendingRating = PendingRatingDto;

const DISMISS_KEY = 'kitchen.recipes.ratingReminderDismissedOn';

/** Clé du jour courant (AAAA-MM-JJ) : un oui/non ne suffit pas, il faut savoir *quel* jour a été refusé (section « à faire soi-même »). */
function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function readDismissedToday(): boolean {
  try {
    if (typeof window === 'undefined') return false;
    return window.localStorage.getItem(DISMISS_KEY) === todayKey();
  } catch {
    return false;
  }
}

function writeDismissedToday(): void {
  try {
    window.localStorage.setItem(DISMISS_KEY, todayKey());
  } catch {
    /* stockage plein ou interdit (navigation privée) : le bandeau reviendra à la prochaine ouverture */
  }
}

interface RatingReminderViewProps {
  pending: PendingRating | null;
  onRate: (logId: string) => void;
}

/**
 * Bandeau d'invitation à noter la dernière réalisation récente non notée
 * (EF-28). Composant de présentation pur : la requête et l'ouverture du
 * tiroir de notation sont du ressort de `RatingReminderBanner`.
 */
export function RatingReminderView({ pending, onRate }: RatingReminderViewProps) {
  const [dismissed, setDismissed] = useState(readDismissedToday);

  if (!pending || dismissed) return null;

  const hide = () => {
    writeDismissedToday();
    setDismissed(true);
  };

  return (
    <div role="status" className="mx-4 mb-3 flex items-center justify-between gap-3 rounded-card bg-raised px-4 py-3">
      <p className="min-w-0 flex-1 text-[14px] leading-snug">
        Notez le {pending.recipeTitle} : qu’en avez-vous pensé&nbsp;?
      </p>
      <div className="flex shrink-0 items-center gap-2">
        <Button size="sm" variant="primary" onClick={() => onRate(pending.logId)}>
          Noter
        </Button>
        <Button size="sm" variant="ghost" onClick={hide}>
          Masquer
        </Button>
      </div>
    </div>
  );
}

interface RatingSheetProps {
  open: boolean;
  logId: string | null;
  recipeTitle?: string;
  onClose: () => void;
  /** Appelé après une notation réussie, pour que l'appelant invalide ce qui lui appartient (ex. la fiche recette de la tâche 16). */
  onRated?: () => void;
  /** Note déjà posée par l'utilisateur courant, pré-remplie à l'ouverture (modification depuis la fiche recette, tâche 16). */
  initialStars?: number | null;
  initialComment?: string | null;
}

/**
 * Tiroir de notation autonome : cinq étoiles et un commentaire facultatif,
 * `PUT /api/v1/recipe-logs/{id}/rating`. Exporté séparément pour être réutilisé
 * par la fiche recette (tâche 16), sans dépendre du bandeau.
 */
export function RatingSheet({ open, logId, recipeTitle, onClose, onRated, initialStars = null, initialComment = null }: RatingSheetProps) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [stars, setStars] = useState<number | null>(null);
  const [comment, setComment] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Pré-remplit à l'ouverture avec la note déjà posée, le cas échéant, plutôt qu'avec le dernier état laissé par une fermeture précédente.
  useEffect(() => {
    if (!open) return;
    setStars(initialStars ?? null);
    setComment(initialComment ?? '');
    setError(null);
  }, [open, logId, initialStars, initialComment]);

  const reset = () => {
    setStars(null);
    setComment('');
    setError(null);
  };

  const close = () => {
    reset();
    onClose();
  };

  const submit = async () => {
    if (!logId) return;
    const parsed = rateLogSchema.safeParse({ stars, comment: comment.trim() || null });
    if (!parsed.success) {
      setError('Choisissez une note de une à cinq étoiles');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await recipesApi.rateLog(logId, parsed.data);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.recipesAll }),
        queryClient.invalidateQueries({ queryKey: queryKeys.pendingRating }),
      ]);
      toast.show({ message: 'Note enregistrée', tone: 'success', durationMs: 3000 });
      onRated?.();
      close();
    } catch (caught) {
      setError(isApiError(caught, 'conflict') ? errorMessage(caught) : errorMessage(caught, 'Notation impossible'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Sheet open={open} onClose={close} locked={submitting} title={recipeTitle ? `Noter ${recipeTitle}` : 'Noter la réalisation'}>
      <div className="flex flex-col gap-4">
        <StarRating value={stars} onChange={setStars} disabled={submitting} />
        <Textarea label="Commentaire (facultatif)" value={comment} onChange={(event) => setComment(event.target.value)} rows={3} maxLength={500} />
        {error && (
          <p role="alert" className="rounded-xl bg-danger-deep px-3 py-2 text-[14px] text-danger">
            {error}
          </p>
        )}
        <Button variant="primary" size="lg" block loading={submitting} onClick={() => void submit()}>
          Enregistrer la note
        </Button>
      </div>
    </Sheet>
  );
}

/**
 * Bandeau branché : interroge la réalisation en attente et ouvre le tiroir de
 * notation au clic sur « Noter ». Ne s'affiche jamais pendant le chargement
 * de la requête, pour éviter un flash (EF-28).
 */
export function RatingReminderBanner() {
  const pendingRating = usePendingRatingQuery();
  const [ratingLogId, setRatingLogId] = useState<string | null>(null);

  if (pendingRating.isPending || pendingRating.isError) return null;

  const pending = pendingRating.data ?? null;

  return (
    <>
      <RatingReminderView pending={pending} onRate={setRatingLogId} />
      <RatingSheet
        open={ratingLogId !== null}
        logId={ratingLogId}
        recipeTitle={ratingLogId && pending?.logId === ratingLogId ? pending.recipeTitle : undefined}
        onClose={() => setRatingLogId(null)}
      />
    </>
  );
}
