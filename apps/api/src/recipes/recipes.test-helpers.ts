import type { CookResult, RecipeDto, RecipeLogDto } from '@kitchen/shared';
import type TestAgent from 'supertest/lib/agent.js';
import type { TestApp } from '../../test/app.factory.js';
import type { UserDto } from '../users/users.service.js';

/**
 * Fonctions d'aide communes aux specs d'intégration du module recettes
 * (tâches 8 à 12). Chacune prend l'agent supertest en paramètre plutôt que de
 * fermer sur une variable de module, pour rester utilisable depuis un fichier
 * de spec distinct.
 */

/** Date au format AAAA-MM-JJ, `days` jours après aujourd'hui (peut être négatif). */
export const isoIn = (days: number): string => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export async function createProduct(agent: TestAgent, body: Record<string, unknown> = {}): Promise<string> {
  const res = await agent.post('/api/v1/products').send({ name: 'Produit de test', ...body }).expect(201);
  return res.body.id as string;
}

export async function createStock(agent: TestAgent, body: Record<string, unknown>): Promise<string> {
  const res = await agent.post('/api/v1/stock').send(body).expect(201);
  return res.body.item.id as string;
}

export interface TestIngredient {
  label: string;
  productId?: string;
  categoryId?: string;
  quantity?: number;
  unit?: string;
  essential?: boolean;
  substitutable?: boolean;
}

/** Crée une recette minimale (une étape) avec les ingrédients donnés. */
export async function createRecipe(
  agent: TestAgent,
  title: string,
  ingredients: TestIngredient[] = [],
  extra: Record<string, unknown> = {},
): Promise<RecipeDto> {
  const res = await agent
    .post('/api/v1/recipes')
    .send({ title, steps: ['Étape unique'], ingredients, ...extra })
    .expect(201);
  return res.body as RecipeDto;
}

/** Enregistre une réalisation sans décrément (A26), quatre portions par défaut. */
export async function logCooked(agent: TestAgent, recipeId: string, body: Record<string, unknown> = {}): Promise<RecipeLogDto> {
  const res = await agent
    .post(`/api/v1/recipes/${recipeId}/logs`)
    .send({ servingsCooked: 4, ...body })
    .expect(201);
  return res.body as RecipeLogDto;
}

/** Cuisine une recette (EF-18) : décrémente le stock au prorata des portions cuisinées. */
export async function cookRecipe(agent: TestAgent, recipeId: string, body: Record<string, unknown>): Promise<CookResult> {
  const res = await agent.post(`/api/v1/recipes/${recipeId}/cook`).send(body).expect(200);
  return res.body as CookResult;
}

/** Crée un membre du foyer (droits identiques à l'admin sur les recettes, section 22). */
export async function createMember(agent: TestAgent, body: Record<string, unknown> = {}): Promise<UserDto> {
  const res = await agent
    .post('/api/v1/users')
    .send({ email: `membre-${Date.now()}-${Math.random().toString(36).slice(2)}@example.org`, name: 'Membre', password: 'un-mot-de-passe-long', ...body })
    .expect(201);
  return res.body as UserDto;
}

/**
 * Crée un second membre et renvoie un agent déjà connecté sous son identité
 * (`createMember` ne connecte personne). Utilisé partout où un test a besoin
 * d'un deuxième avis distinct de celui de l'administrateur (tâches 9, 10, 12).
 */
export async function createLoggedInMember(
  t: Pick<TestApp, 'agent'>,
  adminAgent: TestAgent,
  body: Record<string, unknown> = {},
): Promise<TestAgent> {
  const email = (body.email as string | undefined) ?? `membre-${Date.now()}-${Math.random().toString(36).slice(2)}@example.org`;
  const password = (body.password as string | undefined) ?? 'un-mot-de-passe-long';
  await createMember(adminAgent, { name: 'Membre', ...body, email, password });
  const memberAgent = t.agent();
  await memberAgent.post('/api/v1/auth/login').send({ email, password }).expect(204);
  return memberAgent;
}
