import { VOICE_MAX_SECONDS, voiceAudioRejection, type SuggestionDto, type VoiceSuggestionBatchDto } from '@kitchen/shared';
import { useMutation } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import { ScreenHeader } from '../../components/shell/app-shell';
import { Spinner } from '../../components/ui/button';
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
 * dans son en-tête — il a été allégé trois fois à la demande de djkix, un
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

  const ask = useMutation({
    mutationFn: (recording: VoiceRecording) => suggestionsApi.voice(recording.blob, recording.mimeType),
    onSuccess: setBatch,
  });

  const onRecorded = useCallback(
    (recording: VoiceRecording) => {
      setBatch(null);
      // Même règle que le serveur, qui la revérifie (D8) : un client n'est
      // jamais une garantie, mais refuser ici évite un aller-retour inutile
      // et dit tout de suite pourquoi.
      const refus = voiceAudioRejection(recording.blob.size, recording.mimeType);
      setRejection(refus);
      if (refus) return;
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
          Suggestions : quota, fournisseur absent, demande non comprise. */}
      {ask.isError && <SuggestionsErrorState error={ask.error} onRetry={() => ask.reset()} />}

      {batch && !ask.isPending && <VoiceResult batch={batch} onSelect={setSelected} />}

      <SuggestionSheet suggestion={selected} open={selected !== null} onClose={() => setSelected(null)} />
    </>
  );
}

/**
 * La lecture du modèle, puis les recettes. La lecture d'abord, et toujours :
 * c'est elle qui permet de reconnaître un contresens avant de lire douze
 * recettes à côté de la plaque (D2).
 */
function VoiceResult({ batch, onSelect }: { batch: VoiceSuggestionBatchDto; onSelect: (suggestion: SuggestionDto) => void }) {
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
        <ul className="flex flex-col gap-2 px-4 pb-6">
          {batch.items.map((suggestion) => (
            <li key={suggestion.id}>
              <button type="button" aria-label={suggestionAccessibleName(suggestion)} className="block w-full text-left" onClick={() => onSelect(suggestion)}>
                <SuggestionCard suggestion={suggestion} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
