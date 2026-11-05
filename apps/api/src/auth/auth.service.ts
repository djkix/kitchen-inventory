import { Inject, Injectable } from '@nestjs/common';
import type { CurrentUser, GoogleLoginInput, RecoveryLoginInput } from '@kitchen/shared';
import type { Response } from 'express';
import { Logger } from 'nestjs-pino';
import { ApiError } from '../common/api-error.js';
import { APP_CONFIG, type AppConfig } from '../common/config.js';
import { createDefaultLocations } from '../locations/default-locations.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { GOOGLE_TOKEN_VERIFIER, type GoogleIdentity, type GoogleTokenVerifier } from './google-token.verifier.js';
import { verifyPassword } from './password.js';
import type { RequestUser } from './request-user.js';
import { SessionService } from './session.service.js';

/**
 * Un seul message pour tout ce qui n'ouvre pas de session. Distinguer
 * « en attente » de « refusé » apprendrait à un appelant non authentifié
 * qu'une adresse appartient au foyer et qu'elle en a été écartée (revue de la
 * tâche 3, amendement de la spec).
 */
const PENDING_MESSAGE = 'Votre demande attend la validation d’un administrateur.';

/**
 * Un seul message pour tous les refus de la porte de secours : adresse
 * inconnue, aucun mot de passe de secours posé, expiration passée, mauvais mot
 * de passe, compte non actif. La route n'apprend rien à qui la découvre.
 */
const RECOVERY_MESSAGE = 'Accès de secours indisponible';

/**
 * Qui peut devenir le premier administrateur d'une base vide (revue de
 * sécurité du 2026-10-22). Sans garde, la première connexion Google vérifiée
 * venue d'Internet — n'importe quel compte Google — prenait le foyer entre le
 * déploiement et la première connexion du propriétaire.
 *
 * - `ADMIN_EMAIL` posée : seule cette adresse peut ouvrir la base ;
 * - absente en production : aucune création automatique, l'administrateur
 *   se crée par `tools/acces-secours.js` (ou en posant `ADMIN_EMAIL`) ;
 * - absente en développement et en test : comportement historique, la
 *   première connexion crée l'administrateur.
 */
export function firstAdminAllowed(config: Pick<AppConfig, 'ADMIN_EMAIL' | 'NODE_ENV'>, email: string): boolean {
  if (config.ADMIN_EMAIL) return email.trim().toLowerCase() === config.ADMIN_EMAIL;
  return config.NODE_ENV !== 'production';
}

/** Consigne journalisée quand une connexion sur base vide est refusée faute d'adresse autorisée. */
export const FIRST_ADMIN_HINT =
  'Base vide : aucun administrateur ne peut être créé automatiquement pour cette adresse. ' +
  'Poser ADMIN_EMAIL=<adresse du propriétaire> puis redémarrer, ou créer l’administrateur avec ' +
  '« docker compose exec app node tools/acces-secours.js <adresse> ».';

interface Account {
  id: string;
  email: string;
  name: string;
  role: 'ADMIN' | 'MEMBER';
  status: 'PENDING' | 'ACTIVE' | 'REVOKED';
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: SessionService,
    private readonly logger: Logger,
    @Inject(GOOGLE_TOKEN_VERIFIER) private readonly google: GoogleTokenVerifier,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async setupRequired(): Promise<boolean> {
    return (await this.prisma.user.count()) === 0;
  }

  /**
   * Section 10 (D1, D3, D7) : le jeton Google est vérifié côté serveur, le
   * compte est retrouvé **par adresse e-mail**, et aucune session n'est ouverte
   * tant que le compte n'est pas `ACTIVE`. Sur une base vide, la première
   * connexion crée l'administrateur — seulement pour l'adresse autorisée
   * (`firstAdminAllowed`).
   */
  async loginWithGoogle(input: GoogleLoginInput, res: Response): Promise<CurrentUser> {
    const identity = await this.google.verify(input.credential);
    // On n'authentifie personne sur une adresse qu'il ne contrôle pas.
    if (!identity.emailVerified) throw ApiError.unauthenticated('Adresse Google non vérifiée');

    const { account, created, first } = await this.resolveAccount(identity);
    if (first) this.logger.log({ userId: account.id }, 'Premier administrateur créé par connexion Google');
    else if (created) this.logger.log({ userId: account.id }, 'Demande d’accès créée, en attente de validation');

    // Un compte neuf, un compte en attente et un compte refusé répondent à
    // l'identique : la page de connexion ne doit pas servir à énumérer les
    // adresses connues du foyer.
    if (account.status !== 'ACTIVE') throw ApiError.forbidden(PENDING_MESSAGE);

    // La porte de secours (D6) n'a plus d'objet dès que Google remarche : le
    // mot de passe à usage unique meurt ici plutôt qu'au bout de son heure.
    await this.prisma.user.updateMany({
      where: { id: account.id, recoveryExpiresAt: { not: null } },
      data: { passwordHash: null, recoveryExpiresAt: null },
    });

    await this.sessions.open(account.id, res);
    return toCurrentUser(account);
  }

  /** Retrouve le compte par adresse, ou le crée — sous le verrou d'exclusion pour une création. */
  private async resolveAccount(identity: GoogleIdentity): Promise<{ account: Account; created: boolean; first: boolean }> {
    const existing = await this.prisma.user.findUnique({ where: { email: identity.email } });
    if (existing) return { account: await this.attachGoogleSub(existing, identity), created: false, first: false };

    return this.prisma.$transaction(async (tx) => {
      // Verrou d'exclusion : deux connexions simultanées sur une base vide ne
      // créent qu'un seul administrateur (D7).
      await tx.$executeRaw`LOCK TABLE "User" IN SHARE ROW EXCLUSIVE MODE`;
      const raced = await tx.user.findUnique({ where: { email: identity.email } });
      if (raced) return { account: raced, created: false, first: false };

      const first = (await tx.user.count()) === 0;
      // Base vide et adresse non autorisée : rien n'est créé, pas même une
      // demande `PENDING` — sinon le vrai propriétaire, arrivant ensuite,
      // ne serait plus « le premier » et attendrait une validation que
      // personne ne peut donner. Même réponse qu'une demande en attente.
      if (first && !firstAdminAllowed(this.config, identity.email)) {
        this.logger.warn({ email: identity.email }, FIRST_ADMIN_HINT);
        throw ApiError.forbidden(PENDING_MESSAGE);
      }
      // Le `sub` n'est stocké que pour mémoire : jamais deux comptes dessus,
      // sinon une adresse Google changée ne pourrait plus faire de demande.
      const subDejaPris = (await tx.user.findUnique({ where: { googleSub: identity.sub } })) !== null;
      if (subDejaPris) {
        this.logger.warn({ email: identity.email }, 'Identité Google déjà rattachée à un autre compte : demande créée sans `sub`');
      }
      const account = await tx.user.create({
        data: {
          email: identity.email,
          name: identity.name ?? identity.email,
          googleSub: subDejaPris ? null : identity.sub,
          passwordHash: null,
          role: first ? 'ADMIN' : 'MEMBER',
          status: first ? 'ACTIVE' : 'PENDING',
        },
      });
      if (first) await createDefaultLocations(tx);
      return { account, created: true, first };
    });
  }

  /**
   * Mémorise le `sub` sur un compte retrouvé par son adresse, s'il est libre.
   *
   * Une **discordance** de `sub` sur une adresse connue n'est pas un détail :
   * sur un domaine Workspace, une adresse supprimée puis recréée, ou
   * réattribuée, revient avec un `sub` neuf. Laisser passer donnerait le compte
   * existant — et son rôle — à quelqu'un d'autre. Le compte est alors traité
   * comme non validé, et c'est à un administrateur de trancher.
   */
  private async attachGoogleSub(user: Account & { googleSub: string | null }, identity: GoogleIdentity): Promise<Account> {
    if (user.googleSub && user.googleSub !== identity.sub) {
      this.logger.warn({ userId: user.id }, 'Identité Google différente de celle enregistrée pour cette adresse : connexion refusée');
      throw ApiError.forbidden(PENDING_MESSAGE);
    }
    if (user.googleSub) return user;
    const taken = await this.prisma.user.findUnique({ where: { googleSub: identity.sub } });
    if (taken) return user;
    return this.prisma.user.update({ where: { id: user.id }, data: { googleSub: identity.sub } });
  }

  /**
   * Porte de secours (D6) : la seule façon d'entrer si Google devient
   * inutilisable. Elle n'ouvre **rien** tant que `tools/acces-secours.ts` n'a
   * pas posé un mot de passe à usage unique en base — pas de secret dormant,
   * pas de valeur par défaut, pas de variable d'environnement qui en tiendrait
   * lieu. Le mot de passe meurt au bout d'une heure et ne sert qu'une fois :
   * le succès efface le hachage et l'expiration dans la transaction qui ouvre
   * la session.
   */
  async loginWithRecovery(input: RecoveryLoginInput, res: Response): Promise<CurrentUser> {
    const user = await this.prisma.user.findUnique({ where: { email: input.email } });
    // Le statut est vérifié ici aussi : la session d'un compte révoqué serait
    // de toute façon rejetée à la requête suivante (D10).
    if (!user?.passwordHash || !user.recoveryExpiresAt || user.status !== 'ACTIVE') {
      throw ApiError.unauthenticated(RECOVERY_MESSAGE);
    }
    if (user.recoveryExpiresAt.getTime() <= Date.now()) throw ApiError.unauthenticated(RECOVERY_MESSAGE);
    // Un mot de passe faux **n'efface rien** : sinon n'importe qui, en tapant
    // au hasard pendant l'heure ouverte, condamnerait la porte du propriétaire.
    if (!(await verifyPassword(user.passwordHash, input.password))) throw ApiError.unauthenticated(RECOVERY_MESSAGE);

    await this.prisma.$transaction(async (tx) => {
      // La condition est rejouée dans l'écriture : deux appels concurrents avec
      // le même mot de passe n'ouvrent qu'une session, la seconde ne trouve
      // plus rien à effacer.
      const consumed = await tx.user.updateMany({
        where: { id: user.id, passwordHash: user.passwordHash, recoveryExpiresAt: { gt: new Date() } },
        data: { passwordHash: null, recoveryExpiresAt: null },
      });
      if (consumed.count !== 1) throw ApiError.unauthenticated(RECOVERY_MESSAGE);
      await this.sessions.open(user.id, res, tx);
    });
    this.logger.warn({ userId: user.id }, 'Connexion par la porte de secours : mot de passe à usage unique consommé');
    return toCurrentUser(user);
  }

  async logout(user: RequestUser, res: Response): Promise<void> {
    if (user.sessionId) await this.sessions.revoke(user.sessionId);
    this.sessions.clearCookie(res);
  }
}

export function toCurrentUser(user: { id: string; email: string; name: string; role: 'ADMIN' | 'MEMBER' }): CurrentUser {
  return { id: user.id, email: user.email, name: user.name, role: user.role };
}
