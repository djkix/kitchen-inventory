import { zodResolver } from '@hookform/resolvers/zod';
import { createServiceTokenSchema, type CreateServiceTokenInput } from '@kitchen/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Navigate } from 'react-router';
import { ScreenHeader } from '../../components/shell/app-shell';
import { Button, IconButton } from '../../components/ui/button';
import { EmptyState, ErrorState } from '../../components/ui/empty-state';
import { PlusIcon, TrashIcon } from '../../components/ui/icons';
import { Input } from '../../components/ui/input';
import { Sheet } from '../../components/ui/sheet';
import { ListSkeleton } from '../../components/ui/skeleton';
import { useToast } from '../../components/ui/toast';
import { useAuth } from '../../hooks/use-auth';
import { api, errorMessage } from '../../lib/api';
import { formatDate, formatDateTime } from '../../lib/expiry-ui';
import { queryKeys, useServiceTokensQuery } from '../../lib/queries';
import type { CreatedServiceToken, ServiceTokenDto } from '../../lib/types';

/** Jetons machine-à-machine en lecture seule (section 11) ; le secret n'est affiché qu'une fois. */
export function ServiceTokensScreen() {
  const auth = useAuth();
  const tokens = useServiceTokensQuery(auth.isAdmin);
  const queryClient = useQueryClient();
  const toast = useToast();
  const [createOpen, setCreateOpen] = useState(false);
  const [created, setCreated] = useState<CreatedServiceToken | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  if (auth.state === 'authenticated' && !auth.isAdmin) return <Navigate to="/reglages" replace />;

  const refresh = () => queryClient.invalidateQueries({ queryKey: queryKeys.serviceTokens });

  const remove = async (token: ServiceTokenDto) => {
    setBusyId(token.id);
    try {
      await api.delete<void>(`/service-tokens/${token.id}`);
      await refresh();
      toast.show({ message: `Jeton « ${token.name} » supprimé : les intégrations qui l’utilisaient sont coupées.`, durationMs: 4000 });
    } catch (error) {
      toast.show({ message: errorMessage(error), tone: 'danger' });
    } finally {
      setBusyId(null);
    }
  };

  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast.show({ message: 'Jeton copié', tone: 'success', durationMs: 2000 });
    } catch {
      toast.show({ message: 'Copie impossible : sélectionnez le jeton et copiez-le à la main.', tone: 'danger' });
    }
  };

  return (
    <>
      <ScreenHeader
        title="Jetons de service"
        back="/reglages"
        actions={
          <Button variant="primary" size="sm" icon={<PlusIcon size={18} />} onClick={() => setCreateOpen(true)}>
            Créer
          </Button>
        }
      />
      {tokens.isPending ? (
        <ListSkeleton rows={2} />
      ) : tokens.isError ? (
        <ErrorState message={errorMessage(tokens.error)} onRetry={() => void tokens.refetch()} />
      ) : tokens.data.length === 0 ? (
        <EmptyState
          title="Aucun jeton"
          description="Un jeton donne un accès en lecture seule à l’API (en-tête Authorization: Bearer) pour Home Assistant, un tableau de bord ou un script. Créez-en un par intégration pour pouvoir le révoquer seul."
          action={
            <Button variant="primary" onClick={() => setCreateOpen(true)}>
              Créer un jeton
            </Button>
          }
        />
      ) : (
        <ul className="flex flex-col gap-2 px-4">
          {tokens.data.map((token) => (
            <li key={token.id} className="flex items-center gap-2 rounded-card bg-surface py-2 pl-4 pr-1">
              <div className="min-w-0 flex-1">
                <p className="truncate text-[15px] font-medium">{token.name}</p>
                <p className="text-[13px] text-muted">
                  Créé le {formatDate(token.createdAt)} · {token.lastUsedAt ? `dernier usage ${formatDateTime(token.lastUsedAt)}` : 'jamais utilisé'}
                </p>
              </div>
              <IconButton label={`Supprimer le jeton ${token.name}`} className="text-danger" disabled={busyId === token.id} onClick={() => void remove(token)}>
                <TrashIcon size={19} />
              </IconButton>
            </li>
          ))}
        </ul>
      )}

      <CreateTokenSheet
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={async (token) => {
          await refresh();
          setCreated(token);
        }}
      />

      {created && (
        <Sheet open onClose={() => setCreated(null)} title="Jeton créé" description="Copiez-le maintenant : il ne sera plus jamais affiché. Seule son empreinte est conservée.">
          <div className="flex flex-col gap-3">
            <code className="block select-all break-all rounded-xl bg-ink px-4 py-3 text-[14px] text-accent">{created.token}</code>
            <p className="text-[13px] text-muted">
              Usage : <code className="text-fg">Authorization: Bearer {'<jeton>'}</code> sur les routes GET de l’API.
            </p>
            <Button variant="primary" size="lg" block onClick={() => void copy(created.token)}>
              Copier le jeton
            </Button>
            <Button variant="ghost" size="lg" block onClick={() => setCreated(null)}>
              J’ai copié, fermer
            </Button>
          </div>
        </Sheet>
      )}
    </>
  );
}

function CreateTokenSheet({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (token: CreatedServiceToken) => Promise<void> }) {
  const [serverError, setServerError] = useState<string | null>(null);
  const form = useForm<CreateServiceTokenInput>({ resolver: zodResolver(createServiceTokenSchema), defaultValues: { name: '' } });

  const submit = form.handleSubmit(async (values) => {
    setServerError(null);
    try {
      const token = await api.post<CreatedServiceToken>('/service-tokens', values);
      form.reset();
      onClose();
      await onCreated(token);
    } catch (error) {
      setServerError(errorMessage(error));
    }
  });

  return (
    <Sheet open={open} onClose={onClose} locked={form.formState.isSubmitting} title="Nouveau jeton">
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        <Input label="Nom de l’intégration" autoFocus placeholder="Home Assistant" error={form.formState.errors.name?.message} {...form.register('name')} />
        {serverError && (
          <p role="alert" className="rounded-xl bg-danger-deep px-3 py-2 text-[14px] text-danger">
            {serverError}
          </p>
        )}
        <Button type="submit" variant="primary" size="lg" block loading={form.formState.isSubmitting}>
          Créer le jeton
        </Button>
      </form>
    </Sheet>
  );
}
