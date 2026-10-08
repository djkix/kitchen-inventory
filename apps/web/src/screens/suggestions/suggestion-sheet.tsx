import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { DIFFICULTY_LABELS_FR, INGREDIENT_STATE_LABELS_FR, type KeepSuggestionInput, type RecipeDto, type SuggestionDto } from '@kitchen/shared';
import { Button } from '../../components/ui/button';
import { LocationChip } from '../../components/ui/location-chip';
import { Sheet } from '../../components/ui/sheet';
import { errorMessage, mediaUrl } from '../../lib/api';
import { formatMinutes, formatQuantity } from '../../lib/quantity-ui';
import { queryKeys } from '../../lib/queries';
import { suggestionsApi } from '../../lib/suggestions-api';
import { provenanceLabel } from './suggestion-card';

interface SuggestionSheetProps {
  suggestion: SuggestionDto | null;
  /** Identifiant du lot courant, requis par `keepSuggestionSchema` aux côtés de l'identifiant de la suggestion. */
  batchId: string;
  open: boolean;
  onClose: () => void;
  /**
   * Injectable pour les tests, sans jamais toucher au réseau (aucun test ne
   * doit en dépendre) ; branché sur `suggestionsApi.keep` en production.
   */
  keep?: (input: KeepSuggestionInput) => Promise<RecipeDto>;
}

/**
 * Fiche d'une suggestion (section 12, EF-25, EF-26, E2) : tout est affiché
 * d'emblée, sans repli — ingrédients et leur état face au stock, origine,
 * durées (y compris préparation/cuisson séparées), difficulté, provenance, et
 * les étapes quand elles sont disponibles (composition `ai`, déjà dans la
 * fournée). Pour une recette `web`, les étapes ne sont jamais devinées ici :
 * la page n'est lue qu'à la conservation (B6), et la fiche l'annonce
 * honnêtement plutôt que de laisser croire à un oubli (B7).
 *
 * Un seul geste : le bouton « Plus d'informations » (E2, round de correction
 * 1 — Franck a confirmé qu'il s'agissait d'un simple renommage de
 * « Conserver », pas d'un geste en deux temps) conserve la recette, déclenche
 * côté serveur la récupération de la page et sa réécriture par Gemini, d'où
 * l'attente explicite pendant l'appel.
 *
 * `clientOpId` est **déterministe** (round 1 de revue) — dérivé du lot et de
 * la suggestion, jamais tiré au hasard : un identifiant aléatoire régénéré à
 * chaque ouverture du tiroir se faisait oublier dès que Franck fermait la
 * fiche après un échec et la rouvrait pour réessayer, ce qui rejouait un
 * second appel payant si le premier avait en fait atteint Gemini (réponse
 * lente, délai du proxy) avant que le client ne voie l'échec. Une chaîne
 * dérivée reste stable d'une fermeture à l'autre, d'un remontage à l'autre,
 * de toute la session — sans état à tenir ni effet à faire tourner : deux
 * tentatives de conserver la même suggestion portent forcément le même
 * identifiant, ce qu'attend la colonne unique du serveur.
 *
 * Conséquence acceptée : si Franck conserve une suggestion, supprime la
 * recette de sa bibliothèque, puis conserve de nouveau la même suggestion, le
 * serveur ne retrouve aucune recette pour cet identifiant et en recrée une —
 * c'est le comportement voulu, pas un bug de déduplication.
 */
export function SuggestionSheet({ suggestion, batchId, open, onClose, keep = suggestionsApi.keep }: SuggestionSheetProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) setError(null);
  }, [open, suggestion?.id]);

  if (!suggestion) return null;

  const clientOpId = `keep:${batchId}:${suggestion.id}`;

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      const recipe = await keep({ batchId, suggestionId: suggestion.id, clientOpId });
      // Au succès : seule la liste des recettes change, la nouvelle venue y entre.
      // La fournée, elle, n'est pas invalidée : elle est mise en cache 24 heures
      // côté serveur et conserver une suggestion ne la modifie pas — la rejouer
      // ne ferait que redemander la même chose, sur la seule route payante du
      // module.
      await queryClient.invalidateQueries({ queryKey: queryKeys.recipesAll });
      onClose();
      // C'est là, et seulement là, que Franck lit enfin les étapes.
      navigate(`/recettes/${recipe.id}`);
    } catch (err) {
      // Message de l'API relayé tel quel (page injoignable 502, refus de
      // sécurité 422, réponse du modèle inexploitable 502, quota atteint 429) :
      // jamais un code brut, jamais une reformulation.
      setError(errorMessage(err, 'La conservation a échoué'));
    } finally {
      setBusy(false);
    }
  };

  const time = formatMinutes(suggestion.totalMinutes);

  return (
    <Sheet open={open} onClose={onClose} locked={busy} title={suggestion.title} description={provenanceLabel(suggestion)}>
      <div className="flex flex-col gap-4">
        <p className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[13px] text-muted">
          <span>{suggestion.origin}</span>
          <span aria-hidden>·</span>
          {time && <span className="tnum">{time}</span>}
          {time && <span aria-hidden>·</span>}
          <span>{DIFFICULTY_LABELS_FR[suggestion.difficulty]}</span>
        </p>

        <ul className="flex flex-col divide-y divide-line rounded-card bg-raised">
          {suggestion.ingredients.map((ingredient, index) => {
            const imageUrl = mediaUrl(ingredient.productImagePath);
            return (
              <li key={`${ingredient.label}-${index}`} className="flex items-start gap-3 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <span className="min-w-0 flex-1 text-[15px] leading-tight">{ingredient.label}</span>
                    <span className="shrink-0 text-[13px] text-muted">{INGREDIENT_STATE_LABELS_FR[ingredient.state]}</span>
                  </div>
                  {ingredient.quantity !== null && ingredient.unit !== null && (
                    <span className="block text-[13px] text-faint">{formatQuantity(ingredient.quantity, ingredient.unit)}</span>
                  )}
                  {/* Rapprochement approximatif (A11, B11) : jamais tu, pour que Franck
                      puisse corriger une mauvaise supposition avant de cuisiner. */}
                  {ingredient.match === 'probable' && ingredient.productName && (
                    <span className="block text-[13px] text-soon">
                      Rapprochement probable : « {ingredient.label} » → « {ingredient.productName} »
                    </span>
                  )}
                  {ingredient.locationName && (
                    <p className="mt-1">
                      <LocationChip name={ingredient.locationName} temperature={ingredient.locationTemperature} />
                    </p>
                  )}
                </div>
                {imageUrl && (
                  <img
                    src={imageUrl}
                    alt=""
                    loading="lazy"
                    className="ml-auto h-12 w-12 shrink-0 rounded-card object-cover"
                  />
                )}
              </li>
            );
          })}
        </ul>

        {suggestion.missingLabels.length > 0 && <p className="text-[13px] text-faint">Manque : {suggestion.missingLabels.join(', ')}</p>}

        {(suggestion.prepMinutes !== null || suggestion.cookMinutes !== null) && (
          <p className="flex flex-wrap gap-x-4 gap-y-0.5 text-[13px] text-muted">
            {suggestion.prepMinutes !== null && (
              <span>
                Préparation : <span className="tnum text-fg">{formatMinutes(suggestion.prepMinutes)}</span>
              </span>
            )}
            {suggestion.cookMinutes !== null && (
              <span>
                Cuisson : <span className="tnum text-fg">{formatMinutes(suggestion.cookMinutes)}</span>
              </span>
            )}
          </p>
        )}

        {/* Une composition sans étape reste possible (schéma partagé, pas de
            minimum côté DTO) : la section ne s'affiche que si la fournée en
            porte réellement, pour ne jamais rendre un cadre « Étapes » vide. */}
        {suggestion.provenance === 'ai' && suggestion.steps.length > 0 && (
          <section>
            <h2 className="mb-2 px-1 text-[13px] font-semibold text-muted">Étapes</h2>
            <ol className="flex flex-col gap-3 rounded-card bg-raised px-4 py-3">
              {suggestion.steps.map((step, index) => (
                <li key={index} className="flex gap-3 text-[15px] leading-snug">
                  <span className="tnum shrink-0 font-semibold text-accent">{index + 1}</span>
                  <span>{step}</span>
                </li>
              ))}
            </ol>
          </section>
        )}

        {suggestion.provenance === 'web' && (
          // Honnête, pas un aveu de manque : la page de cette recette n'est
          // récupérée et réécrite qu'au moment de la conservation (B6), donc
          // ses étapes ne sont tout simplement pas encore là.
          <p className="rounded-card bg-raised px-4 py-3 text-[13px] text-muted">
            Le détail des étapes n’est pas encore disponible : il viendra avec la conservation, qui récupère et réécrit la recette complète.
          </p>
        )}

        {busy && (
          <p role="status" aria-live="polite" className="text-[13px] text-muted">
            Extraction de la recette en cours… cela peut prendre plusieurs secondes.
          </p>
        )}

        {error && (
          <p role="alert" className="text-[13px] text-danger">
            {error}
          </p>
        )}

        <Button variant="primary" block loading={busy} disabled={busy} onClick={() => void confirm()}>
          Plus d’informations
        </Button>
      </div>
    </Sheet>
  );
}
