import { useRef } from 'react';
import { keepPreviousData, useInfiniteQuery, useQuery, useQueryClient, type InfiniteData, type QueryClient } from '@tanstack/react-query';
import type {
  AccountDto,
  AuthStatus,
  AvailableModels,
  CategoryDto,
  CurrentUser,
  LocationNode,
  Paginated,
  ProductDto,
  RecipeDto,
  RecipeListQuery,
  RecipeLogDto,
  RecipeSummaryDto,
  RecognitionStats,
  Settings,
  StockItemDto,
  UpdateRecipeInput,
} from '@kitchen/shared';
import { api } from './api';
import { receiptsApi } from './receipts-api';
import { recipesApi } from './recipes-api';
import { suggestionsApi, type SuggestionOrientation } from './suggestions-api';
import type { CuisineDto, HealthReport, ServiceTokenDto } from './types';

export const PAGE_SIZE = 50;

export interface StockListParams {
  q?: string;
  location?: string;
  status?: 'active' | 'archived' | 'all';
  product?: string;
}

export const queryKeys = {
  authStatus: ['auth', 'status'] as const,
  googleClientId: ['auth', 'google-client-id'] as const,
  me: ['auth', 'me'] as const,
  stock: (params: StockListParams) => ['stock', 'list', params] as const,
  stockAll: ['stock'] as const,
  stockItem: (id: string) => ['stock', 'item', id] as const,
  expiring: ['stock', 'expiring'] as const,
  locations: ['locations'] as const,
  categories: ['categories'] as const,
  settings: ['settings'] as const,
  availableModels: ['settings', 'models'] as const,
  accounts: ['accounts'] as const,
  serviceTokens: ['service-tokens'] as const,
  recognitionStats: ['recognition', 'stats'] as const,
  products: (q: string) => ['products', q] as const,
  health: ['health'] as const,
  recipes: (params: RecipeListParams) => ['recipes', 'list', params] as const,
  recipesAll: ['recipes', 'list'] as const,
  recipe: (id: string) => ['recipes', 'item', id] as const,
  // Parts demandées (EF-26) en queue de clé : `recipe(id)` reste un préfixe
  // valide de cette clé, donc invalider `recipe(id)` invalide bien toutes les
  // variantes de parts mises en cache pour cette recette.
  recipeDetail: (id: string, servings?: number) => [...queryKeys.recipe(id), servings ?? null] as const,
  recipeLogs: (recipeId: string) => ['recipes', 'item', recipeId, 'logs'] as const,
  cuisines: ['cuisines'] as const,
  recipeFilters: ['preferences', 'recipe-filters'] as const,
  pendingRating: ['recipes', 'pending-rating'] as const,
  receipt: (id: string) => ['receipts', 'item', id] as const,
  pendingLabels: ['receipts', 'pending-labels'] as const,
  pendingLabelCount: ['receipts', 'pending-label-count'] as const,
  suggestions: (orientation: SuggestionOrientation) => ['suggestions', 'list', orientation] as const,
};

export type RecipeListParams = Omit<RecipeListQuery, 'page' | 'limit'>;

export function useAuthStatusQuery() {
  return useQuery({
    queryKey: queryKeys.authStatus,
    queryFn: () => api.get<AuthStatus>('/auth/status', { skipAuthRedirect: true }),
    staleTime: 60_000,
    retry: 1,
  });
}

/**
 * Client ID Google, lu à l'exécution : Vite fige ses variables au build et
 * l'image du projet est construite une seule fois par la CI — une variable de
 * build serait vide en production. Chaîne vide = connexion Google non
 * configurée.
 */
export function useGoogleClientIdQuery() {
  return useQuery({
    queryKey: queryKeys.googleClientId,
    queryFn: () => api.get<{ clientId: string }>('/auth/google/client-id', { skipAuthRedirect: true }),
    staleTime: Infinity,
  });
}

export function useMeQuery(enabled = true) {
  return useQuery({
    queryKey: queryKeys.me,
    queryFn: () => api.get<CurrentUser>('/me', { skipAuthRedirect: true }),
    enabled,
    retry: false,
    staleTime: 5 * 60_000,
  });
}

export function useStockInfiniteQuery(params: StockListParams) {
  return useInfiniteQuery({
    queryKey: queryKeys.stock(params),
    queryFn: ({ pageParam }) => api.get<Paginated<StockItemDto>>('/stock', { query: { ...params, page: pageParam, limit: PAGE_SIZE } }),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.page * last.limit < last.total ? last.page + 1 : undefined),
  });
}

export function useStockItemQuery(id: string | undefined) {
  return useQuery({
    queryKey: queryKeys.stockItem(id ?? ''),
    queryFn: () => api.get<StockItemDto>(`/stock/${id}`),
    enabled: Boolean(id),
  });
}

export function useExpiringQuery() {
  return useQuery({
    queryKey: queryKeys.expiring,
    queryFn: () => api.get<{ items: StockItemDto[]; alertDays: number }>('/stock/expiring'),
  });
}

/**
 * État du service et version déployée. Interrogé une fois par session, puis
 * rafraîchi au retour sur l'application : c'est ce qui révèle un déploiement
 * récent alors que l'interface en cache est restée en arrière.
 */
export function useHealthQuery() {
  return useQuery({
    queryKey: queryKeys.health,
    queryFn: () => api.get<HealthReport>('/health'),
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: true,
    retry: false,
  });
}

export function useLocationsQuery() {
  return useQuery({ queryKey: queryKeys.locations, queryFn: () => api.get<LocationNode[]>('/locations'), staleTime: 60_000 });
}

export function useCategoriesQuery() {
  return useQuery({ queryKey: queryKeys.categories, queryFn: () => api.get<CategoryDto[]>('/categories'), staleTime: 10 * 60_000 });
}

export function useSettingsQuery() {
  return useQuery({ queryKey: queryKeys.settings, queryFn: () => api.get<Settings>('/settings'), staleTime: 60_000 });
}

/**
 * Modèles servis par la clé du fournisseur. Réservé aux admins (403 sinon),
 * d'où `enabled` : un membre n'a pas à déclencher un appel qui lui sera refusé.
 * Sans reprise automatique : un échec est une information à afficher, pas une
 * panne à masquer par des tentatives répétées.
 */
export function useAvailableModelsQuery(enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.availableModels,
    queryFn: () => api.get<AvailableModels>('/settings/models'),
    staleTime: 10 * 60_000,
    retry: false,
    enabled,
  });
}

export function useAccountsQuery() {
  return useQuery({ queryKey: queryKeys.accounts, queryFn: () => api.get<AccountDto[]>('/accounts') });
}

export function useServiceTokensQuery(enabled: boolean) {
  return useQuery({ queryKey: queryKeys.serviceTokens, queryFn: () => api.get<ServiceTokenDto[]>('/service-tokens'), enabled });
}

export function useRecognitionStatsQuery() {
  return useQuery({ queryKey: queryKeys.recognitionStats, queryFn: () => api.get<RecognitionStats>('/recognition/stats') });
}

export function usePendingLabelsQuery() {
  return useQuery({ queryKey: queryKeys.pendingLabels, queryFn: () => receiptsApi.pendingLabels() });
}

/** Pastille de l'onglet Courses : libellés distincts en attente. */
export function usePendingLabelCountQuery() {
  return useQuery({ queryKey: queryKeys.pendingLabelCount, queryFn: () => receiptsApi.pendingLabelCount(), staleTime: 60_000 });
}

export function useProductsQuery(q: string) {
  return useQuery({
    queryKey: queryKeys.products(q),
    queryFn: () => api.get<Paginated<ProductDto>>('/products', { query: { q, limit: 20 } }),
    enabled: q.trim().length > 0,
  });
}

export function useRecipesInfiniteQuery(params: RecipeListParams) {
  return useInfiniteQuery({
    queryKey: queryKeys.recipes(params),
    queryFn: ({ pageParam }) => api.get<Paginated<RecipeSummaryDto>>('/recipes', { query: { ...params, page: pageParam, limit: PAGE_SIZE } }),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.page * last.limit < last.total ? last.page + 1 : undefined),
  });
}

/**
 * Fiche recette (section 14/15) : ingrédients, étapes et statistiques déjà
 * résolus par l'API. `servings` (EF-26) demande au serveur la couverture pour
 * ce nombre de parts plutôt que celui de la recette ; omis, la fiche reste
 * sur les parts de la recette elle-même.
 */
export function useRecipeQuery(id: string | undefined, servings?: number) {
  return useQuery({
    queryKey: queryKeys.recipeDetail(id ?? '', servings),
    queryFn: () => api.get<RecipeDto>(`/recipes/${id}`, { query: servings !== undefined ? { servings } : undefined }),
    enabled: Boolean(id),
    placeholderData: keepPreviousData,
  });
}

/** Favori et note directe (A2, A3) : les deux seuls champs qu'un geste à l'écran écrit sans passer par le formulaire de modification. */
export type RecipeDirectPatch = Pick<UpdateRecipeInput, 'favorite' | 'rating'>;

/**
 * Écrit `favorite`/`rating` dans toutes les entrées déjà en cache qui
 * connaissent cette recette — chaque page de chaque liste, et la fiche quel
 * que soit le nombre de parts demandé (`queryKeys.recipeDetail`) — avant même
 * la réponse du serveur : en cuisine, l'étoile doit changer d'aspect au
 * contact du doigt, pas après un aller-retour réseau. Les deux vues restent
 * ainsi synchrones dès le geste, sans état local dupliqué (le cache partagé
 * de TanStack Query est la seule source de vérité, pas une mutation dédiée
 * inventée pour l'occasion). Retourne de quoi revenir en arrière si l'appel
 * échoue ensuite.
 */
function patchRecipeInCache(queryClient: QueryClient, recipeId: string, patch: RecipeDirectPatch): () => void {
  const previousLists = queryClient.getQueriesData<InfiniteData<Paginated<RecipeSummaryDto>>>({ queryKey: queryKeys.recipesAll });
  const previousDetails = queryClient.getQueriesData<RecipeDto>({ queryKey: queryKeys.recipe(recipeId) });

  queryClient.setQueriesData<InfiniteData<Paginated<RecipeSummaryDto>>>({ queryKey: queryKeys.recipesAll }, (data) => {
    if (!data) return data;
    return {
      ...data,
      pages: data.pages.map((page) => ({
        ...page,
        items: page.items.map((item) => (item.id === recipeId ? { ...item, ...patch } : item)),
      })),
    };
  });
  queryClient.setQueriesData<RecipeDto>({ queryKey: queryKeys.recipe(recipeId) }, (data) => (data ? { ...data, ...patch } : data));

  return () => {
    for (const [key, data] of previousLists) queryClient.setQueryData(key, data);
    for (const [key, data] of previousDetails) queryClient.setQueryData(key, data);
  };
}

/**
 * Pose un favori ou une note directe (A2, A3) : écriture immédiate du cache
 * (`patchRecipeInCache`) puis appel au serveur ; un échec revient sur l'état
 * d'avant et relance l'erreur pour que l'écran appelant affiche son propre
 * message (même usage que le reste de l'application : try/catch et toast
 * côté écran, jamais ici).
 */
export function useRecipeDirectPatch() {
  const queryClient = useQueryClient();
  return (recipeId: string, patch: RecipeDirectPatch) => {
    const rollback = patchRecipeInCache(queryClient, recipeId, patch);
    return recipesApi.updateRecipe(recipeId, patch).catch((error: unknown) => {
      rollback();
      throw error;
    });
  };
}

/** Historique des réalisations d'une recette (A26), du plus récent au plus ancien. */
export function useRecipeLogsInfiniteQuery(recipeId: string | undefined) {
  return useInfiniteQuery({
    queryKey: queryKeys.recipeLogs(recipeId ?? ''),
    queryFn: ({ pageParam }) => api.get<Paginated<RecipeLogDto>>(`/recipes/${recipeId}/logs`, { query: { page: pageParam, limit: PAGE_SIZE } }),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.page * last.limit < last.total ? last.page + 1 : undefined),
    enabled: Boolean(recipeId),
  });
}

export function useCuisinesQuery() {
  return useQuery({ queryKey: queryKeys.cuisines, queryFn: () => api.get<CuisineDto[]>('/cuisines'), staleTime: 10 * 60_000 });
}

/** Préférences de filtres et de tri de la liste des recettes (section 12), chargées une fois par session. */
export function useRecipeFiltersQuery() {
  return useQuery({
    queryKey: queryKeys.recipeFilters,
    queryFn: () => recipesApi.getFilters(),
    staleTime: Infinity,
  });
}

/** Réalisation récente non notée par l'utilisateur courant, pour le bandeau de rappel (EF-28). */
export function usePendingRatingQuery() {
  return useQuery({
    queryKey: queryKeys.pendingRating,
    queryFn: () => recipesApi.getPendingRating(),
    staleTime: 60_000,
  });
}

/**
 * Jeton de relance, strictement croissant et partagé par tout le module.
 *
 * `relaunch` est un compteur local à l'écran Suggestions : il est remis à zéro
 * au changement d'orientation et perdu au démontage de l'écran (aller voir
 * « Mes recettes » puis revenir), alors que le cache de requêtes, lui, survit.
 * Un compteur qui repasse par une valeur déjà utilisée reforme une clé déjà en
 * cache et, sous `staleTime: Infinity`, **ne déclenche aucun appel** : le
 * bouton « Chercher de nouvelles recettes » redevenait muet, pas même un
 * indicateur de chargement, exactement là où il sert — l'écran vide, seule
 * sortie du verrou de 24 heures de D11 (revue finale du 2026-10-15). Le jeton,
 * lui, ne redescend jamais.
 */
let nextRelaunchToken = 0;

/**
 * Fournée de suggestions (EF-25, EF-26) : jamais rejouée automatiquement en cas
 * d'échec, l'appel interroge un fournisseur payant et soumis à quota — une
 * nouvelle tentative est un choix de l'utilisateur (bouton « Réessayer »),
 * jamais un automatisme du client de requêtes.
 *
 * `placeholderData: keepPreviousData` (tâche 11) : changer d'orientation change
 * la clé de requête — région, durée et difficulté en font partie — et relance
 * un vrai appel ciblé plutôt qu'un filtrage local. Garder les données
 * précédentes affichées pendant ce temps évite de vider la liste à chaque
 * geste ; l'écran distingue l'attente via `isFetching`, pas `isPending`.
 *
 * `enabled` (tâche 2, D2/D3) : l'écran Suggestions pose d'abord une question
 * bloquante de type de plat — tant qu'elle n'a pas de réponse, aucun appel ne
 * doit partir, sans quoi un premier appel générique (sans type) partirait au
 * montage puis un second, ciblé, à la réponse : deux appels payants pour une
 * seule visite.
 *
 * `refetchOnWindowFocus: false` et `staleTime: Infinity` (revue de la tâche 4,
 * tour 3, 2026-10-15) : c'est la **seule route du module qui coûte de
 * l'argent**, et TanStack Query v5 rejoue par défaut toute requête périmée au
 * retour sur l'onglet — avec un `staleTime` à zéro, chaque va-et-vient entre
 * applications sur le téléphone déclenchait un appel. Le réservoir rend par
 * ailleurs la fraîcheur automatique sans objet : ce qu'il contient ne change
 * que lorsqu'on demande explicitement une nouvelle recherche, et c'est
 * `relaunch` qui le dit. Rien ne doit partir vers Gemini sans un geste.
 *
 * `relaunch` (tour 3) : compteur de relances explicites. Chaque appui doit
 * former une clé de requête neuve — un `refresh: true` posé dans l'orientation
 * laissait la clé inchangée et rendait le bouton muet au second appui — mais
 * il ne repart pas tel quel au serveur : seul le booléen `refresh` y va, pour
 * la recherche qu'il déclenche et elle seule. Ce n'est pas le compteur reçu
 * qui entre dans la clé mais un jeton qui ne redescend jamais
 * (`nextRelaunchToken`), voir ci-dessous.
 *
 * `limit` (2026-10-19) : taille de la page demandée, augmentée par « Charger
 * plus ». Elle entre dans la clé de requête — sans quoi l'appui ne
 * déclencherait rien sous `staleTime: Infinity` — mais jamais dans le jeton de
 * relance : agrandir la page relit le réservoir, elle ne repaie pas un appel
 * au modèle. L'écran remet d'ailleurs le compteur de relances à zéro en
 * chargeant plus, pour que `refresh` ne reparte pas avec la nouvelle clé.
 */
export function useSuggestionsQuery(orientation: SuggestionOrientation, options?: { enabled?: boolean; relaunch?: number; limit?: number }) {
  const relaunch = options?.relaunch ?? 0;
  const limit = options?.limit;
  const previousRelaunch = useRef(relaunch);
  const token = useRef(0);
  if (previousRelaunch.current !== relaunch) {
    previousRelaunch.current = relaunch;
    // Retour à zéro : c'est un changement d'orientation, pas une relance — la
    // clé redevient celle de la lecture normale du réservoir.
    token.current = relaunch === 0 ? 0 : (nextRelaunchToken += 1);
  }
  return useQuery({
    queryKey: [...queryKeys.suggestions(orientation), token.current, limit] as const,
    queryFn: () => suggestionsApi.list({ ...orientation, limit, refresh: token.current > 0 ? true : undefined }),
    retry: false,
    placeholderData: keepPreviousData,
    refetchOnWindowFocus: false,
    staleTime: Infinity,
    enabled: options?.enabled ?? true,
  });
}

/** Aplatit l'arbre des emplacements pour les listes et sélecteurs, en gardant la profondeur. */
export function flattenLocations(tree: LocationNode[]): Array<LocationNode & { depth: number }> {
  const out: Array<LocationNode & { depth: number }> = [];
  const walk = (nodes: LocationNode[], depth: number) => {
    for (const node of nodes) {
      out.push({ ...node, depth });
      walk(node.children, depth + 1);
    }
  };
  walk(tree, 0);
  return out;
}
