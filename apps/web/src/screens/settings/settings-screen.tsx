import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';
import { ScreenHeader } from '../../components/shell/app-shell';
import { Button } from '../../components/ui/button';
import { ChevronIcon } from '../../components/ui/icons';
import { useToast } from '../../components/ui/toast';
import { useAuth } from '../../hooks/use-auth';
import { API_BASE, api, errorMessage } from '../../lib/api';
import { queryKeys, useSettingsQuery } from '../../lib/queries';
import { PasswordSheet } from './password-sheet';
import { StatsPanel } from './stats-panel';

/** Écran Réglages (section 14) : emplacements, utilisateurs, seuil d'alerte, reconnaissance, export, compte. */
export function SettingsScreen() {
  const auth = useAuth();
  const navigate = useNavigate();
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  const logout = async () => {
    setLoggingOut(true);
    try {
      await api.post<void>('/auth/logout');
    } catch {
      /* la session est peut-être déjà expirée : on repart quand même à la connexion */
    }
    auth.clear();
    navigate('/connexion', { replace: true });
  };

  return (
    <>
      <ScreenHeader title="Réglages" subtitle={auth.user ? `${auth.user.name} · ${auth.user.role === 'ADMIN' ? 'administrateur' : 'membre'}` : undefined} />
      <div className="flex flex-col gap-6 px-4">
        <Section title="Inventaire">
          <NavRow to="/reglages/emplacements" label="Emplacements" hint="Placards, frigo, cellier : profondeur libre" />
          <AlertDaysRow isAdmin={auth.isAdmin} />
        </Section>

        <Section title="Reconnaissance">
          <StatsPanel />
        </Section>

        <Section title="Foyer">
          <NavRow to="/reglages/utilisateurs" label="Utilisateurs" hint={auth.isAdmin ? 'Inviter, révoquer les sessions' : 'Membres du foyer'} />
          {auth.isAdmin && <NavRow to="/reglages/jetons" label="Jetons de service" hint="Accès lecture pour Home Assistant, scripts…" />}
        </Section>

        <Section title="Export">
          <div className="grid grid-cols-2 gap-2">
            <a href={`${API_BASE}/export/inventory.csv`} download="inventaire.csv" className="flex min-h-touch items-center justify-center rounded-xl bg-surface px-4 text-[15px] font-medium active:bg-raised">
              Inventaire CSV
            </a>
            <a href={`${API_BASE}/export/inventory.json`} download="inventaire.json" className="flex min-h-touch items-center justify-center rounded-xl bg-surface px-4 text-[15px] font-medium active:bg-raised">
              Inventaire JSON
            </a>
          </div>
        </Section>

        <Section title="Compte">
          <Button block onClick={() => setPasswordOpen(true)}>
            Changer le mot de passe
          </Button>
          <Button block variant="outline" loading={loggingOut} onClick={() => void logout()}>
            Se déconnecter
          </Button>
          <p className="pt-1 text-center text-[13px] text-faint">Connecté en tant que {auth.user?.email}</p>
        </Section>
      </div>
      <PasswordSheet open={passwordOpen} onClose={() => setPasswordOpen(false)} />
    </>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="flex flex-col gap-2">
      <h2 className="px-1 text-[13px] font-semibold text-muted">{title}</h2>
      {children}
    </section>
  );
}

function NavRow({ to, label, hint }: { to: string; label: string; hint?: string }) {
  return (
    <Link to={to} className="flex min-h-[56px] items-center gap-3 rounded-card bg-surface px-4 active:bg-raised">
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-[15px] font-medium">{label}</span>
        {hint && <span className="truncate text-[13px] text-muted">{hint}</span>}
      </span>
      <ChevronIcon size={18} className="text-faint" />
    </Link>
  );
}

/** EF-09 : seuil d'alerte X, en jours, modifiable par un administrateur (`PATCH /settings`). */
function AlertDaysRow({ isAdmin }: { isAdmin: boolean }) {
  const settings = useSettingsQuery();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [value, setValue] = useState<string>('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (settings.data) setValue(String(settings.data.expiryAlertDays));
  }, [settings.data]);

  const save = async () => {
    const days = Number(value);
    if (!Number.isInteger(days) || days < 0 || days > 365) {
      toast.show({ message: 'Indiquez un nombre de jours entre 0 et 365.', tone: 'danger' });
      return;
    }
    setSaving(true);
    try {
      await api.patch('/settings', { expiryAlertDays: days });
      await queryClient.invalidateQueries({ queryKey: queryKeys.settings });
      await queryClient.invalidateQueries({ queryKey: queryKeys.stockAll });
      toast.show({ message: `Alerte à ${days} jour${days > 1 ? 's' : ''}`, tone: 'success', durationMs: 2500 });
    } catch (error) {
      toast.show({ message: errorMessage(error), tone: 'danger' });
    } finally {
      setSaving(false);
    }
  };

  const dirty = settings.data !== undefined && value !== String(settings.data.expiryAlertDays);

  return (
    <div className="flex min-h-[56px] items-center gap-3 rounded-card bg-surface px-4 py-2">
      <label htmlFor="alert-days" className="flex min-w-0 flex-1 flex-col">
        <span className="text-[15px] font-medium">Seuil « périme bientôt »</span>
        <span className="text-[13px] text-muted">Jours avant la date effective</span>
      </label>
      <input
        id="alert-days"
        type="number"
        inputMode="numeric"
        min={0}
        max={365}
        disabled={!isAdmin || settings.isPending}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        className="tnum h-touch w-20 rounded-xl border border-line bg-ink px-3 text-center text-[16px] focus:border-accent focus:outline-none disabled:text-muted"
      />
      {isAdmin && dirty && (
        <Button variant="primary" size="sm" loading={saving} onClick={() => void save()}>
          OK
        </Button>
      )}
    </div>
  );
}
