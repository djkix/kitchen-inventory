/**
 * Raccourcis de date de péremption du tiroir de validation du scan (section 3,
 * P2, EF-02) : « +3 j », « +1 sem », « +1 mois » comptés à partir d'aujourd'hui.
 *
 * Toujours en jour civil local, jamais en UTC : `from` est l'instant du
 * téléphone au moment du geste. Un calcul qui passerait par `toISOString()`
 * ou les accesseurs `getUTC*` se tromperait de jour chaque fois que l'heure
 * locale et l'heure UTC ne tombent pas le même jour civil — par exemple en
 * toute fin de soirée à Paris, quand il est encore 23 h en UTC mais déjà le
 * lendemain heure locale.
 */
export type ExpiryShortcutKind = 'threeDays' | 'oneWeek' | 'oneMonth';

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

/** Sérialise une date civile locale en « AAAA-MM-JJ » (format `isoDateSchema`). */
export function toCivilIsoDate(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addCivilDays(date: Date, days: number): Date {
  const result = startOfLocalDay(date);
  result.setDate(result.getDate() + days);
  return result;
}

/**
 * Ajoute des mois civils en restant sur un jour qui existe : le 31 janvier
 * plus un mois tombe le 28 (ou 29) février, jamais le 2 ou 3 mars.
 */
function addCivilMonths(date: Date, months: number): Date {
  const start = startOfLocalDay(date);
  const day = start.getDate();
  const firstOfTarget = new Date(start.getFullYear(), start.getMonth() + months, 1);
  const lastDayOfTarget = new Date(firstOfTarget.getFullYear(), firstOfTarget.getMonth() + 1, 0).getDate();
  firstOfTarget.setDate(Math.min(day, lastDayOfTarget));
  return firstOfTarget;
}

/** Date (au format `isoDateSchema`) du raccourci choisi, calculée depuis `from`. */
export function expiryShortcutDate(kind: ExpiryShortcutKind, from: Date): string {
  switch (kind) {
    case 'threeDays':
      return toCivilIsoDate(addCivilDays(from, 3));
    case 'oneWeek':
      return toCivilIsoDate(addCivilDays(from, 7));
    case 'oneMonth':
      return toCivilIsoDate(addCivilMonths(from, 1));
  }
}
