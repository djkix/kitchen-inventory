/** Google compte les quotas journaliers au jour du Pacifique, pas au nôtre. */
export const QUOTA_TIME_ZONE = 'America/Los_Angeles';

const pacificDate = new Intl.DateTimeFormat('en-CA', { timeZone: QUOTA_TIME_ZONE });
const pacificParts = new Intl.DateTimeFormat('en-US', {
  timeZone: QUOTA_TIME_ZONE,
  hourCycle: 'h23',
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: 'numeric',
  minute: 'numeric',
  second: 'numeric',
});

/** `AAAA-MM-JJ` du jour en cours au Pacifique : clé du compteur journalier. */
export const pacificDay = (now: Date): string => pacificDate.format(now);

/** Heure murale du Pacifique relue comme si c'était de l'UTC. */
function pacificWallAsUtc(t: number): number {
  const p = Object.fromEntries(pacificParts.formatToParts(new Date(t)).map((x) => [x.type, Number(x.value)]));
  return Date.UTC(p.year!, p.month! - 1, p.day!, p.hour!, p.minute!, p.second!);
}

/**
 * Prochain minuit du Pacifique, heure d'été comprise : le décalage est lu à
 * 08:00 UTC du jour visé, avant 2 h là-bas, donc avant tout changement d'heure.
 */
export function nextPacificMidnight(now: Date): Date {
  const wall = new Date(pacificWallAsUtc(now.getTime()));
  const target = Date.UTC(wall.getUTCFullYear(), wall.getUTCMonth(), wall.getUTCDate() + 1);
  const probe = target + 8 * 3_600_000;
  return new Date(target - (pacificWallAsUtc(probe) - probe));
}

/**
 * « à 14:04 » le même jour, « jeudi à 09:00 » sinon — jamais « demain », qui
 * devient faux une fois le message relu après minuit. Arrondi à la minute
 * supérieure : annoncer 14:03 pour 14:03:31 ferait réessayer trop tôt. Fuseau
 * de l'instance (`TZ`) par défaut.
 */
export function resumeAt(until: Date, now: Date, timeZone?: string): string {
  const shown = new Date(Math.ceil(until.getTime() / 60_000) * 60_000);
  const day = new Intl.DateTimeFormat('fr-FR', { timeZone, dateStyle: 'short' });
  const hour = new Intl.DateTimeFormat('fr-FR', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(shown);
  if (day.format(shown) === day.format(now)) return `à ${hour}`;
  return `${new Intl.DateTimeFormat('fr-FR', { timeZone, weekday: 'long' }).format(shown)} à ${hour}`;
}
