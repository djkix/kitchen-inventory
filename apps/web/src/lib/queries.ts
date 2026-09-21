import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import type {
  AuthStatus,
  CategoryDto,
  CurrentUser,
  LocationNode,
  Paginated,
  ProductDto,
  RecognitionStats,
  Settings,
  StockItemDto,
} from '@kitchen/shared';
import { api } from './api';
import type { HealthReport, ServiceTokenDto, UserDto } from './types';

export const PAGE_SIZE = 50;

export interface StockListParams {
  q?: string;
  location?: string;
  status?: 'active' | 'archived' | 'all';
  product?: string;
}

export const queryKeys = {
  authStatus: ['auth', 'status'] as const,
  me: ['auth', 'me'] as const,
  stock: (params: StockListParams) => ['stock', 'list', params] as const,
  stockAll: ['stock'] as const,
  stockItem: (id: string) => ['stock', 'item', id] as const,
  expiring: ['stock', 'expiring'] as const,
  locations: ['locations'] as const,
  categories: ['categories'] as const,
  settings: ['settings'] as const,
  users: ['users'] as const,
  serviceTokens: ['service-tokens'] as const,
  recognitionStats: ['recognition', 'stats'] as const,
  products: (q: string) => ['products', q] as const,
  health: ['health'] as const,
};

export function useAuthStatusQuery() {
  return useQuery({
    queryKey: queryKeys.authStatus,
    queryFn: () => api.get<AuthStatus>('/auth/status', { skipAuthRedirect: true }),
    staleTime: 60_000,
    retry: 1,
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

export function useUsersQuery() {
  return useQuery({ queryKey: queryKeys.users, queryFn: () => api.get<UserDto[]>('/users') });
}

export function useServiceTokensQuery(enabled: boolean) {
  return useQuery({ queryKey: queryKeys.serviceTokens, queryFn: () => api.get<ServiceTokenDto[]>('/service-tokens'), enabled });
}

export function useRecognitionStatsQuery() {
  return useQuery({ queryKey: queryKeys.recognitionStats, queryFn: () => api.get<RecognitionStats>('/recognition/stats') });
}

export function useProductsQuery(q: string) {
  return useQuery({
    queryKey: queryKeys.products(q),
    queryFn: () => api.get<Paginated<ProductDto>>('/products', { query: { q, limit: 20 } }),
    enabled: q.trim().length > 0,
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
