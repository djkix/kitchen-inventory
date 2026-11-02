/**
 * Demandes au modèle qui survivent à l'écran qui les a lancées (conception du
 * 2026-11-02). Trois règles, et elles vivent ici parce qu'elles décident ce
 * que l'utilisateur voit : le serveur les applique, l'interface les explique.
 */

export const AI_REQUEST_KINDS = ['SCAN_IMAGE', 'SUGGESTIONS', 'VOICE', 'RECEIPT'] as const;
export type AiRequestKind = (typeof AI_REQUEST_KINDS)[number];

export type AiRequestState = 'RUNNING' | 'DEFERRED' | 'DONE' | 'FAILED' | 'ABANDONED';

/**
 * Plafond du différé (D6). Au-delà, mieux vaut abandonner que sonner au
 * milieu de la nuit pour une recette qu'on ne fera plus.
 */
export const DEFERRAL_CEILING_MS = 60 * 60_000;

/**
 * Faut-il annoncer le résultat de cette demande (D1, D1b) ?
 *
 * Le déclencheur est l'écran quitté, jamais une durée : un chronomètre sonne
 * alors qu'on regardait l'écran, et se tait quand on est parti au bout de huit
 * secondes. Une demande différée fait exception et annonce toujours — à la
 * reprise, plusieurs minutes ont passé et personne n'est resté devant.
 */
export function shouldNotify(input: { leftScreen: boolean; wasDeferred: boolean }): boolean {
  return input.leftScreen || input.wasDeferred;
}

/**
 * Quand rejouer une demande refusée pour une pause, ou `null` pour abandonner
 * tout de suite (D6). Une reprise déjà passée se rejoue à l'instant : la pause
 * a pu se lever entre le refus et l'enregistrement.
 */
export function deferralRetryAt(input: { now: Date; resumeAt: Date }): Date | null {
  const { now, resumeAt } = input;
  if (resumeAt.getTime() > now.getTime() + DEFERRAL_CEILING_MS) return null;
  return resumeAt.getTime() <= now.getTime() ? now : resumeAt;
}

/** Écran à ouvrir au clic, par usage. */
const SCREENS: Record<AiRequestKind, string> = {
  // Les adresses réelles de l'application (`app.tsx`) : le stock est à la
  // racine, et l'écran des suggestions est `/recettes`.
  SCAN_IMAGE: '/',
  SUGGESTIONS: '/recettes',
  VOICE: '/recettes',
  RECEIPT: '/courses',
};

const plural = (n: number, one: string, many: string): string => `${n} ${n > 1 ? many : one}`;

function title(kind: AiRequestKind, count: number | undefined): string {
  switch (kind) {
    case 'SUGGESTIONS':
    case 'VOICE':
      return count === undefined ? 'Vos idées de recettes sont prêtes' : plural(count, 'idée de recette', 'idées de recettes');
    case 'RECEIPT':
      return count === undefined ? 'Votre ticket est lu' : `Ticket lu : ${plural(count, 'ligne', 'lignes')}`;
    case 'SCAN_IMAGE':
      return 'Votre article est identifié';
  }
}

const BODIES: Record<AiRequestKind, string> = {
  SCAN_IMAGE: 'Touchez pour le ranger dans votre stock.',
  SUGGESTIONS: 'Touchez pour les voir.',
  VOICE: 'Touchez pour les voir.',
  RECEIPT: 'Touchez pour vérifier les lignes avant de les ajouter.',
};

/**
 * Le texte affiché par le téléphone. Il nomme ce qui est prêt — « 6 idées de
 * recettes » et non « traitement terminé » — pour qu'on puisse décider d'y
 * aller ou non sans ouvrir l'application. Le `tag` vaut l'identifiant de la
 * demande : deux annonces de la même demande se remplacent au lieu de s'empiler.
 */
export function notificationPayload(input: {
  id: string;
  kind: AiRequestKind;
  outcome: 'DONE' | 'ABANDONED';
  count?: number;
  reason?: string;
}): { title: string; body: string; url: string; tag: string } {
  const common = { url: SCREENS[input.kind], tag: input.id };
  if (input.outcome === 'ABANDONED') {
    return {
      title: 'Demande abandonnée',
      body: input.reason ?? 'Le service n’est pas revenu à temps ; refaites votre demande.',
      ...common,
    };
  }
  return { title: title(input.kind, input.count), body: BODIES[input.kind], ...common };
}
