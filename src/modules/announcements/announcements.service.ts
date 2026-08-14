import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { PaginatedResponse } from 'src/common/dto/pagination.dto';
import { AppException } from 'src/common/exceptions/app.exception';
import type { AuthenticatedUser } from 'src/common/interfaces/authenticated-user.interface';
import { toApiDocuments } from 'src/common/utils/serialize';
import {
  Announcement,
  AnnouncementDocument,
  AnnouncementTarget,
  Attachment,
  Enrollment,
  EnrollmentDocument,
} from 'src/database/schemas';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { NotificationsService } from '../notifications/notifications.service';
import { StorageService } from '../storage/storage.service';
import {
  CreateAnnouncementDto,
  QueryAnnouncementsDto,
  UpdateAnnouncementDto,
} from './dto/announcement.dto';

/** Target types that identify their audience without needing an id. */
const ID_LESS_TARGETS = new Set(['all', 'teachers', 'guardians']);

@Injectable()
export class AnnouncementsService {
  private readonly logger = new Logger(AnnouncementsService.name);

  constructor(
    @InjectModel(Announcement.name) private readonly model: Model<AnnouncementDocument>,
    @InjectModel(Enrollment.name) private readonly enrollmentModel: Model<EnrollmentDocument>,
    private readonly notifications: NotificationsService,
    private readonly storage: StorageService,
    private readonly audit: AuditLogsService,
  ) {}

  /**
   * The feed for the current user.
   *
   * Filters to announcements whose targets actually include this user, so a
   * classroom notice does not appear school-wide. Staff with
   * `announcements:manage` see everything, including drafts, because that is the
   * editorial view.
   */
  async findFeed(
    query: QueryAnnouncementsDto,
    actor: AuthenticatedUser,
  ): Promise<PaginatedResponse<AnnouncementDocument>> {
    const canManage = actor.permissions.some(
      (p) => p.resource === 'announcements' && p.actions.includes('manage'),
    );

    const filter: Record<string, unknown> = { deletedAt: null };
    if (query.priority) filter.priority = query.priority;

    if (canManage) {
      if (query.isPublished !== undefined) filter.isPublished = query.isPublished;
    } else {
      // Non-editors never see a draft.
      filter.isPublished = true;
    }

    if (!query.includeExpired) {
      filter.$and = [{ $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }] }];
    }

    if (!canManage) {
      const audienceClause = await this.buildAudienceClause(actor);
      filter.$and = [...((filter.$and as unknown[]) ?? []), audienceClause];
    }

    const [data, total] = await Promise.all([
      this.model
        .find(filter)
        .sort({ isPinned: -1, publishedAt: -1, createdAt: -1 })
        .skip(query.skip)
        .limit(query.limit)
        .lean()
        .exec(),
      this.model.countDocuments(filter).exec(),
    ]);

    return new PaginatedResponse(
      toApiDocuments(data as { _id?: unknown }[]) as unknown as AnnouncementDocument[],
      total,
      query.page,
      query.limit,
    );
  }

  async findOne(id: string): Promise<AnnouncementDocument> {
    if (!Types.ObjectId.isValid(id)) throw AppException.notFound();
    const announcement = await this.model.findOne({ _id: id, deletedAt: null }).exec();
    if (!announcement) throw AppException.notFound();
    return announcement;
  }

  /** Reads one and counts the view. */
  async view(id: string): Promise<AnnouncementDocument> {
    const announcement = await this.model
      .findOneAndUpdate({ _id: id, deletedAt: null }, { $inc: { viewCount: 1 } }, { new: true })
      .exec();
    if (!announcement) throw AppException.notFound();
    return announcement;
  }

  async create(
    dto: CreateAnnouncementDto,
    actor: AuthenticatedUser,
    ip: string | null,
  ): Promise<AnnouncementDocument> {
    const targets = this.validateTargets(dto.targets);

    const created = await this.model.create({
      titleLo: dto.titleLo,
      titleEn: dto.titleEn ?? null,
      contentLo: dto.contentLo,
      contentEn: dto.contentEn ?? null,
      targets,
      priority: dto.priority ?? 'normal',
      expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
      isPinned: dto.isPinned ?? false,
      authorId: new Types.ObjectId(actor.sub),
      // Created as a draft: publishing is a separate, deliberate act because it
      // fans out notifications that cannot be recalled.
      isPublished: false,
    });

    await this.audit.record({
      action: 'create',
      entityType: 'announcements',
      entityId: created._id,
      userId: actor.sub,
      username: actor.username,
      newValue: { titleLo: created.titleLo, targets: created.targets.length },
      ip,
    });

    return created;
  }

  async update(
    id: string,
    dto: UpdateAnnouncementDto,
    actor: AuthenticatedUser,
    ip: string | null,
  ): Promise<AnnouncementDocument> {
    const announcement = await this.findOne(id);

    const patch: Record<string, unknown> = { ...dto };
    if (dto.targets) patch.targets = this.validateTargets(dto.targets);
    if (dto.expiresAt !== undefined) {
      patch.expiresAt = dto.expiresAt ? new Date(dto.expiresAt) : null;
    }

    const updated = await this.model
      .findOneAndUpdate({ _id: id }, patch, { new: true, runValidators: true })
      .exec();
    if (!updated) throw AppException.notFound();

    await this.audit.record({
      action: 'update',
      entityType: 'announcements',
      entityId: updated._id,
      userId: actor.sub,
      username: actor.username,
      oldValue: { titleLo: announcement.titleLo },
      newValue: { titleLo: updated.titleLo },
      ip,
    });

    return updated;
  }

  /**
   * Publishes an announcement and notifies its audience.
   *
   * Only ever fans out once: republishing an already-published announcement
   * would notify everyone a second time, which is why the status is checked
   * rather than simply set.
   */
  async publish(
    id: string,
    actor: AuthenticatedUser,
    ip: string | null,
  ): Promise<{ published: boolean; notified: number }> {
    const announcement = await this.findOne(id);

    if (announcement.isPublished) {
      throw AppException.conflict('common.validationFailed', {
        reason: 'announcement is already published; notifications are not resent',
      });
    }

    const updated = await this.model
      .findOneAndUpdate(
        { _id: id, isPublished: false },
        { $set: { isPublished: true, publishedAt: new Date() } },
        { new: true },
      )
      .exec();

    // Lost the race with a concurrent publish — the other one did the fan-out.
    if (!updated) {
      throw AppException.conflict('common.validationFailed', {
        reason: 'announcement was published concurrently',
      });
    }

    const recipients = await this.resolveRecipients(updated.targets);
    const notified = await this.notifications.notifyMany(recipients, {
      type: 'announcement',
      titleLo: updated.titleLo,
      titleEn: updated.titleEn ?? undefined,
      // The body is trimmed for the notification; the full text lives on the
      // announcement the deep link points at.
      bodyLo: truncate(updated.contentLo, 200),
      bodyEn: updated.contentEn ? truncate(updated.contentEn, 200) : undefined,
      data: {
        entityType: 'announcements',
        entityId: updated._id.toString(),
        priority: updated.priority,
      },
    });

    await this.audit.record({
      action: 'update',
      entityType: 'announcements',
      entityId: updated._id,
      userId: actor.sub,
      username: actor.username,
      newValue: { isPublished: true, notified },
      ip,
      reason: 'announcement published',
    });

    this.logger.log(`Published "${updated.titleLo}" to ${notified} recipients`);
    return { published: true, notified };
  }

  async addAttachment(
    id: string,
    file: { buffer: Buffer; originalname: string; mimetype: string; size: number },
  ): Promise<AnnouncementDocument> {
    await this.findOne(id);
    const uploaded = await this.storage.upload(file, 'document', `announcements/${id}`);

    const attachment: Attachment = {
      key: uploaded.key,
      filename: uploaded.filename,
      mimeType: uploaded.mimeType,
      sizeBytes: uploaded.sizeBytes,
      uploadedAt: new Date(),
    };

    const updated = await this.model
      .findOneAndUpdate({ _id: id }, { $push: { attachments: attachment } }, { new: true })
      .exec();
    if (!updated) throw AppException.notFound();
    return updated;
  }

  async getAttachmentUrls(id: string): Promise<{ filename: string; url: string | null }[]> {
    const announcement = await this.findOne(id);
    return Promise.all(
      announcement.attachments.map(async (attachment) => ({
        filename: attachment.filename,
        url: await this.storage.getSignedUrl(attachment.key),
      })),
    );
  }

  async remove(id: string, actor: AuthenticatedUser, ip: string | null): Promise<void> {
    const announcement = await this.findOne(id);

    announcement.deletedAt = new Date();
    announcement.deletedBy = new Types.ObjectId(actor.sub);
    await announcement.save();

    await this.audit.record({
      action: 'delete',
      entityType: 'announcements',
      entityId: announcement._id,
      userId: actor.sub,
      username: actor.username,
      oldValue: { titleLo: announcement.titleLo },
      ip,
    });
  }

  // ── Targeting ─────────────────────────────────────────────────────────────

  /**
   * Rejects targets that cannot identify an audience.
   *
   * A `classroom` target with no id would silently match nobody — the
   * announcement would look published and reach no one, which is worse than an
   * error.
   */
  private validateTargets(
    targets: { targetType: string; targetId?: string }[],
  ): AnnouncementTarget[] {
    return targets.map((target) => {
      const needsId = !ID_LESS_TARGETS.has(target.targetType);

      if (needsId && !target.targetId) {
        throw AppException.badRequest('common.validationFailed', {
          field: 'targets',
          reason: `targetType "${target.targetType}" requires a targetId`,
        });
      }
      if (!needsId && target.targetId) {
        throw AppException.badRequest('common.validationFailed', {
          field: 'targets',
          reason: `targetType "${target.targetType}" must not carry a targetId`,
        });
      }

      return {
        targetType: target.targetType as AnnouncementTarget['targetType'],
        targetId: target.targetId ? new Types.ObjectId(target.targetId) : null,
      };
    });
  }

  /**
   * Expands targets into the set of user ids to notify.
   *
   * Deduplicated, because overlapping targets (a classroom *and* "all
   * guardians") are normal and nobody should get the same announcement twice.
   */
  private async resolveRecipients(targets: AnnouncementTarget[]): Promise<Types.ObjectId[]> {
    const recipients = new Map<string, Types.ObjectId>();

    const add = (ids: Types.ObjectId[]) => {
      for (const id of ids) recipients.set(id.toString(), id);
    };

    for (const target of targets) {
      switch (target.targetType) {
        case 'all':
          add(await this.notifications.findAllActiveUserIds());
          break;
        case 'teachers':
          add(await this.notifications.findUserIdsByPersonType('teacher'));
          break;
        case 'guardians':
          add(await this.notifications.findUserIdsByPersonType('guardian'));
          break;
        case 'role':
          if (target.targetId) add(await this.notifications.findUserIdsByRole(target.targetId));
          break;
        case 'classroom':
          if (target.targetId) add(await this.resolveClassroomAudience(target.targetId));
          break;
        case 'grade_level':
          if (target.targetId) add(await this.resolveGradeLevelAudience(target.targetId));
          break;
        default:
          this.logger.warn(`Unknown announcement target type: ${String(target.targetType)}`);
      }
    }

    return [...recipients.values()];
  }

  /** Students in a classroom plus the guardians entitled to see their records. */
  private async resolveClassroomAudience(classroomId: Types.ObjectId): Promise<Types.ObjectId[]> {
    const enrollments = await this.enrollmentModel
      .find({ classroomId, status: 'active', deletedAt: null })
      .select('studentId')
      .lean()
      .exec();

    return this.audienceForStudents(enrollments.map((e) => e.studentId));
  }

  private async resolveGradeLevelAudience(gradeLevelId: Types.ObjectId): Promise<Types.ObjectId[]> {
    const enrollments = await this.enrollmentModel
      .find({ gradeLevelId, status: 'active', deletedAt: null })
      .select('studentId')
      .lean()
      .exec();

    return this.audienceForStudents(enrollments.map((e) => e.studentId));
  }

  private async audienceForStudents(studentIds: Types.ObjectId[]): Promise<Types.ObjectId[]> {
    const collected: Types.ObjectId[] = [];

    for (const studentId of studentIds) {
      const studentUserId = await this.notifications.findUserIdForPerson('student', studentId);
      if (studentUserId) collected.push(studentUserId);
      collected.push(...(await this.notifications.findGuardianUserIdsForStudent(studentId)));
    }

    return collected;
  }

  /**
   * Whether an announcement's targets include this user.
   *
   * Built as a Mongo `$or` clause rather than filtering in memory so the feed
   * stays paginated in the database.
   */
  private async buildAudienceClause(actor: AuthenticatedUser): Promise<Record<string, unknown>> {
    const clauses: Record<string, unknown>[] = [
      { 'targets.targetType': 'all' },
      { 'targets.targetType': 'role', 'targets.targetId': new Types.ObjectId(actor.roleId) },
    ];

    if (actor.personType === 'teacher') {
      clauses.push({ 'targets.targetType': 'teachers' });
    }
    if (actor.personType === 'guardian') {
      clauses.push({ 'targets.targetType': 'guardians' });
    }

    // A student sees notices aimed at their classroom and grade level.
    if (actor.personType === 'student' && actor.personId) {
      const enrollment = await this.enrollmentModel
        .findOne({
          studentId: new Types.ObjectId(actor.personId),
          status: 'active',
          deletedAt: null,
        })
        .select('classroomId gradeLevelId')
        .lean()
        .exec();

      if (enrollment) {
        clauses.push({
          'targets.targetType': 'classroom',
          'targets.targetId': enrollment.classroomId,
        });
        clauses.push({
          'targets.targetType': 'grade_level',
          'targets.targetId': enrollment.gradeLevelId,
        });
      }
    }

    return { $or: clauses };
  }
}

/** Trims to a length without cutting mid-word where avoidable. */
function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  const cut = text.slice(0, maxLength);
  const lastSpace = cut.lastIndexOf(' ');
  return `${lastSpace > maxLength * 0.6 ? cut.slice(0, lastSpace) : cut}…`;
}
