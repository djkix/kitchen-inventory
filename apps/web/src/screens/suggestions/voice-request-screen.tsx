import { VOICE_MAX_SECONDS, voiceAudioRejection, type AiRequestStatusDto, type SingleRecipeDto, type SuggestionDto } from '@kitchen/shared';
import { useMutation } from '@tanstack/react-query';
import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { ScreenHeader } from '../../components/shell/app-shell';
import { Spinner } from '../../components/ui/button';
import { forgetAiRequest, isDeferred } from '../../lib/ai-request';
import { api } from '../../lib/api';
import { DeferredNotice } from '../../components/ui/deferred-notice';
import { useTrackedRequest } from '../../hooks/use-tracked-request';
import { suggestionsApi } from '../../lib/suggestions-api';
import { isSingleRecipeAnswer, SingleRecipeAnswer } from './single-recipe-answer';
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
 * Un seul appel rend la lecture et la recette (D2) : la lecture est donc
 * affichée **avec** le résultat, pour qu'un contresens se voie sans coûter
 * une étape de confirmation.
 *
 * Depuis le 2026-11-24, la réponse est UNE recette et non plus une fournée :
 * c'est le même geste que la demande écrite, seule l'entrée change. Le bouton
 * « Proposer d'autres recettes » est parti avec les ingrédients imposés sur
 * lesquels il était bâti.
 */
export function VoiceRequestScreen() {
  const [answer, setAnswer] = useState<SingleRecipeDto | null>(null);
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
        // `isSingleRecipeAnswer` écarte les résultats écrits avant le
        // 2026-11-24, qui portent une fournée : les lire comme une recette
        // planterait l'écran.
        if (status.state === 'DONE' && isSingleRecipeAnswer(status.result)) {
          setAnswer(status.result);
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
    onSuccess: setAnswer,
  });


  const onRecorded = useCallback(
    (recording: VoiceRecording) => {
      setAnswer(null);
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
          Cette demande n’est plus disponible. Sa recette reste dans les suggestions.
        </p>
      )}

      {ask.isPending && (
        <div role="status" aria-live="polite" className="mx-4 my-6 flex flex-col items-center gap-3 text-center">
          <Spinner className="size-7 text-accent" />
          <p className="text-[15px] font-medium">Analyse de votre demande…</p>
          <p className="max-w-[32ch] text-[13px] text-muted">
            Le modèle écoute l’enregistrement, puis compose une recette avec ce que vous avez en stock.
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

      {answer && !ask.isPending && <SingleRecipeAnswer answer={answer} showHeard onSelect={setSelected} />}

      <SuggestionSheet suggestion={selected} open={selected !== null} onClose={() => setSelected(null)} />
    </>
  );
}
