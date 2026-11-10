import { VOICE_MAX_SECONDS, voiceAudioRejection, type AiRequestStatusDto, type SuggestionDto, type VoiceSuggestionBatchDto } from '@kitchen/shared';
import { useMutation } from '@tanstack/react-query';
import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { ScreenHeader } from '../../components/shell/app-shell';
import { Button, Spinner } from '../../components/ui/button';
import { forgetAiRequest, isDeferred } from '../../lib/ai-request';
import { api } from '../../lib/api';
import { errorMessage } from '../../lib/api';
import { DeferredNotice } from '../../components/ui/deferred-notice';
import { useTrackedRequest } from '../../hooks/use-tracked-request';
import { suggestionsApi } from '../../lib/suggestions-api';
import { SuggestionCard, suggestionAccessibleName } from './suggestion-card';
import { SuggestionSheet } from './suggestion-sheet';
import { SuggestionsErrorState } from './suggestions-screen';
import { useVoiceRecorder, type VoiceRecording } from './use-voice-recorder';

/**
 * Demande parlée (spécification du 2026-10-21) : « il me reste du poulet, et
 * un peu de sauce tomate, je veux faire un plat italien, qu'est-ce que tu me
 * proposes ».
 *
 * Un parcours à part (D3), et non un second mode du champ à pastilles : on
 * parle, on obtient des recettes. L'écran Suggestions n'y gagne qu'une icône
 * dans son en-tête — il a été allégé trois fois à la demande du propriétaire, un
 * contrôle permanent de plus y serait un recul.
 *
 * Un seul appel rend la lecture et les recettes (D2) : la lecture est donc
 * affichée **avec** les résultats, pour qu'un contresens se voie sans coûter
 * une étape de confirmation.
 */
export function VoiceRequestScreen() {
  const [batch, setBatch] = useState<VoiceSuggestionBatchDto | null>(null);
  const [selected, setSelected] = useState<SuggestionDto | null>(null);
  /** Refus décidé ici même (bornes de D8, micro muet) : rien n'est parti au serveur. */
  const [rejection, setRejection] = useState<string | null>(null);
  /**
   * Le dernier enregistrement accepté, gardé en mémoire pour « Réessayer »
   * (amendement du 2026-11-02) : Gemini est souvent en pause quelques minutes,
   * et refaire sa demande à voix haute pour cela seul est un geste de trop.
   * Il ne quitte pas la page — ni serveur, ni stockage du navigateur (D6) — et
   * disparaît au prochain enregistrement comme en quittant l'écran.
   */
  const [last, setLast] = useState<VoiceRecording | null>(null);

  /**
   * Résultat d'une demande différée, réclamé au retour (2026-11-10).
   *
   * L'adresse porte l'identifiant de la demande — c'est la notification, ou le
   * message de retour, qui l'y met. Sans cela, le résultat d'une demande
   * parlée n'était affichable nulle part : les recettes entrent bien au
   * réservoir, mais ce que le modèle a **compris de la phrase** n'existe que
   * dans ce résultat-là, et c'est lui qui permet de voir un contresens (D2).
   */
  const [params, setParams] = useSearchParams();
  const demande = params.get('demande');
  const [restoring, setRestoring] = useState(demande !== null);
  const [restoreFailed, setRestoreFailed] = useState(false);

  useEffect(() => {
    if (!demande) return;
    let alive = true;
    void api
      .get<AiRequestStatusDto>(`/ai-requests/${demande}`)
      .then((status) => {
        if (!alive) return;
        if (status.state === 'DONE' && status.result) {
          setBatch(status.result as VoiceSuggestionBatchDto);
          forgetAiRequest(demande);
        } else {
          setRestoreFailed(true);
        }
      })
      .catch(() => alive && setRestoreFailed(true))
      .finally(() => {
        if (!alive) return;
        setRestoring(false);
        // L'identifiant quitte l'adresse une fois lu : un rechargement ne doit
        // pas redemander un résultat déjà sous les yeux, et « Parler » de
        // nouveau ne doit pas ramener l'ancien.
        setParams({}, { replace: true });
      });
    return () => {
      alive = false;
    };
  }, [demande, setParams]);

  const tracked = useTrackedRequest();
  const ask = useMutation({
    mutationFn: (recording: VoiceRecording) => tracked((requestId) => suggestionsApi.voice(recording.blob, recording.mimeType, requestId)),
    onSuccess: setBatch,
  });

  /**
   * « Proposer d'autres recettes » (demande du propriétaire, 2026-11-09 : « un
   * bouton pour me proposer d'autres recettes toujours avec le même input »).
   *
   * L'enregistrement n'est conservé nulle part (D6) : on ne peut donc pas
   * rejouer la voix. Ce qui est rejoué, c'est **ce que le modèle a compris** —
   * les ingrédients affichés juste au-dessus des recettes —, par une recherche
   * écrite ordinaire. Si la lecture était fautive, la relance l'est aussi, et
   * cela se voit puisqu'elle est écrite à l'écran.
   *
   * `refresh` est indispensable : sans lui, le serveur sert le réservoir et
   * rendrait les mêmes recettes.
   */
  const more = useMutation({
    mutationFn: () =>
      tracked((requestId) =>
        suggestionsApi.list({ ingredients: batch?.heard.ingredients.join(', '), refresh: true, requestId }),
      ),
    // Les nouvelles s'ajoutent aux précédentes : on en veut davantage, pas
    // d'autres à la place. La lecture, elle, ne change pas.
    onSuccess: (fresh) =>
      setBatch((current) => {
        if (!current) return current;
        const connues = new Set(current.items.map((item) => item.id));
        return { ...current, items: [...current.items, ...fresh.items.filter((item) => !connues.has(item.id))] };
      }),
  });

  const onRecorded = useCallback(
    (recording: VoiceRecording) => {
      setBatch(null);
      // Même règle que le serveur, qui la revérifie (D8) : un client n'est
      // jamais une garantie, mais refuser ici évite un aller-retour inutile
      // et dit tout de suite pourquoi.
      const refus = voiceAudioRejection(recording.blob.size, recording.mimeType);
      setRejection(refus);
      if (refus) {
        setLast(null);
        return;
      }
      setLast(recording);
      ask.mutate(recording);
    },
    [ask],
  );

  const recorder = useVoiceRecorder(onRecorded);
  const message = rejection ?? recorder.error ?? (recorder.supported ? null : 'Enregistrement impossible sur cet appareil : le navigateur ne le permet pas.');

  return (
    <>
      <ScreenHeader title="Demande parlée" back="/recettes" subtitle="Dites ce qu’il vous reste et ce dont vous avez envie" />

      <div className="flex flex-col items-center gap-3 px-4 py-6">
        {recorder.state === 'recording' ? (
          <>
            <button
              type="button"
              onClick={recorder.stop}
              className="flex size-28 items-center justify-center rounded-full bg-danger text-[15px] font-semibold text-ink"
            >
              Terminer
            </button>
            <p role="status" aria-live="polite" className="text-[15px] font-medium">
              J’écoute… <span className="tnum">{recorder.seconds}</span> s
            </p>
            <p className="text-[13px] text-muted">
              {VOICE_MAX_SECONDS} secondes au maximum ; l’enregistrement s’arrête tout seul.
            </p>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={recorder.start}
              disabled={ask.isPending}
              className="flex size-28 items-center justify-center rounded-full bg-accent text-[15px] font-semibold text-ink disabled:opacity-50"
            >
              Parler
            </button>
            <p className="max-w-[34ch] text-center text-[13px] text-muted">
              Exemple : « il me reste du poulet et un peu de sauce tomate, je veux faire un plat italien ».
            </p>
          </>
        )}

        {message && (
          <p role="alert" className="max-w-[36ch] text-center text-[14px] text-danger">
            {message}
          </p>
        )}
      </div>

      {restoring && (
        <div role="status" aria-live="polite" className="mx-4 my-6 flex flex-col items-center gap-3 text-center">
          <Spinner className="size-7 text-accent" />
          <p className="text-[15px] font-medium">Récupération de votre demande…</p>
        </div>
      )}

      {restoreFailed && (
        <p role="status" className="mx-4 my-6 text-center text-[14px] text-muted">
          Cette demande n’est plus disponible. Ses recettes restent dans les suggestions.
        </p>
      )}

      {ask.isPending && (
        <div role="status" aria-live="polite" className="mx-4 my-6 flex flex-col items-center gap-3 text-center">
          <Spinner className="size-7 text-accent" />
          <p className="text-[15px] font-medium">Analyse de votre demande…</p>
          <p className="max-w-[32ch] text-[13px] text-muted">
            Le modèle écoute l’enregistrement, puis cherche des recettes avec ce que vous avez en stock.
          </p>
        </div>
      )}

      {/* Les refus du serveur sont dits par le même composant que l'écran
          Suggestions : quota, fournisseur absent, demande non comprise.

          « Réessayer » renvoie le même enregistrement (amendement du
          2026-11-02) : le refus le plus courant est une pause de quelques
          minutes chez Google, et la demande n'a pas à être refaite à voix
          haute pour cela. Tant que la pause dure, le bouton redit l'heure de
          reprise plutôt que de rejouer pour rien. */}
      {/* Demande gardée par le serveur : ce n'est pas un échec, c'est une
          attente. Elle repartira seule et sera annoncée (D1b). */}
      {ask.isError && isDeferred(ask.error) && <DeferredNotice error={ask.error} what="recettes" />}

      {ask.isError && !isDeferred(ask.error) && (
        <>
          <SuggestionsErrorState error={ask.error} />
          {last ? (
            <div className="mx-4 mb-6 flex flex-col items-center gap-2">
              <button
                type="button"
                onClick={() => ask.mutate(last)}
                disabled={ask.isPending}
                className="rounded-card bg-accent px-5 py-2 text-[15px] font-semibold text-ink disabled:opacity-50"
              >
                Réessayer
              </button>
              <p className="text-center text-[13px] text-muted">
                Votre demande est gardée le temps que vous restez sur cet écran.
              </p>
            </div>
          ) : (
            <p className="mx-4 mb-6 text-center text-[13px] text-muted">
              Appuyez de nouveau sur « Parler » pour refaire votre demande.
            </p>
          )}
        </>
      )}

      {batch && !ask.isPending && (
        <VoiceResult batch={batch} onSelect={setSelected} onMore={() => more.mutate()} moreLoading={more.isPending} moreError={more.isError ? errorMessage(more.error) : null} />
      )}

      <SuggestionSheet suggestion={selected} open={selected !== null} onClose={() => setSelected(null)} />
    </>
  );
}

/**
 * La lecture du modèle, puis les recettes. La lecture d'abord, et toujours :
 * c'est elle qui permet de reconnaître un contresens avant de lire douze
 * recettes à côté de la plaque (D2).
 */
function VoiceResult({
  batch,
  onSelect,
  onMore,
  moreLoading,
  moreError,
}: {
  batch: VoiceSuggestionBatchDto;
  onSelect: (suggestion: SuggestionDto) => void;
  onMore: () => void;
  moreLoading: boolean;
  moreError: string | null;
}) {
  const { ingredients, orientation } = batch.heard;
  return (
    <>
      <div data-testid="lecture-du-modele" className="mx-4 mb-3 rounded-card bg-raised px-4 py-3 text-[14px] leading-snug">
        <p className="font-medium">Ce que j’ai compris</p>
        <p className="text-muted">
          {ingredients.length > 0 ? ingredients.join(', ') : 'aucun ingrédient nommé'}
          {orientation ? ` · ${orientation}` : ''}
        </p>
      </div>

      {batch.items.length === 0 ? (
        <p className="mx-4 text-[14px] text-muted">
          Aucune recette ne correspond à cette demande. Reformulez-la, ou nommez moins d’ingrédients à la fois.
        </p>
      ) : (
        <>
          <ul className="flex flex-col gap-2 px-4">
            {batch.items.map((suggestion) => (
              <li key={suggestion.id}>
                <button type="button" aria-label={suggestionAccessibleName(suggestion)} className="block w-full text-left" onClick={() => onSelect(suggestion)}>
                  <SuggestionCard suggestion={suggestion} />
                </button>
              </li>
            ))}
          </ul>
          {/* Sous la liste : en redemander sans reparler. Le libellé dit sur
              quoi la relance porte, puisque ce n'est pas la voix mais la
              lecture qui en est faite. */}
          <div className="flex flex-col items-center gap-2 px-4 pb-6 pt-4">
            <Button block variant="outline" loading={moreLoading} onClick={onMore}>
              Proposer d’autres recettes
            </Button>
            <p className="text-center text-[13px] text-muted">À partir des ingrédients compris ci-dessus, sans avoir à reparler.</p>
            {moreError && <p className="text-center text-[13px] text-danger">{moreError}</p>}
          </div>
        </>
      )}
    </>
  );
}
