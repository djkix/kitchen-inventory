import type { BackupStatus } from '@kitchen/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Button } from '../../components/ui/button';
import { useToast } from '../../components/ui/toast';
import { api, errorMessage } from '../../lib/api';
import { formatDateTime } from '../../lib/expiry-ui';
import { SectionBadge } from './accordion-section';

const QUERY_KEY = ['backup'];
const MEGABYTES = new Intl.NumberFormat('fr-FR', { style: 'unit', unit: 'megabyte', maximumFractionDigits: 1 });

/** Réservé aux administrateurs : ne monter que pour eux, la route vaut un 403 à un membre. */
function useBackupQuery() {
  return useQuery({
    queryKey: QUERY_KEY,
    queryFn: () => api.get<BackupStatus>('/backup'),
    // Une demande est prise dans les 5 minutes : on suit jusqu'à ce qu'elle parte.
    refetchInterval: (query) => (query.state.data?.requested ? 30_000 : false),
  });
}

/** Résumé de « Sauvegarde » : la dernière réussite, ou ce qui ne va pas. */
export function BackupBadge() {
  const status = useBackupQuery();
  if (!status.data) return null;
  const s = status.data;
  if (s.warnings.length > 0) return <SectionBadge>À vérifier</SectionBadge>;
  return <SectionBadge>{s.lastSuccess ? `Dernière le ${formatDateTime(s.lastSuccess.finishedAt)}` : 'Jamais lancée'}</SectionBadge>;
}

/**
 * Sauvegarde vers le NAS (section 9) : chaque nuit, et à la demande avant une
 * opération risquée. Le serveur ne fait que poser la demande ; le service
 * `backup` la prend dans les 5 minutes.
 */
export function BackupSection() {
  const status = useBackupQuery();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [sending, setSending] = useState(false);

  const request = async () => {
    setSending(true);
    try {
      queryClient.setQueryData(QUERY_KEY, await api.post<BackupStatus>('/backup/request'));
      toast.show({ message: 'Sauvegarde demandée', tone: 'success', durationMs: 2500 });
    } catch (error) {
      toast.show({ message: errorMessage(error, 'La demande n’a pas pu partir'), tone: 'danger' });
    } finally {
      setSending(false);
    }
  };

  const s = status.data;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex min-h-[56px] items-center gap-3 rounded-card bg-surface px-4 py-2">
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="text-[15px] font-medium">Sauvegarde vers le NAS</span>
          <span className="text-[13px] text-muted">{describe(s)}</span>
        </div>
        <Button size="sm" disabled={!s || s.requested} loading={sending} onClick={() => void request()}>
          {s?.requested ? 'Demandée' : 'Sauvegarder maintenant'}
        </Button>
      </div>
      {s?.warnings.map((warning) => (
        <p key={warning} className="rounded-xl bg-soon-deep px-3 py-2 text-[14px] text-soon">
          {warning}
        </p>
      ))}
    </div>
  );
}

function describe(s: BackupStatus | undefined): string {
  if (!s) return 'Chaque nuit, sept jours gardés';
  if (s.requested) return 'Part dans les 5 minutes';
  if (!s.lastSuccess) return 'Aucune sauvegarde réussie pour l’instant';
  const size = s.lastSuccess.dumpBytes === null ? '' : `, base de ${MEGABYTES.format(s.lastSuccess.dumpBytes / 1_000_000)}`;
  return `Dernière réussie le ${formatDateTime(s.lastSuccess.finishedAt)}${size}`;
}
