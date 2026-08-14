import { ClientSession, FilterQuery, Model, Types, UpdateQuery } from 'mongoose';
import { PaginatedResponse, PaginationQueryDto } from '../dto/pagination.dto';
import { AppException } from '../exceptions/app.exception';
import { AuditLogsService, diffFields } from 'src/modules/audit-logs/audit-logs.service';
import type { AuthenticatedUser } from '../interfaces/authenticated-user.interface';
import { toApiDocuments } from '../utils/serialize';

export interface CrudContext {
  actor?: Pick<AuthenticatedUser, 'sub' | 'username'>;
  ip?: string | null;
  session?: ClientSession;
}

/**
 * Shared CRUD for the master-data collections.
 *
 * These collections (grade levels, subjects, school years, …) differ only in
 * their filters and validation, so the read/write/soft-delete/audit plumbing
 * lives here once. Anything with real behaviour — scores, enrollments — does
 * not extend this and is written out in full.
 *
 * Subclasses must set `entityType` (the collection name used in audit rows) and
 * `sortableFields` (the whitelist for `?sortBy=`).
 */
export abstract class BaseCrudService<T> {
  protected abstract readonly entityType: string;
  protected abstract readonly sortableFields: readonly string[];
  protected readonly defaultSort: Record<string, 1 | -1> = { createdAt: -1 };

  constructor(
    protected readonly model: Model<T>,
    protected readonly audit: AuditLogsService,
  ) {}

  /** Extra filter conditions from a subclass's query DTO. */
  protected buildFilter(_query: PaginationQueryDto): FilterQuery<T> {
    return {};
  }

  async findAllPaginated(query: PaginationQueryDto): Promise<PaginatedResponse<T>> {
    const filter = { deletedAt: null, ...this.buildFilter(query) } as FilterQuery<T>;
    const sort = query.toSort(this.sortableFields, this.defaultSort);

    const [data, total] = await Promise.all([
      this.model.find(filter).sort(sort).skip(query.skip).limit(query.limit).lean().exec(),
      this.model.countDocuments(filter).exec(),
    ]);

    // `.lean()` skips the toJSON transform, so `_id` is rewritten to `id` here —
    // otherwise list responses would differ in shape from single-document ones.
    return new PaginatedResponse(
      toApiDocuments(data as { _id?: unknown }[]) as unknown as T[],
      total,
      query.page,
      query.limit,
    );
  }

  async findOneOrFail(id: string, session?: ClientSession): Promise<T> {
    if (!Types.ObjectId.isValid(id)) throw AppException.notFound();
    const doc = await this.model
      .findOne({ _id: id, deletedAt: null } as FilterQuery<T>)
      .session(session ?? null)
      .exec();
    if (!doc) throw AppException.notFound();
    return doc as T;
  }

  /** Existence check for foreign keys, without paying to hydrate the document. */
  async assertExists(id: string | Types.ObjectId, session?: ClientSession): Promise<void> {
    const exists = await this.model
      .exists({ _id: id, deletedAt: null } as FilterQuery<T>)
      .session(session ?? null)
      .exec();
    if (!exists) throw AppException.notFound();
  }

  protected async createDocument(data: Partial<T>, context: CrudContext = {}): Promise<T> {
    const [created] = await this.model.create([data], { session: context.session });
    await this.audit.record(
      {
        action: 'create',
        entityType: this.entityType,
        entityId: created._id as Types.ObjectId,
        userId: context.actor?.sub,
        username: context.actor?.username,
        newValue: created.toObject(),
        ip: context.ip,
      },
      context.session,
    );
    return created as T;
  }

  protected async updateDocument(
    id: string,
    data: UpdateQuery<T>,
    context: CrudContext = {},
  ): Promise<T> {
    const before = await this.findOneOrFail(id, context.session);
    const updated = await this.model
      .findOneAndUpdate({ _id: id, deletedAt: null } as FilterQuery<T>, data, {
        new: true,
        runValidators: true,
        session: context.session,
      })
      .exec();

    if (!updated) throw AppException.notFound();

    const { oldValue, newValue } = diffFields(
      (before as { toObject?: () => Record<string, unknown> }).toObject?.() ??
        (before as Record<string, unknown>),
      updated.toObject(),
    );

    // A no-op update is not worth an audit row.
    if (Object.keys(newValue).length > 0) {
      await this.audit.record(
        {
          action: 'update',
          entityType: this.entityType,
          entityId: updated._id as Types.ObjectId,
          userId: context.actor?.sub,
          username: context.actor?.username,
          oldValue,
          newValue,
          ip: context.ip,
        },
        context.session,
      );
    }

    return updated as T;
  }

  /**
   * Soft delete. Historical records keep pointing at this row, so it must stay
   * readable by id even after removal.
   */
  protected async softDelete(id: string, context: CrudContext = {}): Promise<void> {
    const doc = await this.findOneAndMarkDeleted(id, context);
    await this.audit.record(
      {
        action: 'delete',
        entityType: this.entityType,
        entityId: (doc as { _id: Types.ObjectId })._id,
        userId: context.actor?.sub,
        username: context.actor?.username,
        oldValue: (doc as { toObject: () => Record<string, unknown> }).toObject(),
        ip: context.ip,
      },
      context.session,
    );
  }

  private async findOneAndMarkDeleted(id: string, context: CrudContext): Promise<T> {
    const doc = await this.model
      .findOneAndUpdate(
        { _id: id, deletedAt: null } as FilterQuery<T>,
        {
          $set: {
            deletedAt: new Date(),
            deletedBy: context.actor?.sub ? new Types.ObjectId(context.actor.sub) : null,
          },
        } as UpdateQuery<T>,
        { new: true, session: context.session },
      )
      .exec();
    if (!doc) throw AppException.notFound();
    return doc as T;
  }

  /**
   * Blocks deletion while another collection still references this row.
   *
   * Mongo has no foreign keys, so this check is the only thing standing between
   * a delete and a dangling reference.
   */
  protected async assertNotReferenced(
    references: { model: Model<unknown>; field: string; id: string | Types.ObjectId }[],
    session?: ClientSession,
  ): Promise<void> {
    for (const ref of references) {
      const exists = await ref.model
        .exists({ [ref.field]: ref.id, deletedAt: null })
        .session(session ?? null)
        .exec();
      if (exists) {
        throw AppException.conflict('common.inUse', {
          referencedBy: ref.model.modelName,
          field: ref.field,
        });
      }
    }
  }
}
