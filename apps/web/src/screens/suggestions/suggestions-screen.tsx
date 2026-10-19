import { SUGGESTION_PAGE_SIZE, type SuggestionDto } from '@kitchen/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { ScreenHeader } from '../../components/shell/app-shell';
import { Spinner } from '../../components/ui/button';
import { EmptyState, ErrorState } from '../../components/ui/empty-state';
import { isApiError } from '../../lib/api';
import { useSuggestionsQuery } from '../../lib/queries';
import type { SuggestionOrientation } from '../../lib/suggestions-api';
import { DishTypeQuestion, useDishTypeAnswer } from './dish-type-question';
import { IngredientsField } from './ingredients-field';
import { OrientationBar } from './orientation-bar';
import { SuggestionCard, suggestionAccessibleName } from './suggestion-card';
import { SuggestionSheet } from './suggestion-sheet';
import { RecipeTabSwitch } from '../recipes/recipe-tab-switch';

/**
 * Écran Suggestions (section 12, EF-25, EF-26) : entrée du module recettes —
 * « que puis-je cuisiner ce soir avec ce que j'ai ? ». L'orientation par type
 * de plat, région, durée et difficulté relance une vraie recherche à chaque
 * geste ; aucune conservation ici (tâche 12).
 *
 * Question bloquante de type de plat (tâche 2, EF-25, décisions D2/D3 du
 * 2026-10-11) : tant qu'aucun type n'est choisi, rien d'autre ne s'affiche —
 * ni liste, ni squelette, ni barre de filtres. La première réponse oriente la
 * requête initiale (`SuggestionOrientation.dishType`, un vrai appel part de
 * toute façon) ; `useDishTypeAnswer` la garde en mémoire au-delà du
 * démontage de cet écran, qui survient en visitant la fiche d'une recette
 * conservée (route distincte) puis en y revenant.
 *
 * Revue finale du 2026-10-11 : le sélecteur « Type de plat » de la barre est
 * désormais le contrôle UNIQUE du type — il relance comme les trois autres
 * (voir `orientation-bar.tsx`). Le bouton séparé « Relancer une recherche
 * avec un autre type de plat », le filtre local et l'état vide « Aucun X
 * dans cette fournée » ont disparu avec lui : une fournée mono-type (la
 * question envoie désormais le type au modèle, qui ne propose plus que ce
 * type-là) ne peut plus rendre un autre type à filtrer localement, ces
 * contrôles n'avaient donc plus d'objet.
 *
 * Un bouton de relance revient le 2026-10-15, mais **uniquement dans l'état
 * vide** : depuis la décision D11, une orientation déjà cherchée ne repart pas
 * d'elle-même avant 24 heures, et `refresh: true` en est la seule sortie — or
 * plus aucun appelant ne le posait. Il n'apparaît que lorsqu'il sert, pour ne
 * pas remanger l'espace d'écran que le lot du 2026-10-11 avait rendu.
 */


export function SuggestionsScreen() {
  const { dishType: answeredDishType, answer: answerDishType } = useDishTypeAnswer();
  // Orientation vide tant qu'aucun type n'est répondu ; une fois répondu, elle
  // part dans la requête initiale et continue d'y porter le type (le
  // sélecteur de la barre en prend ensuite le contrôle).
  const [orientation, setOrientation] = useState<SuggestionOrientation>(() => (answeredDishType ? { dishType: answeredDishType } : {}));
  /**
   * Nombre de relances explicites demandées sur l'orientation courante (revue
   * de la tâche 4, tour 3). Il vit **hors** de l'orientation : posé dedans, un
   * `refresh: true` y restait collé jusqu'au geste suivant sur un filtre, et
   * tout retour sur l'onglet repayait un appel. Remis à zéro à chaque
   * changement d'orientation, qui est déjà une nouvelle recherche en soi.
   *
   * Il est local à cet écran, donc perdu au démontage et remis à zéro ici :
   * ce n'est pas lui qui entre dans la clé de requête — `useSuggestionsQuery`
   * le traduit en un jeton qui ne redescend jamais, sans quoi un appui après
   * un aller-retour par « Mes recettes » retomberait sur une clé déjà en
   * cache et ne partirait pas (revue finale du 2026-10-15).
   */
  const [relaunch, setRelaunch] = useState(0);
  // Référence stable : la sentinelle du défilement infini la met en dépendance
  // de son effet, et une fonction recréée à chaque rendu rebrancherait
  // l'observateur en boucle.
  const loadMore = useCallback(() => {
    setRelaunch(0);
    setLimit((size) => size + SUGGESTION_PAGE_SIZE);
  }, []);
  /**
   * Taille de la page demandée au serveur (2026-10-19). « Plus je fais de
   * requêtes, plus j'emmagasine de recettes » — mais l'écran n'en montrait
   * jamais que la première page, et rien ne permettait de voir les autres :
   * un réservoir de trente-sept recettes en cachait vingt-cinq, définitivement.
   * Même geste que « Mes recettes » : un bouton « Charger plus (X sur Y) » qui
   * allonge la liste, bornée par le schéma partagé (`SUGGESTION_PAGE_MAX`).
   */
  const [limit, setLimit] = useState(SUGGESTION_PAGE_SIZE);
  // Pas d'appel tant que la question n'a pas de réponse (voir `useSuggestionsQuery`).
  const suggestions = useSuggestionsQuery(orientation, { enabled: answeredDishType !== null, relaunch, limit });
  // Suggestion ouverte dans la fiche de conservation (tâche 12) ; `null` quand le tiroir est fermé.
  const [selected, setSelected] = useState<SuggestionDto | null>(null);

  if (!answeredDishType) {
    return (
      <>
        <ScreenHeader title="Suggestions" subtitle="À partir de votre stock" />
        <RecipeTabSwitch />
        <DishTypeQuestion
          onSelect={(type) => {
            answerDishType(type);
            // Le type répondu devient l'orientation : la question n'est posée que
            // sur une orientation vide, il n'y a donc jamais rien à fusionner.
            setOrientation({ dishType: type });
          }}
        />
      </>
    );
  }

  return (
    <>
      <ScreenHeader title="Suggestions" subtitle="À partir de votre stock" />

      <RecipeTabSwitch />

      {/* Au-dessus des filtres (D6, 2026-10-19), et vide par défaut : ce qui est
          tapé ici est imposé à chaque recette proposée, le stock venant en plus. */}
      <IngredientsField
        value={orientation.ingredients ?? ''}
        onChange={(raw) => {
          // Une autre demande est une autre recherche : mêmes remises à zéro
          // que pour un changement d'orientation.
          setRelaunch(0);
          setLimit(SUGGESTION_PAGE_SIZE);
          setOrientation((current) => ({ ...current, ingredients: raw === '' ? undefined : raw, refresh: undefined }));
        }}
      />

      <OrientationBar
        value={orientation}
        onChange={(next) => {
          // Une orientation différente est déjà une nouvelle recherche : le
          // compteur de relances repart de zéro, sans quoi il resterait collé
          // exactement comme le faisait `refresh: true` avant lui.
          setRelaunch(0);
          // Une autre orientation est une autre liste : la page repart au début.
          setLimit(SUGGESTION_PAGE_SIZE);
          setOrientation(next);
        }}
      />

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
            // L'état vide doit dire POURQUOI il est vide : imposer tous les
            // ingrédients dictés (D1) rend peu de chose sur une combinaison
            // inhabituelle, et une liste vide et muette ne l'explique pas.
            dictated={orientation.ingredients !== undefined}
            // Seule sortie du verrou de 24 heures posé par la décision D11 du
            // 2026-10-15 : sans `refresh`, une orientation que le modèle n'a
            // jamais su satisfaire reste vide jusqu'au bout du délai. Le
            // serveur accepte `refresh` depuis toujours, mais plus aucun
            // appelant ne le posait depuis la disparition du bouton de relance
            // au lot du 2026-10-11 — le recours existait sans être atteignable.
            // Un compteur, pas un drapeau (tour 3) : chaque appui change la clé
            // de requête, donc relance réellement, et rien ne reste posé dans
            // l'orientation entre deux recherches.
            onRefresh={() => setRelaunch((count) => count + 1)}
            // Charger plus ne relit que le réservoir : le compteur de relances
            // retombe à zéro pour que `refresh` ne reparte pas avec la
            // nouvelle clé de requête, et qu'une page de plus ne coûte jamais
            // un appel au modèle.
            onLoadMore={loadMore}
          />
        </>
      )}

      {suggestions.data && (
        <SuggestionSheet suggestion={selected} open={selected !== null} onClose={() => setSelected(null)} />
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

/**
 * Plus de filtre local par type (revue finale du 2026-10-11) : le type de
 * plat est désormais une orientation serveur, la fournée qu'il contraint est
 * mono-type — `batch.items` n'a donc plus jamais besoin d'être filtré ici,
 * et l'état vide dédié « Aucun X dans cette fournée » avec son bouton de
 * relance ciblée a disparu avec lui (une relance par type ne peut plus
 * rendre un autre type à proposer).
 */
/**
 * Déclenche `onVisible` dès que ce point entre dans la fenêtre : c'est le
 * défilement infini de la liste de suggestions.
 *
 * `rootMargin` anticipe de 200 px pour que la page suivante soit demandée
 * avant que le pouce n'atteigne le bas — sinon le défilement s'arrête net le
 * temps de la requête, ce qui se ressent comme un à-coup.
 *
 * L'observateur est débranché dès qu'il a servi, et reconstruit au rendu
 * suivant si la liste n'est toujours pas complète : sans cela, une sentinelle
 * restée visible pendant le chargement redemanderait la même page en boucle.
 */
function LoadMoreSentinel({ onVisible }: { onVisible: () => void }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          observer.disconnect();
          onVisible();
        }
      },
      { rootMargin: '200px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [onVisible]);

  return <div ref={ref} aria-hidden className="h-px w-full" />;
}

function SuggestionsResult({
  batch,
  onSelect,
  onRefresh,
  onLoadMore,
  dictated,
}: {
  batch: ReturnType<typeof useSuggestionsQuery>['data'];
  onSelect: (suggestion: SuggestionDto) => void;
  onRefresh: () => void;
  onLoadMore: () => void;
  /** Une demande porte des ingrédients dictés : l'état vide s'explique autrement. */
  dictated: boolean;
}) {
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
          title={dictated ? 'Aucune recette avec ces ingrédients' : 'Aucune suggestion pour cette orientation'}
          // « Revenez plus tard, le stock aura peut-être changé » était devenu
          // faux : depuis la décision D11 du 2026-10-15, la recherche ne dépend
          // plus du contenu du placard — on invitait à faire la seule chose qui
          // ne peut plus rien y changer. Les deux vraies sorties sont dites
          // ici, et le bouton rend la seconde atteignable.
          description={
            dictated
              ? // Limite assumée de D1 : chaque recette doit utiliser TOUS les
                // ingrédients saisis, et une combinaison rare n'en rend que peu.
                'La combinaison demandée est trop rare : chaque recette doit utiliser tous les ingrédients saisis. Retirez-en un, élargissez l’orientation, ou lancez vous-même une nouvelle recherche.'
              : 'Changez d’orientation — une autre cuisine, une durée plus large — ou lancez vous-même une nouvelle recherche.'
          }
          action={
            <button
              type="button"
              onClick={onRefresh}
              className="min-h-touch rounded-xl bg-accent px-4 text-[15px] font-semibold text-ink"
            >
              Chercher de nouvelles recettes
            </button>
          }
        />
      ) : (
        <ul className="flex flex-col gap-2 px-4">
          {batch.items.map((suggestion) => (
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

      {batch.items.length > 0 && (
        /*
         * Pied de liste (2026-10-19). Le bouton de relance n'existait que dans
         * l'état vide : dès que le réservoir rendait six recettes ou plus pour
         * l'orientation, plus aucun appel ne partait et rien ne permettait d'en
         * demander d'autres — djkix a vu « toujours les mêmes douze recettes »,
         * et c'était exact. Les deux nombres disent pourquoi : ce qui est connu
         * pour cette orientation, et ce que l'application connaît en tout.
         */
        <div className="flex flex-col items-center gap-3 px-4 pb-6 pt-5">
          {/*
            Défilement infini (demande de djkix, 2026-10-19 : « je suis obligé
            de cliquer sur charger plus »). La sentinelle ci-dessous demande la
            page suivante dès qu'elle entre dans la fenêtre.

            Le bouton reste rendu, et ce n'est pas une hésitation : un
            observateur d'intersection ne se déclenche ni au clavier seul, ni
            pour un lecteur d'écran qui parcourt la page sans la faire défiler,
            ni si le navigateur ne le fournit pas. Il porte donc le même
            libellé qu'avant et sert de repli — invisible en pratique, puisque
            la sentinelle l'aura déjà fait disparaître en chargeant la suite.

            Charger ne coûte jamais un appel au modèle : c'est une relecture du
            réservoir, bornée à soixante recettes par orientation.
          */}
          {batch.items.length < batch.poolCount && (
            <>
              <LoadMoreSentinel onVisible={onLoadMore} />
              <button
                type="button"
                onClick={onLoadMore}
                className="min-h-touch w-full rounded-xl bg-accent px-4 text-[15px] font-semibold text-ink"
              >
                Charger plus (<span className="tnum">{batch.items.length}</span> sur <span className="tnum">{batch.poolCount}</span>)
              </button>
            </>
          )}
          <p className="text-center text-[13px] text-muted">
            <span className="tnum">{batch.poolCount}</span> recette{batch.poolCount > 1 ? 's' : ''} connue{batch.poolCount > 1 ? 's' : ''} pour cette
            orientation · <span className="tnum">{batch.poolTotal}</span> en tout
          </p>
          <button
            type="button"
            onClick={onRefresh}
            className="min-h-touch rounded-xl border border-line px-4 text-[14px] font-medium text-accent active:bg-raised"
          >
            Chercher de nouvelles recettes
          </button>
        </div>
      )}
    </>
  );
}
