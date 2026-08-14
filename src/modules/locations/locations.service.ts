import { Inject, Injectable } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { InjectModel } from '@nestjs/mongoose';
import type { Cache } from 'cache-manager';
import { Model, Types } from 'mongoose';
import { LocationType } from 'src/common/constants/enums';
import { AppException } from 'src/common/exceptions/app.exception';
import { BaseCrudService, CrudContext } from 'src/common/services/base-crud.service';
import { Location, LocationDocument } from 'src/database/schemas';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { escapeRegex } from '../users/users.service';
import { CreateLocationDto, QueryLocationsDto, UpdateLocationDto } from './dto/location.dto';

/** Which parent type each level requires. A province has no parent. */
const REQUIRED_PARENT_TYPE: Record<LocationType, LocationType | null> = {
  province: null,
  district: 'province',
  village: 'district',
};

const DEPTH_BY_TYPE: Record<LocationType, number> = { province: 0, district: 1, village: 2 };

const TREE_CACHE_KEY = 'locations:tree';

export interface LocationTreeNode {
  id: string;
  nameLo: string;
  nameEn: string | null;
  type: LocationType;
  children: LocationTreeNode[];
}

@Injectable()
export class LocationsService extends BaseCrudService<LocationDocument> {
  protected readonly entityType = 'locations';
  protected readonly sortableFields = ['nameLo', 'nameEn', 'type', 'createdAt'] as const;
  protected readonly defaultSort = { nameLo: 1 as const };

  constructor(
    @InjectModel(Location.name) model: Model<LocationDocument>,
    audit: AuditLogsService,
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
  ) {
    super(model, audit);
  }

  protected buildFilter(query: QueryLocationsDto) {
    const filter: Record<string, unknown> = {};
    if (query.type) filter.type = query.type;
    if (query.parentId) filter.parentId = new Types.ObjectId(query.parentId);
    // `ancestors` matches at any depth, so this finds every village in a
    // province without walking the tree.
    if (query.ancestorId) filter.ancestors = new Types.ObjectId(query.ancestorId);
    if (query.search) {
      const escaped = escapeRegex(query.search);
      filter.$or = [
        { nameLo: { $regex: escaped, $options: 'i' } },
        { nameEn: { $regex: escaped, $options: 'i' } },
      ];
    }
    return filter;
  }

  findAll(query: QueryLocationsDto) {
    return this.findAllPaginated(query);
  }

  findOne(id: string) {
    return this.findOneOrFail(id);
  }

  /**
   * The whole hierarchy as a nested tree.
   *
   * Cached: the tree is read on nearly every address form and changes maybe
   * once a year. One `find()` plus an in-memory assembly beats three round
   * trips or a `$graphLookup`.
   */
  async getTree(): Promise<LocationTreeNode[]> {
    const cached = await this.cache.get<LocationTreeNode[]>(TREE_CACHE_KEY);
    if (cached) return cached;

    const all = await this.model
      .find({ deletedAt: null })
      .select('nameLo nameEn type parentId')
      .sort({ type: 1, nameLo: 1 })
      .lean()
      .exec();

    const byId = new Map<string, LocationTreeNode>();
    for (const doc of all) {
      byId.set(doc._id.toString(), {
        id: doc._id.toString(),
        nameLo: doc.nameLo,
        nameEn: doc.nameEn ?? null,
        type: doc.type,
        children: [],
      });
    }

    const roots: LocationTreeNode[] = [];
    for (const doc of all) {
      const node = byId.get(doc._id.toString())!;
      const parent = doc.parentId ? byId.get(doc.parentId.toString()) : undefined;
      if (parent) parent.children.push(node);
      else roots.push(node);
    }

    await this.cache.set(TREE_CACHE_KEY, roots, 3600_000);
    return roots;
  }

  async create(dto: CreateLocationDto, context: CrudContext): Promise<LocationDocument> {
    const { ancestors, depth } = await this.resolveLineage(dto.type, dto.parentId);

    const created = await this.createDocument(
      {
        ...dto,
        parentId: dto.parentId ? new Types.ObjectId(dto.parentId) : null,
        ancestors,
        depth,
      } as Partial<LocationDocument>,
      context,
    );

    await this.cache.del(TREE_CACHE_KEY);
    return created;
  }

  async update(id: string, dto: UpdateLocationDto, context: CrudContext) {
    const current = await this.findOneOrFail(id);
    const patch: Record<string, unknown> = { ...dto };

    // Re-parenting rewrites this node's lineage and every descendant's.
    if (dto.parentId !== undefined && dto.parentId !== current.parentId?.toString()) {
      if (dto.parentId === id) throw AppException.badRequest('location.cyclicParent');

      const { ancestors, depth } = await this.resolveLineage(current.type, dto.parentId);
      if (ancestors.some((a) => a.toString() === id)) {
        throw AppException.badRequest('location.cyclicParent');
      }

      patch.parentId = dto.parentId ? new Types.ObjectId(dto.parentId) : null;
      patch.ancestors = ancestors;
      patch.depth = depth;

      await this.reparentDescendants(current._id, ancestors, depth);
    }

    const updated = await this.updateDocument(id, patch, context);
    await this.cache.del(TREE_CACHE_KEY);
    return updated;
  }

  async remove(id: string, context: CrudContext): Promise<void> {
    // Deleting a province would orphan its districts and villages; the caller
    // must clear the subtree first.
    const hasChildren = await this.model.exists({ parentId: id, deletedAt: null }).exec();
    if (hasChildren) {
      throw AppException.conflict('common.inUse', { reason: 'location has child locations' });
    }

    await this.softDelete(id, context);
    await this.cache.del(TREE_CACHE_KEY);
  }

  /** Validates the parent for a given level and computes the lineage fields. */
  private async resolveLineage(
    type: LocationType,
    parentId?: string | null,
  ): Promise<{ ancestors: Types.ObjectId[]; depth: number }> {
    const requiredParent = REQUIRED_PARENT_TYPE[type];

    if (!requiredParent) {
      if (parentId) throw AppException.badRequest('location.invalidParentType');
      return { ancestors: [], depth: 0 };
    }

    if (!parentId) throw AppException.badRequest('location.invalidParentType');

    const parent = await this.model.findOne({ _id: parentId, deletedAt: null }).exec();
    if (!parent) throw AppException.badRequest('common.notFound', { field: 'parentId' });
    if (parent.type !== requiredParent) {
      throw AppException.badRequest('location.invalidParentType', {
        expected: requiredParent,
        received: parent.type,
      });
    }

    return {
      ancestors: [...parent.ancestors, parent._id],
      depth: DEPTH_BY_TYPE[type],
    };
  }

  /**
   * Rewrites `ancestors` and `depth` for everything below a moved node.
   *
   * This is the cost of the materialized-path design: reads are a single
   * indexed match, but a move touches the whole subtree. Acceptable because
   * locations move essentially never.
   */
  private async reparentDescendants(
    nodeId: Types.ObjectId,
    newAncestors: Types.ObjectId[],
    newDepth: number,
  ): Promise<void> {
    const descendants = await this.model.find({ ancestors: nodeId, deletedAt: null }).exec();

    const operations = descendants.map((descendant) => {
      // Keep the portion of the path from the moved node downwards, and graft
      // it onto the node's new prefix.
      const indexOfNode = descendant.ancestors.findIndex((a) => a.equals(nodeId));
      const belowNode = descendant.ancestors.slice(indexOfNode);
      return {
        updateOne: {
          filter: { _id: descendant._id },
          update: {
            $set: {
              ancestors: [...newAncestors, ...belowNode],
              depth: newDepth + belowNode.length,
            },
          },
        },
      };
    });

    if (operations.length > 0) await this.model.bulkWrite(operations);
  }
}
