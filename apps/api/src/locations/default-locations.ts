import { DEFAULT_LOCATIONS, type DefaultLocation } from '@kitchen/shared';
import type { Prisma } from '@prisma/client';
import { buildLocationPath } from './location-path.js';

/** Section 22 : emplacements proposés à la première connexion, renommables et supprimables. */
export async function createDefaultLocations(tx: Prisma.TransactionClient): Promise<void> {
  const create = async (node: DefaultLocation, parent: { id: string; path: string; depth: number } | null, sortOrder: number): Promise<void> => {
    const created = await tx.location.create({
      data: {
        name: node.name,
        kind: node.kind,
        temperature: node.temperature,
        parentId: parent?.id ?? null,
        path: buildLocationPath(parent?.path ?? null, node.name),
        depth: parent ? parent.depth + 1 : 0,
        sortOrder,
      },
    });
    for (const [index, child] of (node.children ?? []).entries()) await create(child, created, index);
  };
  for (const [index, node] of DEFAULT_LOCATIONS.entries()) await create(node, null, index);
}
