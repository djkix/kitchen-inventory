import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { DIFFICULTY_LABELS_FR, INGREDIENT_STATE_LABELS_FR, type KeepSuggestionInput, type RecipeDto, type SuggestionDto } from '@kitchen/shared';
import { Button } from '../../components/ui/button';
import { Sheet } from '../../components/ui/sheet';
import { errorMessage, newClientOpId } from '../../lib/api';
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
 * Fiche d'une suggestion (section 12, EF-25, EF-26) : ingrédients et leur état
 * face au stock, origine, durée, difficulté et provenance — jamais d'étapes,
 * qui ne doivent se lire qu'une fois la recette conservée (B7). Une seule
 * action : conserver, qui déclenche côté serveur la récupération de la page
 * et sa réécriture par Gemini (B6), d'où l'attente explicite pendant l'appel.
 *
 * `clientOpId` est tiré une seule fois par ouverture de la fiche sur une
 * suggestion donnée — pas à chaque rendu, pas à chaque appui — et conservé
 * pour toute nouvelle tentative de la même conservation (double appui, erreur
 * suivie d'un nouvel essai), afin qu'un rejeu ne déclenche jamais un second
 * appel payant au fournisseur : le serveur rend alors la recette déjà créée.
 */
export function SuggestionSheet({ suggestion, batchId, open, onClose, keep = suggestionsApi.keep }: SuggestionSheetProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [clientOpId, setClientOpId] = useState(() => newClientOpId());

  useEffect(() => {
    if (!open) return;
    setClientOpId(newClientOpId());
    setError(null);
  }, [open, suggestion?.id]);

  if (!suggestion) return null;

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      const recipe = await keep({ batchId, suggestionId: suggestion.id, clientOpId });
      // Au succès : la liste des recettes porte la nouvelle venue, la fournée
      // n'a plus à proposer ce qui vient d'être conservé.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.recipesAll }),
        queryClient.invalidateQueries({ queryKey: queryKeys.suggestionsAll }),
      ]);
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
          {suggestion.ingredients.map((ingredient, index) => (
            <li key={`${ingredient.label}-${index}`} className="flex flex-col gap-0.5 px-3 py-2">
              <div className="flex items-start justify-between gap-2">
                <span className="min-w-0 flex-1 text-[15px] leading-tight">{ingredient.label}</span>
                <span className="shrink-0 text-[13px] text-muted">{INGREDIENT_STATE_LABELS_FR[ingredient.state]}</span>
              </div>
              {ingredient.quantity !== null && ingredient.unit !== null && (
                <span className="text-[13px] text-faint">{formatQuantity(ingredient.quantity, ingredient.unit)}</span>
              )}
              {/* Rapprochement approximatif (A11, B11) : jamais tu, pour que Franck
                  puisse corriger une mauvaise supposition avant de cuisiner. */}
              {ingredient.match === 'probable' && ingredient.productName && (
                <span className="text-[13px] text-soon">
                  Rapprochement probable : « {ingredient.label} » → « {ingredient.productName} »
                </span>
              )}
            </li>
          ))}
        </ul>

        {suggestion.missingLabels.length > 0 && <p className="text-[13px] text-faint">Manque : {suggestion.missingLabels.join(', ')}</p>}

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
          Conserver
        </Button>
      </div>
    </Sheet>
  );
}
