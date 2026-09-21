import { zodResolver } from '@hookform/resolvers/zod';
import { createUserSchema, type CreateUserInput } from '@kitchen/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { ScreenHeader } from '../../components/shell/app-shell';
import { Button } from '../../components/ui/button';
import { ErrorState } from '../../components/ui/empty-state';
import { PlusIcon } from '../../components/ui/icons';
import { Input, Select } from '../../components/ui/input';
import { Sheet } from '../../components/ui/sheet';
import { ListSkeleton } from '../../components/ui/skeleton';
import { useToast } from '../../components/ui/toast';
import { useAuth } from '../../hooks/use-auth';
import { api, errorMessage } from '../../lib/api';
import { formatDate } from '../../lib/expiry-ui';
import { queryKeys, useUsersQuery } from '../../lib/queries';
import type { UserDto } from '../../lib/types';

type CreateUserForm = z.input<typeof createUserSchema>;

/** EF-13 : comptes du foyer ; création réservée aux administrateurs, révocation des sessions (téléphone perdu). */
export function UsersScreen() {
  const auth = useAuth();
  const users = useUsersQuery();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [createOpen, setCreateOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const revoke = async (user: UserDto) => {
    setBusyId(user.id);
    try {
      await api.delete<void>(`/users/${user.id}/sessions`);
      toast.show({ message: `Sessions de ${user.name} révoquées`, tone: 'success', durationMs: 3000 });
      if (user.id === auth.user?.id) {
        auth.clear();
        window.location.assign('/connexion');
      }
    } catch (error) {
      toast.show({ message: errorMessage(error), tone: 'danger' });
    } finally {
      setBusyId(null);
    }
  };

  return (
    <>
      <ScreenHeader
        title="Utilisateurs"
        back="/reglages"
        actions={
          auth.isAdmin ? (
            <Button variant="primary" size="sm" icon={<PlusIcon size={18} />} onClick={() => setCreateOpen(true)}>
              Inviter
            </Button>
          ) : undefined
        }
      />
      {users.isPending ? (
        <ListSkeleton rows={3} />
      ) : users.isError ? (
        <ErrorState message={errorMessage(users.error)} onRetry={() => void users.refetch()} />
      ) : (
        <ul className="flex flex-col gap-2 px-4">
          {users.data.map((user) => {
            const me = user.id === auth.user?.id;
            const canRevoke = auth.isAdmin || me;
            return (
              <li key={user.id} className="flex items-center gap-3 rounded-card bg-surface px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[15px] font-medium">
                    {user.name}
                    {me && <span className="text-muted"> (vous)</span>}
                  </p>
                  <p className="truncate text-[13px] text-muted">
                    {user.email} · {user.role === 'ADMIN' ? 'administrateur' : 'membre'} · depuis le {formatDate(user.createdAt)}
                  </p>
                </div>
                {canRevoke && (
                  <Button size="sm" variant="outline" loading={busyId === user.id} onClick={() => void revoke(user)}>
                    Déconnecter partout
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <p className="px-5 pt-4 text-[13px] text-faint">« Déconnecter partout » révoque toutes les sessions d’un compte, par exemple après la perte d’un téléphone.</p>

      {auth.isAdmin && (
        <CreateUserSheet
          open={createOpen}
          onClose={() => setCreateOpen(false)}
          onCreated={async () => {
            await queryClient.invalidateQueries({ queryKey: queryKeys.users });
          }}
        />
      )}
    </>
  );
}

function CreateUserSheet({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => Promise<void> }) {
  const toast = useToast();
  const [serverError, setServerError] = useState<string | null>(null);
  const form = useForm<CreateUserForm, unknown, CreateUserInput>({
    resolver: zodResolver(createUserSchema),
    defaultValues: { email: '', name: '', password: '', role: 'MEMBER' },
  });

  const submit = form.handleSubmit(async (values) => {
    setServerError(null);
    try {
      const user = await api.post<UserDto>('/users', values);
      await onCreated();
      toast.show({ message: `${user.name} peut se connecter`, tone: 'success', durationMs: 3000 });
      form.reset();
      onClose();
    } catch (error) {
      setServerError(errorMessage(error));
    }
  });

  return (
    <Sheet open={open} onClose={onClose} locked={form.formState.isSubmitting} title="Inviter un membre" description="Communiquez-lui le mot de passe initial ; il pourra le changer dans ses réglages.">
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        <Input label="Prénom" autoFocus error={form.formState.errors.name?.message} {...form.register('name')} />
        <Input label="Adresse e-mail" type="email" inputMode="email" autoComplete="off" error={form.formState.errors.email?.message} {...form.register('email')} />
        <Input label="Mot de passe initial" type="text" autoComplete="off" hint="12 caractères au minimum." error={form.formState.errors.password?.message} {...form.register('password')} />
        <Select label="Rôle" options={[{ value: 'MEMBER', label: 'Membre' }, { value: 'ADMIN', label: 'Administrateur' }]} error={form.formState.errors.role?.message} {...form.register('role')} />
        {serverError && (
          <p role="alert" className="rounded-xl bg-danger-deep px-3 py-2 text-[14px] text-danger">
            {serverError}
          </p>
        )}
        <Button type="submit" variant="primary" size="lg" block loading={form.formState.isSubmitting}>
          Créer le compte
        </Button>
      </form>
    </Sheet>
  );
}
