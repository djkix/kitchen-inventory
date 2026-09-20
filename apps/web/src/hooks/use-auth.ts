import { useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { isApiError } from '../lib/api';
import { queryKeys, useAuthStatusQuery, useMeQuery } from '../lib/queries';

export type AuthState = 'loading' | 'setup_required' | 'anonymous' | 'authenticated' | 'unreachable';

/**
 * État de session dérivé de `GET /auth/status` puis `GET /me`.
 * `unreachable` couvre l'API injoignable ou en maintenance (503) : page dédiée plutôt qu'un écran vide.
 */
export function useAuth() {
  const queryClient = useQueryClient();
  const status = useAuthStatusQuery();
  const setupRequired = status.data?.setupRequired === true;
  const me = useMeQuery(status.isSuccess && !setupRequired);

  let state: AuthState = 'loading';
  if (status.isError) state = 'unreachable';
  else if (status.isSuccess && setupRequired) state = 'setup_required';
  else if (me.isSuccess) state = 'authenticated';
  else if (me.isError) state = isApiError(me.error, 'unauthenticated') ? 'anonymous' : 'unreachable';

  const refresh = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.authStatus });
    await queryClient.invalidateQueries({ queryKey: queryKeys.me });
  }, [queryClient]);

  const clear = useCallback(() => {
    queryClient.clear();
  }, [queryClient]);

  return { state, user: me.data ?? null, isAdmin: me.data?.role === 'ADMIN', refresh, clear, error: status.error ?? me.error };
}
