import { Link } from 'react-router';
import { ScreenHeader } from '../../components/shell/app-shell';
import { Spinner } from '../../components/ui/button';
import { EmptyState, ErrorState } from '../../components/ui/empty-state';
import { isApiError } from '../../lib/api';
import { useSuggestionsQuery } from '../../lib/queries';
import { SuggestionCard } from './suggestion-card';

/**
 * Écran Suggestions (section 12, EF-25, EF-26) : entrée du module recettes —
 * « que puis-je cuisiner ce soir avec ce que j'ai ? ». Pas d'orientation
 * branchée ici (tâche 11) et aucune conservation (tâche 12) : seulement la
 * liste et ses six états, chacun avec son message français.
 */
export function SuggestionsScreen() {
  // Orientation vide pour l'instant : aucune contrainte, le serveur compose
  // depuis le stock réel seul. Les filtres de la tâche 11 passeront ici.
  const suggestions = useSuggestionsQuery({});

  return (
    <>
      <ScreenHeader title="Suggestions" subtitle="À partir de votre stock" />

      {suggestions.isPending ? (
        <WaitingState />
      ) : suggestions.isError ? (
        <SuggestionsErrorState error={suggestions.error} onRetry={() => void suggestions.refetch()} />
      ) : (
        <SuggestionsResult batch={suggestions.data} />
      )}
    </>
  );
}

/**
 * Attente explicite : la composition d'une fournée interroge un fournisseur
 * d'IA et prend plusieurs secondes (section 12, B8) — un squelette de liste
 * laisserait croire à un chargement instantané qui ne vient jamais.
 */
function WaitingState() {
  return (
    <div role="status" aria-live="polite" className="mx-4 my-10 flex flex-col items-center gap-3 py-10 text-center">
      <Spinner className="size-7 text-accent" />
      <p className="text-[15px] font-medium">Recherche de recettes en cours…</p>
      <p className="max-w-[32ch] text-[13px] text-muted">
        Cela peut prendre plusieurs secondes : le modèle compose une fournée à partir de votre stock.
      </p>
    </div>
  );
}

/** Exporté pour être testé isolément, sans dépendre d'un réseau simulé (section « aucun test ne dépend du réseau »). */
export function SuggestionsErrorState({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  if (isApiError(error, 'provider_disabled')) {
    return (
      <EmptyState
        title="Aucun fournisseur de suggestions configuré"
        // Message du serveur, jamais réécrit : lui seul nomme les deux variables
        // d'environnement attendues (`VISION_PROVIDER`, `VISION_API_KEY`), une
        // configuration côté serveur, pas un réglage accessible dans l'application.
        description={error.message}
        action={
          <Link to="/reglages" className="inline-flex min-h-touch items-center rounded-xl bg-accent px-4 text-[15px] font-semibold text-ink">
            Aller aux réglages
          </Link>
        }
      />
    );
  }

  if (isApiError(error, 'conflict')) {
    return (
      <EmptyState
        title="Stock insuffisant pour suggérer"
        description="Il n’y a pas encore assez d’ingrédients identifiés dans le stock pour composer une recherche de recettes."
      />
    );
  }

  if (isApiError(error, 'rate_limited')) {
    return <ErrorState title="Quota de suggestions atteint" message={error.message} onRetry={onRetry} />;
  }

  // `provider_unavailable`, `provider_invalid_response`, panne réseau ou erreur
  // inattendue : le modèle n'a pas pu répondre, pas de distinction plus fine à
  // montrer à l'écran (section 12).
  return (
    <ErrorState
      title="La recherche de recettes a échoué"
      message="Le modèle n’a pas pu répondre. Réessayez dans un instant."
      onRetry={onRetry}
    />
  );
}

function SuggestionsResult({ batch }: { batch: ReturnType<typeof useSuggestionsQuery>['data'] }) {
  if (!batch) return null;

  return (
    <>
      {batch.notice && (
        <p role="status" className="mx-4 mb-3 rounded-card bg-raised px-4 py-3 text-[14px] leading-snug">
          {batch.notice}
        </p>
      )}

      {batch.items.length === 0 ? (
        <EmptyState
          title="Aucune suggestion pour cette orientation"
          description="Essayez une orientation différente, ou revenez plus tard : le stock aura peut-être changé."
        />
      ) : (
        <ul className="flex flex-col gap-2 px-4">
          {batch.items.map((suggestion) => (
            <li key={suggestion.id}>
              <SuggestionCard suggestion={suggestion} />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
