import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';
import { ScreenHeader } from '../../components/shell/app-shell';
import { Button } from '../../components/ui/button';
import { ChevronIcon } from '../../components/ui/icons';
import { useToast } from '../../components/ui/toast';
import { useAuth } from '../../hooks/use-auth';
import { API_BASE, api, errorMessage } from '../../lib/api';
import { queryKeys, useAccountsQuery, useRecognitionStatsQuery, useSettingsQuery } from '../../lib/queries';
import { AccountsSection, SignOutEverywhereRow } from './accounts-section';
import { AccordionSection, SectionBadge } from './accordion-section';
import { NutritionBackfillRow } from './nutrition-backfill-row';
import { GeminiModelsSection } from './gemini-models-section';
import { WebSearchRow } from './web-search-row';
import { VersionBadge } from '../../components/shell/version-badge';
import { StatsPanel } from './stats-panel';

/**
 * Puces de section, cantonnées à l'écran Réglages (choix de djkix,
 * 2026-10-22, d'après la maquette). Volontairement hors des jetons du thème :
 * celui-ci réserve le rouge, l'orange et l'ambre à la péremption et les bleus
 * à la température de stockage, sens qui doivent rester lisibles partout
 * ailleurs. Ici, aucune de ces significations n'a cours — un réglage n'est ni
 * périssable ni réfrigéré — et cinq replis identiques avaient besoin d'un
 * repère visuel.
 */
const SECTION_DOTS = {
  reconnaissance: '#38bdf8',
  comptes: '#10b981',
  inventaire: '#f59e0b',
  foyer: '#6366f1',
  export: '#a855f7',
} as const;

/**
 * Écran Réglages (section 14) : emplacements, comptes, seuil d'alerte,
 * reconnaissance, export, compte.
 *
 * Les sections sont pliables depuis la refonte du 2026-10-21 : l'écran faisait
 * plusieurs hauteurs de téléphone et l'on descendait à l'aveugle. Chaque
 * en-tête porte son résumé, ce qui évite de déplier pour savoir. Seule
 * « Reconnaissance » est ouverte à l'arrivée — c'est ce qu'on vient consulter
 * le plus souvent (quota du jour, budget du mois). « Compte » n'est pas
 * pliable : s'en aller ne doit jamais demander un geste de plus.
 */
export function SettingsScreen() {
  const auth = useAuth();
  const navigate = useNavigate();
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
      <ScreenHeader
        title="Réglages"
        subtitle={auth.user ? `${auth.user.name} · ${auth.user.role === 'ADMIN' ? 'administrateur' : 'membre'}` : undefined}
        actions={<VersionBadge compact />}
      />
      <div className="flex flex-col gap-3 px-4">
        <AccordionSection title="Reconnaissance" badge={<RecognitionBadge />} dotColor={SECTION_DOTS.reconnaissance}>
          <StatsPanel />
          {auth.isAdmin && <GeminiModelsSection />}
          <WebSearchRow isAdmin={auth.isAdmin} />
        </AccordionSection>

        <AccountsAccordion />

        <AccordionSection title="Inventaire" badge={<AlertBadge />} dotColor={SECTION_DOTS.inventaire}>
          <NavRow to="/reglages/emplacements" label="Emplacements" hint="Placards, frigo, cellier : profondeur libre" />
          <AlertDaysRow isAdmin={auth.isAdmin} />
          <NutritionBackfillRow isAdmin={auth.isAdmin} />
        </AccordionSection>

        {auth.isAdmin && (
          <AccordionSection title="Foyer" badge={<SectionBadge>Home Assistant, scripts</SectionBadge>} dotColor={SECTION_DOTS.foyer}>
            <NavRow to="/reglages/jetons" label="Jetons de service" hint="Accès lecture pour Home Assistant, scripts…" />
          </AccordionSection>
        )}

        <AccordionSection title="Export" badge={<SectionBadge>Formats ouverts : CSV et JSON</SectionBadge>} dotColor={SECTION_DOTS.export}>
          <div className="grid grid-cols-2 gap-2">
            <a href={`${API_BASE}/export/inventory.csv`} download="inventaire.csv" className="flex min-h-touch items-center justify-center rounded-xl bg-raised px-4 text-[15px] font-medium active:bg-surface">
              Inventaire CSV
            </a>
            <a href={`${API_BASE}/export/inventory.json`} download="inventaire.json" className="flex min-h-touch items-center justify-center rounded-xl bg-raised px-4 text-[15px] font-medium active:bg-surface">
              Inventaire JSON
            </a>
          </div>
        </AccordionSection>

        <Section title="Compte">
          <Button block variant="outline" loading={loggingOut} onClick={() => void logout()}>
            Se déconnecter
          </Button>
          <SignOutEverywhereRow />
          <p className="pt-1 text-center text-[13px] text-faint">Connecté en tant que {auth.user?.email}</p>
        </Section>

      </div>
    </>
  );
}

/**
 * Résumé de « Reconnaissance » : le fournisseur et la consommation du jour,
 * les deux chiffres pour lesquels on ouvre cet écran. Même requête que
 * `StatsPanel`, donc servie par le cache sans appel supplémentaire.
 */
function RecognitionBadge() {
  const stats = useRecognitionStatsQuery();
  if (!stats.data) return null;
  const s = stats.data;
  if (s.provider === 'none') return <SectionBadge>Photo désactivée</SectionBadge>;
  return (
    <SectionBadge>
      {s.provider} · {s.visionCallsToday} / {s.dailyQuota} photos aujourd’hui
    </SectionBadge>
  );
}

/** Résumé d'« Inventaire » : le seuil d'alerte, seul réglage de la section. */
function AlertBadge() {
  const settings = useSettingsQuery();
  if (!settings.data) return null;
  const days = settings.data.expiryAlertDays;
  return <SectionBadge>Alerte à {days} jour{days > 1 ? 's' : ''}</SectionBadge>;
}

/**
 * « Comptes », réservée aux administrateurs comme `AccountsSection` elle-même :
 * la section entière disparaît pour un membre, en-tête compris. Le retour
 * précède la requête, qui n'est donc jamais lancée pour un membre — elle lui
 * vaudrait un 403.
 */
function AccountsAccordion() {
  const auth = useAuth();
  // Le retour précède toute requête : la liste des comptes vaudrait un 403 à
  // un membre.
  if (!auth.isAdmin) return null;
  return (
    <AccordionSection title="Comptes" badge={<AccountsBadge />} dotColor={SECTION_DOTS.comptes}>
      <AccountsSection />
    </AccordionSection>
  );
}

/** Résumé de « Comptes » : ce qui demande une action se lit sans déplier. */
function AccountsBadge() {
  const accounts = useAccountsQuery();
  if (!accounts.data) return null;
  const active = accounts.data.filter((a) => a.status === 'ACTIVE').length;
  const pending = accounts.data.filter((a) => a.status === 'PENDING').length;
  return (
    <SectionBadge>
      {active} actif{active > 1 ? 's' : ''} · {pending === 0 ? 'aucune demande' : `${pending} en attente`}
    </SectionBadge>
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
