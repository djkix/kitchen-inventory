import type { NutritionBackfillStatus } from '@kitchen/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Button } from '../../components/ui/button';
import { useToast } from '../../components/ui/toast';
import { api, errorMessage } from '../../lib/api';

const QUERY_KEY = ['nutrition-backfill'];

/**
 * Rattrapage des repères nutritionnels (EF-30) depuis l'écran, pour ne pas
 * dépendre d'un terminal. Le passage dure plusieurs minutes — Open Food Facts
 * coupe le débit bien avant la limite qu'il annonce — donc le serveur rend la
 * main tout de suite et cette ligne suit l'avancement.
 */
export function NutritionBackfillRow({ isAdmin }: { isAdmin: boolean }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [starting, setStarting] = useState(false);

  const status = useQuery({
    queryKey: QUERY_KEY,
    queryFn: () => api.get<NutritionBackfillStatus>('/products/nutrition/backfill'),
    // On ne sonde que pendant un passage : au repos, la ligne est immobile.
    refetchInterval: (query) => (query.state.data?.running ? 3000 : false),
  });

  const start = async () => {
    setStarting(true);
    try {
      const next = await api.post<NutritionBackfillStatus>('/products/nutrition/backfill', { all: false });
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
        <span className="text-[15px] font-medium">Repères nutritionnels</span>
        <span className="text-[13px] text-muted">{describe(s)}</span>
      </div>
      <Button size="sm" disabled={!isAdmin || starting || s?.running} loading={starting || s?.running} onClick={() => void start()}>
        {s?.running ? 'En cours' : 'Rattraper'}
      </Button>
    </div>
  );
}

/** Une phrase, jamais un tableau de compteurs : la ligne tient sous un pouce. */
function describe(status: NutritionBackfillStatus | undefined): string {
  if (!status) return 'Nutri-Score et niveaux repris d’Open Food Facts au scan';
  if (status.running) {
    return `${status.updated} repris sur ${status.examined} interrogés…`;
  }
  if (status.rateLimited) {
    return `${status.updated} repris, puis Open Food Facts a limité les requêtes. Relancez plus tard : le rattrapage reprendra où il s’est arrêté.`;
  }
  if (status.finishedAt) {
    return `${status.updated} repris, ${status.withoutData} sans repère chez Open Food Facts${status.failed > 0 ? `, ${status.failed} en échec` : ''}.`;
  }
  return 'Rattrape les produits entrés avant que la fonctionnalité existe';
}
