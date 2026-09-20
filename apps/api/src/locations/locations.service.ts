import { Injectable } from '@nestjs/common';
import type { CreateLocationInput, LocationNode, UpdateLocationInput } from '@kitchen/shared';
import type { Location, Prisma } from '@prisma/client';
import { ApiError } from '../common/api-error.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { buildLocationPath } from './location-path.js';

type LocationRow = Location & { itemCount: number };

@Injectable()
export class LocationsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Arbre complet, trié par `sortOrder` puis nom, avec le nombre de lots actifs par emplacement. */
  async tree(): Promise<LocationNode[]> {
    const [locations, counts] = await Promise.all([
      this.prisma.location.findMany({ orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] }),
      this.prisma.stockItem.groupBy({ by: ['locationId'], where: { archivedAt: null }, _count: { _all: true } }),
    ]);
    const countByLocation = new Map(counts.map((c) => [c.locationId, c._count._all]));
    const nodes = new Map<string, LocationNode>();
    for (const l of locations) nodes.set(l.id, toNode({ ...l, itemCount: countByLocation.get(l.id) ?? 0 }));
    const roots: LocationNode[] = [];
    for (const node of nodes.values()) {
      const parent = node.parentId ? nodes.get(node.parentId) : undefined;
      if (parent) parent.children.push(node);
      else roots.push(node);
    }
    return roots;
  }

  async get(id: string): Promise<LocationNode> {
    const location = await this.prisma.location.findUnique({ where: { id } });
    if (!location) throw ApiError.notFound('Emplacement introuvable');
    const itemCount = await this.prisma.stockItem.count({ where: { locationId: id, archivedAt: null } });
    return toNode({ ...location, itemCount });
  }

  async create(input: CreateLocationInput): Promise<LocationNode> {
    const parent = input.parentId ? await this.requireLocation(input.parentId) : null;
    const path = buildLocationPath(parent?.path ?? null, input.name);
    await this.ensurePathFree(path);
    const created = await this.prisma.location.create({
      data: {
        name: input.name,
        parentId: parent?.id ?? null,
        path,
        depth: parent ? parent.depth + 1 : 0,
        kind: input.kind ?? null,
        temperature: input.temperature ?? null,
        sortOrder: input.sortOrder ?? 0,
      },
    });
    return toNode({ ...created, itemCount: 0 });
  }

  /** Renommage ou déplacement : le chemin et la profondeur sont recalculés sur toute la descendance. */
  async update(id: string, input: UpdateLocationInput): Promise<LocationNode> {
    const current = await this.requireLocation(id);
    const parentChanged = input.parentId !== undefined && input.parentId !== current.parentId;
    const parent = parentChanged
      ? input.parentId
        ? await this.requireLocation(input.parentId)
        : null
      : current.parentId
        ? await this.requireLocation(current.parentId)
        : null;

    if (parentChanged && parent && (parent.id === id || parent.path.startsWith(`${current.path}/`))) {
      throw ApiError.businessRule('Un emplacement ne peut pas être déplacé sous lui-même');
    }

    const name = input.name ?? current.name;
    const newPath = buildLocationPath(parent?.path ?? null, name);
    const newDepth = parent ? parent.depth + 1 : 0;
    if (newPath !== current.path) await this.ensurePathFree(newPath);

    await this.prisma.$transaction(async (tx) => {
      await tx.location.update({
        where: { id },
        data: {
          name,
          parentId: parent?.id ?? null,
          path: newPath,
          depth: newDepth,
          ...(input.kind !== undefined ? { kind: input.kind } : {}),
          ...(input.temperature !== undefined ? { temperature: input.temperature } : {}),
          ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
        },
      });
      if (newPath !== current.path) await this.repathDescendants(tx, current.path, newPath, newDepth - current.depth);
    });
    return this.get(id);
  }

  /** Section 6 : suppression interdite avec des enfants ou du stock rattaché. */
  async remove(id: string): Promise<void> {
    const location = await this.requireLocation(id);
    const [childCount, itemCount] = await Promise.all([
      this.prisma.location.count({ where: { parentId: id } }),
      this.prisma.stockItem.count({ where: { locationId: id, archivedAt: null } }),
    ]);
    if (childCount > 0 || itemCount > 0) {
      throw ApiError.conflict('Cet emplacement contient encore des articles ou des sous-emplacements', {
        childCount,
        itemCount,
        parentId: location.parentId,
      });
    }
    // Les lots archivés gardent leur historique : on les remonte au parent avant suppression.
    await this.prisma.$transaction(async (tx) => {
      if (location.parentId) await tx.stockItem.updateMany({ where: { locationId: id }, data: { locationId: location.parentId } });
      else await tx.stockItem.deleteMany({ where: { locationId: id, archivedAt: { not: null } } });
      await tx.location.delete({ where: { id } });
    });
  }

  /** Section 17 : proposition de déplacer le contenu vers le parent avant suppression. */
  async moveContentsToParent(id: string): Promise<{ moved: number; targetId: string }> {
    const location = await this.requireLocation(id);
    if (!location.parentId) throw ApiError.businessRule('Un emplacement racine n’a pas de parent où déplacer son contenu');
    const result = await this.prisma.stockItem.updateMany({ where: { locationId: id, archivedAt: null }, data: { locationId: location.parentId } });
    return { moved: result.count, targetId: location.parentId };
  }

  private async requireLocation(id: string): Promise<Location> {
    const location = await this.prisma.location.findUnique({ where: { id } });
    if (!location) throw ApiError.notFound('Emplacement introuvable');
    return location;
  }

  private async ensurePathFree(path: string): Promise<void> {
    if (await this.prisma.location.findUnique({ where: { path } })) {
      throw ApiError.conflict('Un emplacement porte déjà ce nom à cet endroit');
    }
  }

  private async repathDescendants(tx: Prisma.TransactionClient, oldPrefix: string, newPrefix: string, depthDelta: number): Promise<void> {
    const descendants = await tx.location.findMany({ where: { path: { startsWith: `${oldPrefix}/` } } });
    for (const d of descendants) {
      await tx.location.update({
        where: { id: d.id },
        data: { path: `${newPrefix}${d.path.slice(oldPrefix.length)}`, depth: d.depth + depthDelta },
      });
    }
  }
}

function toNode(l: LocationRow): LocationNode {
  return {
    id: l.id,
    name: l.name,
    parentId: l.parentId,
    path: l.path,
    depth: l.depth,
    kind: l.kind,
    temperature: l.temperature,
    sortOrder: l.sortOrder,
    itemCount: l.itemCount,
    children: [],
  };
}
