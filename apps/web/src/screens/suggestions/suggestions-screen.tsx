import { DISH_TYPE_LABELS_FR, type DishType, type SuggestionDto } from '@kitchen/shared';
import { useState } from 'react';
import { Link } from 'react-router';
import { ScreenHeader } from '../../components/shell/app-shell';
import { Spinner } from '../../components/ui/button';
import { EmptyState, ErrorState } from '../../components/ui/empty-state';
import { isApiError } from '../../lib/api';
import { useSuggestionsQuery } from '../../lib/queries';
import type { SuggestionOrientation } from '../../lib/suggestions-api';
import { DishTypeQuestion, useDishTypeAnswer } from './dish-type-question';
import { OrientationBar } from './orientation-bar';
import { SuggestionCard, suggestionAccessibleName } from './suggestion-card';
import { SuggestionSheet } from './suggestion-sheet';
import { RecipeTabSwitch } from '../recipes/recipe-tab-switch';

/**
 * Écran Suggestions (section 12, EF-25, EF-26) : entrée du module recettes —
 * « que puis-je cuisiner ce soir avec ce que j'ai ? ». L'orientation par
 * région, durée et difficulté (tâche 11) relance une vraie recherche à chaque
 * geste ; aucune conservation ici (tâche 12).
 *
 * Question bloquante de type de plat (tâche 2, EF-25, décisions D2/D3 du
 * 2026-10-11) : tant qu'aucun type n'est choisi, rien d'autre ne s'affiche —
 * ni liste, ni squelette, ni barre de filtres. La première réponse oriente la
 * requête initiale (`SuggestionOrientation.dishType`, un vrai appel part de
 * toute façon) ; `useDishTypeAnswer` la garde en mémoire au-delà du
 * démontage de cet écran, qui survient en visitant la fiche d'une recette
 * conservée (route distincte) puis en y revenant.
 */
export function SuggestionsScreen() {
  const { dishType: answeredDishType, answer: answerDishType, askAgain } = useDishTypeAnswer();
  // Orientation vide tant qu'aucun type n'est répondu ; une fois répondu, elle
  // part dans la requête initiale et ne change plus pour ce seul champ — les
  // changements suivants de type filtrent la fournée déjà chargée (tâche 3,
  // D4), jamais une relance.
  const [orientation, setOrientation] = useState<SuggestionOrientation>(() => (answeredDishType ? { dishType: answeredDishType } : {}));
  // Pas d'appel tant que la question n'a pas de réponse (voir `useSuggestionsQuery`).
  const suggestions = useSuggestionsQuery(orientation, { enabled: answeredDishType !== null });
  // Suggestion ouverte dans la fiche de conservation (tâche 12) ; `null` quand le tiroir est fermé.
  const [selected, setSelected] = useState<SuggestionDto | null>(null);
  // Filtre d'écran, pas une orientation : Gemini classe les douze recettes de la
  // fournée, le tri se fait donc ici, sans appel ni dépense (choix de Franck du
  // 2026-10-08). La relance ciblée reste possible, mais demandée explicitement.
  //
  // Volontairement non préremplie par la réponse à la question bloquante : la
  // demande envoyée au modèle n'est qu'une orientation, pas une garantie — si
  // la fournée revient avec un autre mélange de types, préfiltrer ici
  // reproduirait localement le pire enchaînement que D3 cherche à éviter côté
  // serveur (une liste vide juste après avoir répondu).
  const [dishType, setDishType] = useState<DishType | undefined>(undefined);

  if (!answeredDishType) {
    return (
      <>
        <ScreenHeader title="Suggestions" subtitle="À partir de votre stock" />
        <RecipeTabSwitch />
        <DishTypeQuestion
          onSelect={(type) => {
            answerDishType(type);
            setOrientation((current) => ({ ...current, dishType: type }));
          }}
        />
      </>
    );
  }

  return (
    <>
      <ScreenHeader title="Suggestions" subtitle="À partir de votre stock" />

      <RecipeTabSwitch />

      <OrientationBar value={orientation} onChange={setOrientation} dishType={dishType} onDishTypeChange={setDishType} />

      <div className="px-4 pb-3">
        <button type="button" onClick={askAgain} className="min-h-touch text-[14px] font-medium text-accent active:underline">
          Changer de type de plat
        </button>
      </div>

      {suggestions.isPending ? (
        <WaitingState />
      ) : suggestions.isError ? (
        <SuggestionsErrorState error={suggestions.error} onRetry={() => void suggestions.refetch()} />
      ) : (
        <>
          {/* La fournée précédente reste affichée pendant qu'une orientation différente
              est recherchée (`placeholderData: keepPreviousData`) : seul ce bandeau dit
              qu'un nouvel appel est en cours, la liste ne se vide jamais pour autant. */}
          {suggestions.isFetching && <RefetchingBanner />}
          <SuggestionsResult
            batch={suggestions.data}
            onSelect={setSelected}
            dishType={dishType}
            onSearchDishType={() => setOrientation({ ...orientation, dishType, refresh: true })}
          />
        </>
      )}

      {suggestions.data && (
        <SuggestionSheet suggestion={selected} batchId={suggestions.data.batchId} open={selected !== null} onClose={() => setSelected(null)} />
      )}
    </>
  );
}

function RefetchingBanner() {
  return (
    <div role="status" aria-live="polite" className="mx-4 mb-3 flex items-center gap-2 text-[13px] text-muted">
      <Spinner className="size-4 text-accent" />
      <span>Recherche d’une nouvelle fournée…</span>
    </div>
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

  // Clé sur le code, jamais sur le statut : un autre 409 sur cette route ne
  // doit pas se faire passer pour un stock insuffisant.
  if (isApiError(error, 'insufficient_stock')) {
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
  // inattendue. Le message du serveur est repris tel quel quand il existe : il
  // nomme la panne (« en erreur (404) », « en erreur (429) »), et sans lui un
  // modèle mal configuré est indiscernable d'un quota épuisé ou d'une coupure
  // réseau. C'est ce qui a laissé l'écran vide sans explication de la 0.8.0 à
  // la 0.9.2, le temps d'aller lire les journaux du serveur.
  return (
    <ErrorState
      title="La recherche de recettes a échoué"
      message={isApiError(error) && error.message ? error.message : 'Le modèle n’a pas pu répondre. Réessayez dans un instant.'}
      onRetry={onRetry}
    />
  );
}

function SuggestionsResult({
  batch,
  onSelect,
  dishType,
  onSearchDishType,
}: {
  batch: ReturnType<typeof useSuggestionsQuery>['data'];
  onSelect: (suggestion: SuggestionDto) => void;
  dishType: DishType | undefined;
  onSearchDishType: () => void;
}) {
  if (!batch) return null;

  const items = dishType ? batch.items.filter((item) => item.dishType === dishType) : batch.items;

  return (
    <>
      {batch.notice && (
        <p role="status" className="mx-4 mb-3 rounded-card bg-raised px-4 py-3 text-[14px] leading-snug">
          {batch.notice}
        </p>
      )}

      {items.length === 0 ? (
        dishType && batch.items.length > 0 ? (
          // La fournée existe mais ne contient pas ce type : le filtre est gratuit,
          // la relance ne l'est pas — elle reste donc un geste explicite.
          <EmptyState
            title={`Aucun ${DISH_TYPE_LABELS_FR[dishType].toLowerCase()} dans cette fournée`}
            description="Les recettes proposées sont d’un autre type. Vous pouvez en demander une nouvelle série, ciblée cette fois."
            action={
              <button
                type="button"
                onClick={onSearchDishType}
                className="inline-flex min-h-touch items-center rounded-xl bg-accent px-4 text-[15px] font-semibold text-ink"
              >
                Chercher des {DISH_TYPE_LABELS_FR[dishType].toLowerCase()}s
              </button>
            }
          />
        ) : (
          <EmptyState
            title="Aucune suggestion pour cette orientation"
            description="Essayez une orientation différente, ou revenez plus tard : le stock aura peut-être changé."
          />
        )
      ) : (
        <ul className="flex flex-col gap-2 px-4">
          {items.map((suggestion) => (
            <li key={suggestion.id}>
              {/* La carte elle-même reste purement présentative (tâche 10) : le
                  tiroir de conservation (tâche 12) s'ouvre depuis cet écran. */}
              <button
                type="button"
                aria-label={suggestionAccessibleName(suggestion)}
                className="block w-full text-left"
                onClick={() => onSelect(suggestion)}
              >
                <SuggestionCard suggestion={suggestion} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
