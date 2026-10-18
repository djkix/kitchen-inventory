/**
 * Porte de secours (D6, section 10). Lancée **dans le conteneur** depuis
 * Dockge, cette commande crée ou réactive un administrateur et lui pose un mot
 * de passe à usage unique, valable une heure, utilisable sur
 * `POST /auth/recovery`.
 *
 *   docker compose exec app node tools/acces-secours.js adresse@example.org
 *
 * Rien n'est exposé sur Internet en temps normal : pas de formulaire, pas de
 * variable d'environnement qui ferait office de clé, pas de secret dormant.
 * Tant que cette commande n'a pas tourné, la route de secours n'ouvre rien.
 *
 * Le mot de passe est affiché **une seule fois** sur la sortie standard et
 * n'est jamais journalisé : il n'existe en clair nulle part ailleurs.
 */
import { randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { PrismaClient } from '@prisma/client';
import { hashPassword } from '../apps/api/src/auth/password.js';

/** Une heure : assez pour se connecter, trop court pour qu'un oubli reste ouvert. */
const RECOVERY_TTL_MS = 3_600_000;

/** Ce que la commande utilise de Prisma — `PrismaService` convient aussi, en test. */
type Db = Pick<PrismaClient, 'user'>;

export interface RecoveryGrant {
  email: string;
  password: string;
  expiresAt: Date;
  created: boolean;
}

/**
 * Pose le mot de passe de secours sur le compte, qu'il existe ou non, et le
 * promeut `ACTIVE`/`ADMIN` — sans quoi la porte ne servirait à rien : le
 * contrôle de statut joué à chaque requête rejetterait aussitôt la session.
 */
export async function grantRecovery(prisma: Db, rawEmail: string): Promise<RecoveryGrant> {
  // Même normalisation que le jeton Google, sinon « Franck@… » créerait un doublon.
  const email = rawEmail.trim().toLowerCase();
  if (!email) throw new Error('Une adresse e-mail est attendue en argument.');

  // 192 bits : la route est limitée en débit et le mot de passe meurt en une
  // heure, mais rien n'oblige à compter sur ces deux bornes seules.
  const password = randomBytes(24).toString('base64url');
  const passwordHash = await hashPassword(password);
  const expiresAt = new Date(Date.now() + RECOVERY_TTL_MS);

  const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  await prisma.user.upsert({
    where: { email },
    update: { passwordHash, recoveryExpiresAt: expiresAt, status: 'ACTIVE', role: 'ADMIN' },
    create: { email, name: email, passwordHash, recoveryExpiresAt: expiresAt, status: 'ACTIVE', role: 'ADMIN' },
  });
  return { email, password, expiresAt, created: existing === null };
}

/** Corps de la commande, séparé du câblage Prisma pour être joué en test. */
export async function run(prisma: Db, argv: string[], out: (line: string) => void): Promise<void> {
  const [rawEmail, ...reste] = argv;
  if (!rawEmail || reste.length > 0) {
    throw new Error('Usage : node tools/acces-secours.js <adresse e-mail>');
  }
  const grant = await grantRecovery(prisma, rawEmail);

  out('');
  out(`Compte ${grant.created ? 'créé' : 'réactivé'} : ${grant.email} (ACTIVE, ADMIN)`);
  out(`Mot de passe de secours : ${grant.password}`);
  out(`Valable jusqu'à ${grant.expiresAt.toLocaleString('fr-FR')}, pour une seule connexion.`);
  out('');
  out('Il ne sera plus jamais affiché. Connexion :');
  out(`  POST /api/v1/auth/recovery  {"email":"${grant.email}","password":"…"}`);
  out('');
}

// Exécution directe seulement : importé par les tests, ce module ne fait rien.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const prisma = new PrismaClient();
  try {
    await run(prisma, process.argv.slice(2), (line) => process.stdout.write(`${line}\n`));
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}
