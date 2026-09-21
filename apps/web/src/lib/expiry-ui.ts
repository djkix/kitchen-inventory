import type { ExpiryStatus, StockItemDto } from '@kitchen/shared';

/**
 * Habillage des états de péremption calculés par l'API (`expiryStatus`,
 * `daysUntilExpiry`). Aucune règle métier ici : seulement couleurs et libellés.
 */
export interface ExpiryLook {
  label: string;
  /** Couleur du texte et de l'icône. */
  text: string;
  /** Fond des pastilles. */
  chip: string;
  /** Rail vertical de la carte. */
  rail: string;
}

const LOOKS: Record<ExpiryStatus, ExpiryLook> = {
  expired_use_by: { label: 'DLC dépassée', text: 'text-danger', chip: 'bg-danger-deep text-danger', rail: 'bg-danger' },
  expired_best_before: { label: 'DDM dépassée', text: 'text-warn', chip: 'bg-warn-deep text-warn', rail: 'bg-warn' },
  soon: { label: 'Bientôt', text: 'text-soon', chip: 'bg-soon-deep text-soon', rail: 'bg-soon' },
  ok: { label: 'En date', text: 'text-muted', chip: 'bg-raised text-muted', rail: 'bg-transparent' },
  none: { label: 'Sans date', text: 'text-faint', chip: 'bg-raised text-faint', rail: 'bg-transparent' },
};

export function expiryLook(status: ExpiryStatus): ExpiryLook {
  return LOOKS[status];
}

/** « J-3 », « Aujourd’hui », « J+2 » : compte à rebours civil lisible d'un coup d'œil. */
export function daysLabel(days: number | null): string {
  if (days === null) return '—';
  if (days === 0) return 'Aujourd’hui';
  if (days > 0) return `J-${days}`;
  return `J+${Math.abs(days)}`;
}

/** Phrase complète pour la fiche et les lecteurs d'écran. */
export function daysSentence(days: number | null, estimated: boolean): string {
  const prefix = estimated ? 'Estimé : ' : '';
  if (days === null) return 'Aucune date';
  if (days === 0) return `${prefix}à consommer aujourd’hui`;
  if (days === 1) return `${prefix}périme demain`;
  if (days > 1) return `${prefix}périme dans ${days} jours`;
  if (days === -1) return `${prefix}dépassée depuis hier`;
  return `${prefix}dépassée depuis ${Math.abs(days)} jours`;
}

const DATE_FORMAT = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
const DATETIME_FORMAT = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/** Formate une date civile « AAAA-MM-JJ » (ou un ISO complet) en français, sans décalage de fuseau. */
export function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  const civil = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00`) : new Date(value);
  if (Number.isNaN(civil.getTime())) return value;
  return DATE_FORMAT.format(civil);
}

export function formatDateTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : DATETIME_FORMAT.format(date);
}

/** Date du jour au format civil accepté par l'API. */
export function todayIso(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

/** « À consommer jusqu'au » / « À consommer de préférence avant ». */
export function dateTypeLabel(type: StockItemDto['dateType']): string {
  if (type === 'USE_BY') return 'DLC';
  if (type === 'BEST_BEFORE') return 'DDM';
  return 'Date';
}

export type ExpiryGroupKey = 'expired' | 'soon' | 'later' | 'none';

export const EXPIRY_GROUP_LABELS: Record<ExpiryGroupKey, string> = {
  expired: 'Dépassés',
  soon: 'Périment bientôt',
  later: 'Plus tard',
  none: 'Sans date',
};

export function expiryGroupOf(status: ExpiryStatus): ExpiryGroupKey {
  if (status === 'expired_use_by' || status === 'expired_best_before') return 'expired';
  if (status === 'soon') return 'soon';
  if (status === 'ok') return 'later';
  return 'none';
}
