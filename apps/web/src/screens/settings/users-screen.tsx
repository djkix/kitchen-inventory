import { useState } from 'react';
import { ScreenHeader } from '../../components/shell/app-shell';
import { Button } from '../../components/ui/button';
import { ErrorState } from '../../components/ui/empty-state';
import { ListSkeleton } from '../../components/ui/skeleton';
import { useToast } from '../../components/ui/toast';
import { useAuth } from '../../hooks/use-auth';
import { api, errorMessage } from '../../lib/api';
import { formatDate } from '../../lib/expiry-ui';
import { useUsersQuery } from '../../lib/queries';
import type { UserDto } from '../../lib/types';

/**
 * EF-13 : comptes du foyer, et révocation des sessions (téléphone perdu).
 *
 * **Aucune création de compte ici** (D10) : une adresse tapée à la main, avec
 * une faute de frappe, ouvrait l'inventaire au titulaire réel de cette boîte.
 * Le chemin d'entrée est unique — la personne se connecte avec Google,
 * apparaît en attente, un administrateur valide.
 */
export function UsersScreen() {
  const auth = useAuth();
  const users = useUsersQuery();
  const toast = useToast();
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
      <ScreenHeader title="Utilisateurs" back="/reglages" />
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
    </>
  );
}
