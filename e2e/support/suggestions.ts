import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { suggestionIdentity } from '@kitchen/shared';
import { runSql } from './database.ts';

/**
 * Outillage du réservoir de suggestions pour les parcours bout en bout
 * (EF-25, EF-26, lot « réservoir permanent » du 2026-10-15).
 *
 * Deux services rendus ici, et une limite assumée.
 *
 * 1. `suggestionCalls()` compte les appels RÉELLEMENT servis par la doublure
 *    (`e2e/fixtures/stub-server.ts`, route `/__calls`). C'est la seule preuve
 *    acceptable qu'une visite n'a rien demandé au modèle : `fromCache` est un
 *    drapeau que le serveur se pose à lui-même, et c'est justement ce que le
 *    parcours doit mettre à l'épreuve.
 *
 * 2. `seedReadWebRecipes()` dépose au réservoir les huit recettes `web` de la
 *    fixture, dans l'état exact que l'ingestion produit APRÈS une lecture
 *    réussie de leur page (`verifiedAt` posé, `pageRecipe` et `pageText`
 *    recopiés — décision D10).
 *
 * Pourquoi ce dépôt direct, et pas une vraie lecture de page par la doublure :
 * `RecipePageFetcher` (apps/api/src/suggestions/recipe-page.fetcher.ts) exige
 * HTTPS **et** un hôte public, et refuse toute adresse privée ou locale. Le
 * service `stub` du montage e2e est un hôte local en clair : aucune recette
 * web ne peut donc être lue bout en bout sans désactiver, pour les besoins du
 * test, exactement la protection que l'application se donne. Les URL de la
 * fixture pointent sur `203.0.113.20` (TEST-NET-3, RFC 5737) : un littéral IP,
 * donc aucune résolution DNS, aucune dépendance au réseau — et injoignable,
 * donc la recette est jetée à l'ingestion tant que sa page n'a pas été
 * déposée ici. Les deux chemins sont joués dans `p5-suggestions.spec.ts` :
 * sans dépôt, la recette web n'atteint jamais l'écran (D4) ; avec dépôt, elle
 * y figure avec le nom de son site (B10) et l'ingestion ne la relit pas (D10).
 */

const FIXTURE_PATH = fileURLToPath(new URL('../../apps/api/test/fixtures/suggestions/gemini-batch.json', import.meta.url));

/** Adresse publiée par `docker-compose.e2e.yml` pour le service `stub`, atteinte depuis le runner. */
const STUB_URL = 'http://127.0.0.1:3101';

/** Recette de la fixture : seuls les champs que ce module manipule sont nommés, le reste est recopié tel quel. */
interface FixtureRecipe {
  readonly title: string;
  readonly provenance: 'web' | 'ai';
  readonly sourceUrl: string | null;
  readonly dishType: string;
  readonly steps: readonly string[];
  readonly ingredients: ReadonlyArray<{ readonly label: string }>;
}

/** Les douze recettes servies par la doublure, lues à la source plutôt que recopiées. */
export async function geminiBatchRecipes(): Promise<FixtureRecipe[]> {
  const raw = await readFile(FIXTURE_PATH, 'utf8');
  return (JSON.parse(raw) as { recipes: FixtureRecipe[] }).recipes;
}

/** Compteurs de la doublure, par usage (`stub-server.ts`). */
export async function suggestionCalls(): Promise<number> {
  const response = await fetch(`${STUB_URL}/__calls`);
  if (!response.ok) throw new Error(`Compteur de la doublure illisible (${response.status})`);
  const counts = (await response.json()) as { suggestions: number; vision: number };
  return counts.suggestions;
}

/** Échappe une valeur pour un littéral SQL : seules des données de fixture passent ici, jamais une saisie. */
function quote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/**
 * Vide le réservoir et le journal des fournées, pour qu'un parcours puisse
 * décider lui-même de l'état de départ (le premier appel au modèle, le verrou
 * de 24 heures). `TRUNCATE` plutôt que `DELETE` : ni l'une ni l'autre table
 * n'est référencée par une clé étrangère.
 */
export async function emptySuggestionPool(): Promise<void> {
  await runSql('TRUNCATE TABLE "SuggestionPoolRecipe", "SuggestionBatch";');
}

/**
 * Dépose au réservoir les recettes `web` de la fixture, page déjà lue. Rend
 * leur nombre. Idempotent (`ON CONFLICT (identity) DO NOTHING`) : une recette
 * déjà présente, qu'elle vienne d'ici ou d'une ingestion, n'est pas touchée.
 */
export async function seedReadWebRecipes(): Promise<number> {
  const recipes = (await geminiBatchRecipes()).filter((recipe) => recipe.provenance === 'web');
  const values = recipes.map((recipe) => {
    // `pageRecipe` : ce que `extractPageRecipe` aurait tiré d'un
    // `schema.org/Recipe` sur la page — titre, ingrédients, étapes.
    const pageRecipe = {
      title: recipe.title,
      ingredients: recipe.ingredients.map((ingredient) => ingredient.label),
      steps: [...recipe.steps],
    };
    const pageText = `${recipe.title}. ${recipe.steps.join(' ')}`;
    return [
      quote(randomUUID()),
      quote(suggestionIdentity({ title: recipe.title, sourceUrl: recipe.sourceUrl })),
      `${quote(JSON.stringify(recipe))}::jsonb`,
      quote(recipe.provenance),
      `${quote(recipe.dishType)}::"DishType"`,
      quote(recipe.sourceUrl ?? ''),
      'now()',
      `${quote(JSON.stringify(pageRecipe))}::jsonb`,
      quote(pageText),
      quote('doublure-e2e'),
      'now()',
      'now()',
    ].join(', ');
  });
  await runSql(
    `INSERT INTO "SuggestionPoolRecipe" (id, identity, payload, provenance, "dishType", "sourceUrl", "verifiedAt", "pageRecipe", "pageText", model, "firstSeenAt", "lastSeenAt") ` +
      `VALUES ${values.map((row) => `(${row})`).join(', ')} ON CONFLICT (identity) DO NOTHING;`,
  );
  return recipes.length;
}
