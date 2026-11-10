import type { CatalogueStatus } from '@kitchen/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Button } from '../../components/ui/button';
import { useToast } from '../../components/ui/toast';
import { api, errorMessage } from '../../lib/api';

const QUERY_KEY = ['suggestions-catalogue'];

/**
 * Rattrapage des recettes du réservoir (D6, 2026-11-09). Les suggestions
 * entrées avant la livraison n'ont pas de recette en base ; ce passage les
 * crée, une fois. Il n'appelle jamais le modèle — seules les compositions sont
 * reprises —, mais il dure, donc le serveur rend la main tout de suite et cette
 * ligne suit l'avancement, comme celle des repères nutritionnels.
 */
export function RecipesCatalogueRow({ isAdmin }: { isAdmin: boolean }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [starting, setStarting] = useState(false);

  const status = useQuery({
    queryKey: QUERY_KEY,
    queryFn: () => api.get<CatalogueStatus>('/suggestions/catalogue'),
    refetchInterval: (query) => (query.state.data?.running ? 3000 : false),
  });

  const start = async () => {
    setStarting(true);
    try {
      const next = await api.post<CatalogueStatus>('/suggestions/catalogue', {});
      queryClient.setQueryData(QUERY_KEY, next);
      toast.show({ message: 'Rattrapage lancé', tone: 'success', durationMs: 2500 });
    } catch (error) {
      toast.show({ message: errorMessage(error, 'Le rattrapage n’a pas pu démarrer'), tone: 'danger' });
    } finally {
      setStarting(false);
    }
  };

  const s = status.data;
  return (
    <div className="flex min-h-[56px] items-center gap-3 rounded-card bg-surface px-4 py-2">
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="text-[15px] font-medium">Recettes du réservoir</span>
        <span className="text-[13px] text-muted">{describe(s)}</span>
      </div>
      <Button size="sm" disabled={!isAdmin || starting || s?.running} loading={starting || s?.running} onClick={() => void start()}>
        {s?.running ? 'En cours' : 'Rattraper'}
      </Button>
    </div>
  );
}

/** Une phrase, jamais un tableau de compteurs : la ligne tient sous un pouce. */
function describe(status: CatalogueStatus | undefined): string {
  if (!status) return 'Enregistre en base les suggestions déjà proposées';
  if (status.running) return `${status.done} sur ${status.total} reprises…`;
  if (status.finishedAt) {
    return `${status.crees} enregistrées, ${status.deja} déjà en base${status.ignores > 0 ? `, ${status.ignores} laissées de côté` : ''}.`;
  }
  return 'Enregistre en base les suggestions proposées avant que ce soit automatique';
}
