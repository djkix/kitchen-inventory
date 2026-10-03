import type { RecipeDto, RecipeLogDto } from '@kitchen/shared';
import type TestAgent from 'supertest/lib/agent.js';
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

/** Crée un membre du foyer (droits identiques à l'admin sur les recettes, section 22). */
export async function createMember(agent: TestAgent, body: Record<string, unknown> = {}): Promise<UserDto> {
  const res = await agent
    .post('/api/v1/users')
    .send({ email: `membre-${Date.now()}-${Math.random().toString(36).slice(2)}@example.org`, name: 'Membre', password: 'un-mot-de-passe-long', ...body })
    .expect(201);
  return res.body as UserDto;
}
