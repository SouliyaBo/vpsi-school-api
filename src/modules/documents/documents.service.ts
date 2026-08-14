import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { DocumentVisibility } from 'src/common/constants/enums';
import { PaginatedResponse } from 'src/common/dto/pagination.dto';
import { AppException } from 'src/common/exceptions/app.exception';
import type { AuthenticatedUser } from 'src/common/interfaces/authenticated-user.interface';
import { toApiDocuments } from 'src/common/utils/serialize';
import { SchoolDocument, SchoolDocumentDocument } from 'src/database/schemas';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { StorageService } from '../storage/storage.service';
import { escapeRegex } from '../users/users.service';
import { QueryDocumentsDto, UpdateDocumentDto, UploadDocumentDto } from './dto/document.dto';

/**
 * Which visibility levels a caller may see.
 *
 * `staff` is the most restrictive and covers anyone who is not a student or
 * guardian — the two person types that are not school staff.
 */
function visibilitiesFor(actor: AuthenticatedUser): DocumentVisibility[] {
  switch (actor.personType) {
    case 'student':
      return ['all'];
    case 'guardian':
      return ['all', 'guardians'];
    case 'teacher':
      return ['all', 'teachers', 'staff'];
    default:
      return ['all', 'teachers', 'guardians', 'staff'];
  }
}

@Injectable()
export class DocumentsService {
  constructor(
    @InjectModel(SchoolDocument.name) private readonly model: Model<SchoolDocumentDocument>,
    private readonly storage: StorageService,
    private readonly audit: AuditLogsService,
  ) {}

  /**
   * Lists documents the caller is allowed to see.
   *
   * Visibility is applied in the query rather than filtered afterwards, so
   * pagination counts reflect what the caller can actually access — otherwise a
   * page of 20 could come back with three rows and a total of 200.
   */
  async findAll(
    query: QueryDocumentsDto,
    actor: AuthenticatedUser,
  ): Promise<PaginatedResponse<SchoolDocumentDocument>> {
    const filter: Record<string, unknown> = {
      deletedAt: null,
      visibility: { $in: visibilitiesFor(actor) },
    };

    if (query.category) filter.category = query.category;
    if (query.tag) filter.tags = query.tag;
    if (query.search) {
      const escaped = escapeRegex(query.search);
      filter.$or = [
        { title: { $regex: escaped, $options: 'i' } },
        { description: { $regex: escaped, $options: 'i' } },
      ];
    }

    const [data, total] = await Promise.all([
      this.model
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(query.skip)
        .limit(query.limit)
        .lean()
        .exec(),
      this.model.countDocuments(filter).exec(),
    ]);

    return new PaginatedResponse(
      toApiDocuments(data as { _id?: unknown }[]) as unknown as SchoolDocumentDocument[],
      total,
      query.page,
      query.limit,
    );
  }

  /** The distinct categories the caller can see, for a filter dropdown. */
  async listCategories(actor: AuthenticatedUser): Promise<string[]> {
    return this.model.distinct('category', {
      deletedAt: null,
      visibility: { $in: visibilitiesFor(actor) },
    });
  }

  async findOne(id: string, actor: AuthenticatedUser): Promise<SchoolDocumentDocument> {
    if (!Types.ObjectId.isValid(id)) throw AppException.notFound();

    const document = await this.model.findOne({ _id: id, deletedAt: null }).exec();
    if (!document) throw AppException.notFound();

    // Not-found rather than forbidden: revealing that a document exists but is
    // off-limits is itself information.
    if (!visibilitiesFor(actor).includes(document.visibility)) {
      throw AppException.notFound();
    }

    return document;
  }

  async upload(
    dto: UploadDocumentDto,
    file: { buffer: Buffer; originalname: string; mimetype: string; size: number },
    actor: AuthenticatedUser,
    ip: string | null,
  ): Promise<SchoolDocumentDocument> {
    const uploaded = await this.storage.upload(file, 'document', `documents/${dto.category}`);

    const created = await this.model.create({
      title: dto.title,
      description: dto.description ?? null,
      category: dto.category,
      tags: dto.tags ?? [],
      file: {
        key: uploaded.key,
        filename: uploaded.filename,
        mimeType: uploaded.mimeType,
        sizeBytes: uploaded.sizeBytes,
        uploadedAt: new Date(),
      },
      visibility: dto.visibility ?? 'staff',
      uploadedBy: new Types.ObjectId(actor.sub),
    });

    await this.audit.record({
      action: 'create',
      entityType: 'documents',
      entityId: created._id,
      userId: actor.sub,
      username: actor.username,
      newValue: {
        title: created.title,
        category: created.category,
        visibility: created.visibility,
      },
      ip,
    });

    return created;
  }

  async update(
    id: string,
    dto: UpdateDocumentDto,
    actor: AuthenticatedUser,
    ip: string | null,
  ): Promise<SchoolDocumentDocument> {
    await this.findOne(id, actor);

    const updated = await this.model
      .findOneAndUpdate({ _id: id, deletedAt: null }, dto, { new: true, runValidators: true })
      .exec();
    if (!updated) throw AppException.notFound();

    await this.audit.record({
      action: 'update',
      entityType: 'documents',
      entityId: updated._id,
      userId: actor.sub,
      username: actor.username,
      newValue: { title: updated.title, visibility: updated.visibility },
      ip,
    });

    return updated;
  }

  /** Signed URL plus a download count, which is the only usage signal here. */
  async getDownloadUrl(
    id: string,
    actor: AuthenticatedUser,
  ): Promise<{ url: string; filename: string; expiresInSeconds: number }> {
    const document = await this.findOne(id, actor);

    const url = await this.storage.getSignedUrl(document.file.key);
    if (!url) throw AppException.notFound();

    await this.model.updateOne({ _id: document._id }, { $inc: { downloadCount: 1 } }).exec();

    return { url, filename: document.file.filename, expiresInSeconds: 900 };
  }

  async remove(id: string, actor: AuthenticatedUser, ip: string | null): Promise<void> {
    const document = await this.findOne(id, actor);

    // Delete the object too — leaving it behind would keep the file reachable to
    // anyone holding a previously issued signed URL beyond its intended life.
    await this.storage.delete(document.file.key).catch(() => undefined);

    document.deletedAt = new Date();
    document.deletedBy = new Types.ObjectId(actor.sub);
    await document.save();

    await this.audit.record({
      action: 'delete',
      entityType: 'documents',
      entityId: document._id,
      userId: actor.sub,
      username: actor.username,
      oldValue: { title: document.title, category: document.category },
      ip,
    });
  }
}
