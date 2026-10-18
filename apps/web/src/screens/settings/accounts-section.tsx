import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { AccountDto } from '@kitchen/shared';
import { useState, type ReactNode } from 'react';
import { Button } from '../../components/ui/button';
import { useToast } from '../../components/ui/toast';
import { useAuth } from '../../hooks/use-auth';
import { api, errorMessage } from '../../lib/api';
import { formatDate } from '../../lib/expiry-ui';
import { queryKeys, useAccountsQuery } from '../../lib/queries';

/**
 * Réglages › Comptes (section 10, D2). Réservée aux administrateurs : le
 * contrôle côté serveur (`@AdminOnly`) est le vrai, celui-ci évite seulement
 * d'afficher une section vide de sens à un membre.
 *
 * **Aucune création de compte ici** (D10) : la personne se connecte avec
 * Google, apparaît en attente, un administrateur valide.
 */
export function AccountsSection() {
  const auth = useAuth();
  if (!auth.isAdmin) return null;
  return <AccountsList meId={auth.user?.id} />;
}

function AccountsList({ meId }: { meId: string | undefined }) {
  const accounts = useAccountsQuery();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [busyId, setBusyId] = useState<string | null>(null);

  /** Un geste sur un compte : appel, rafraîchissement de la liste, message. */
  const act = async (id: string, run: () => Promise<unknown>, done: string) => {
    setBusyId(id);
    try {
      await run();
      toast.show({ message: done, tone: 'success', durationMs: 3000 });
      await queryClient.invalidateQueries({ queryKey: queryKeys.accounts });
    } catch (error) {
      toast.show({ message: errorMessage(error), tone: 'danger' });
    } finally {
      setBusyId(null);
    }
  };

  const approve = (a: AccountDto) => act(a.id, () => api.post(`/accounts/${a.id}/approve`), `${a.name} peut se connecter`);
  const refuse = (a: AccountDto) => act(a.id, () => api.post(`/accounts/${a.id}/revoke`), `Demande de ${a.name} refusée`);
  const reinstate = (a: AccountDto) => act(a.id, () => api.post(`/accounts/${a.id}/approve`), `${a.name} peut de nouveau se connecter`);
  const revoke = (a: AccountDto) => {
    if (!window.confirm(`Révoquer l’accès de ${a.name} ? Ses sessions seront coupées.`)) return Promise.resolve();
    return act(a.id, () => api.post(`/accounts/${a.id}/revoke`), `Accès de ${a.name} révoqué`);
  };
  const signOut = (a: AccountDto) => act(a.id, () => api.delete<void>(`/users/${a.id}/sessions`), `Sessions de ${a.name} coupées`);

  if (accounts.isPending) return <Group title="Comptes"><p className="px-1 text-[14px] text-muted">Chargement…</p></Group>;
  if (accounts.isError) {
    return (
      <Group title="Comptes">
        <p role="alert" className="px-1 text-[14px] text-muted">{errorMessage(accounts.error)}</p>
        <Button variant="outline" onClick={() => void accounts.refetch()}>Réessayer</Button>
      </Group>
    );
  }

  const pending = accounts.data.filter((a) => a.status === 'PENDING');
  const active = accounts.data.filter((a) => a.status === 'ACTIVE');
  const refused = accounts.data.filter((a) => a.status === 'REVOKED');

  return (
    <>
      <Group title="Demandes en attente">
        {pending.length === 0 ? (
          <div className="rounded-card border border-dashed border-line px-4 py-5 text-center">
            <p className="text-[15px] font-medium">Aucune demande en attente</p>
            <p className="text-[13px] text-muted">Une personne qui se connecte avec Google pour la première fois apparaît ici, en attente de votre validation.</p>
          </div>
        ) : (
          pending.map((a) => (
            <Row key={a.id} account={a}>
              <Button variant="primary" size="sm" className="flex-1" loading={busyId === a.id} onClick={() => void approve(a)}>Valider</Button>
              <Button variant="outline" size="sm" className="flex-1" disabled={busyId === a.id} onClick={() => void refuse(a)}>Refuser</Button>
            </Row>
          ))
        )}
      </Group>
      <Group title="Comptes actifs">
        {active.map((a) => (
          <Row key={a.id} account={a} me={a.id === meId}>
            <Button variant="outline" size="sm" className="flex-1" loading={busyId === a.id} onClick={() => void signOut(a)}>Déconnecter</Button>
            {a.id !== meId && (
              <Button variant="danger" size="sm" className="flex-1" disabled={busyId === a.id} onClick={() => void revoke(a)}>Révoquer</Button>
            )}
          </Row>
        ))}
        <p className="px-1 text-[13px] text-faint">« Déconnecter » coupe toutes les sessions d’un compte (téléphone perdu) ; il pourra se reconnecter. « Révoquer » retire l’accès.</p>
      </Group>
      {/* Une personne refusée qui se reconnecte reçoit le même message d'attente
          qu'une demande ordinaire : sans cette liste, rien ne la ferait réapparaître. */}
      <Group title="Refusés">
        {refused.length === 0 ? (
          <p className="px-1 text-[13px] text-muted">Aucun compte refusé</p>
        ) : (
          refused.map((a) => (
            <Row key={a.id} account={a}>
              <Button variant="outline" size="sm" className="flex-1" loading={busyId === a.id} onClick={() => void reinstate(a)}>Rétablir</Button>
            </Row>
          ))
        )}
      </Group>
    </>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="flex flex-col gap-2">
      <h2 className="px-1 text-[13px] font-semibold text-muted">{title}</h2>
      {children}
    </section>
  );
}

/** Un compte = une carte pleine largeur : identité en haut, actions sous le pouce. */
function Row({ account, me = false, children }: { account: AccountDto; me?: boolean; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2 rounded-card bg-surface px-4 py-3">
      <div className="min-w-0">
        <p className="truncate text-[15px] font-medium">
          {account.name}
          {me && <span className="text-muted"> (vous)</span>}
          {account.role === 'ADMIN' && <span className="text-muted"> · administrateur</span>}
        </p>
        <p className="truncate text-[13px] text-muted">{account.email} · {formatDate(account.createdAt)}</p>
      </div>
      <div className="flex gap-2">{children}</div>
    </div>
  );
}

/**
 * Pour tous les comptes, membres compris : couper ses propres sessions
 * (téléphone perdu), y compris celle-ci. Reprend ce que faisait l'ancien écran
 * Utilisateurs pour un membre.
 */
export function SignOutEverywhereRow() {
  const auth = useAuth();
  const toast = useToast();
  const signOut = useMutation({
    mutationFn: () => api.delete<void>(`/users/${auth.user?.id}/sessions`),
    onSuccess: () => {
      auth.clear();
      window.location.assign('/connexion');
    },
    onError: (error) => toast.show({ message: errorMessage(error), tone: 'danger' }),
  });
  return (
    <Button block variant="outline" loading={signOut.isPending} disabled={!auth.user} onClick={() => signOut.mutate()}>
      Déconnecter tous mes appareils
    </Button>
  );
}
