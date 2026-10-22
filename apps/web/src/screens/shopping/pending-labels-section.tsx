import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Sheet } from '../../components/ui/sheet';
import { Input } from '../../components/ui/input';
import { useToast } from '../../components/ui/toast';
import { errorMessage } from '../../lib/api';
import { queryKeys, usePendingLabelsQuery, useProductsQuery } from '../../lib/queries';
import { receiptsApi } from '../../lib/receipts-api';

/**
 * Libellés jamais reconnus, rattachés quand on veut (EF-29). Replié par
 * défaut. Le `count` d'une entrée compte des lignes de ticket, pas des
 * libellés : la pastille de l'onglet, elle, compte les libellés distincts.
 */
export function PendingLabelsSection() {
  const labels = usePendingLabelsQuery();
  const [target, setTarget] = useState<string | null>(null);
  const items = labels.data ?? [];
  if (items.length === 0) return null;
  return (
    <details className="mx-4 mb-6 rounded-card border border-line bg-surface">
      <summary className="min-h-touch cursor-pointer list-none px-3.5 py-3 text-[15px] font-medium">
        Libellés à rattacher <span className="tnum text-faint">({items.length})</span>
      </summary>
      <ul className="divide-y divide-line border-t border-line">
        {items.map((item) => (
          <li key={item.label} className="flex items-center gap-3 px-3.5 py-2">
            <div className="min-w-0 flex-1">
              <p className="truncate text-[15px]">{item.label}</p>
              <p className="text-[13px] text-faint">vu sur {item.count} ligne{item.count > 1 ? 's' : ''}</p>
            </div>
            <button type="button" onClick={() => setTarget(item.label)} aria-label={`Rattacher ${item.label}`} className="min-h-touch rounded-xl px-3 text-[14px] font-semibold text-accent active:bg-raised">
              Rattacher
            </button>
          </li>
        ))}
      </ul>
      <AttachSheet label={target} onClose={() => setTarget(null)} />
    </details>
  );
}

function AttachSheet({ label, onClose }: { label: string | null; onClose: () => void }) {
  const [q, setQ] = useState('');
  const products = useProductsQuery(q);
  const toast = useToast();
  const queryClient = useQueryClient();
  const attach = useMutation({
    mutationFn: (productId: string) => receiptsApi.attachLabel({ label: label ?? '', productId }),
    onSuccess: async () => {
      toast.show({ message: 'Libellé appris : le prochain ticket le reconnaîtra.', tone: 'success' });
      await Promise.all([queryClient.invalidateQueries({ queryKey: queryKeys.pendingLabels }), queryClient.invalidateQueries({ queryKey: queryKeys.pendingLabelCount })]);
      setQ('');
      onClose();
    },
  });
  return (
    <Sheet
      open={label !== null}
      onClose={onClose}
      title={label ?? ''}
      description="Choisissez le produit. Le ticket affiché n’est pas relu : le libellé sera reconnu sur le prochain."
      locked={attach.isPending}
    >
      <Input label="Rechercher un produit" value={q} onChange={(e) => setQ(e.target.value)} />
      {attach.isError && <p role="alert" className="pt-2 text-[14px] text-danger">{errorMessage(attach.error)}</p>}
      <ul className="flex flex-col pt-2">
        {(products.data?.items ?? []).map((p) => (
          <li key={p.id}>
            <button type="button" disabled={attach.isPending} onClick={() => attach.mutate(p.id)} className="min-h-[48px] w-full rounded-xl px-2 text-left text-[15px] active:bg-raised">
              {p.name}
              {p.brand && <span className="text-faint"> · {p.brand}</span>}
            </button>
          </li>
        ))}
      </ul>
    </Sheet>
  );
}
