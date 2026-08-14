import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { FeedbackStatus } from 'src/common/constants/enums';
import { PaginatedResponse } from 'src/common/dto/pagination.dto';
import { AppException } from 'src/common/exceptions/app.exception';
import type { AuthenticatedUser } from 'src/common/interfaces/authenticated-user.interface';
import { toApiDocuments } from 'src/common/utils/serialize';
import { Feedback, FeedbackDocument } from 'src/database/schemas';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { NotificationsService } from '../notifications/notifications.service';
import { QueryFeedbackDto, RespondFeedbackDto, SubmitFeedbackDto } from './dto/feedback.dto';

@Injectable()
export class FeedbackService {
  constructor(
    @InjectModel(Feedback.name) private readonly model: Model<FeedbackDocument>,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditLogsService,
  ) {}

  /**
   * Records a submission.
   *
   * When `isAnonymous` is set, **nothing** identifying is stored — not the user
   * id and not the IP. Anonymity that can be undone by an administrator reading
   * the database is not anonymity, and people will not report problems honestly
   * if it can be.
   */
  async submit(
    dto: SubmitFeedbackDto,
    actor: AuthenticatedUser,
    ip: string | null,
  ): Promise<FeedbackDocument> {
    const isAnonymous = dto.isAnonymous ?? false;

    const created = await this.model.create({
      subject: dto.subject,
      message: dto.message,
      category: dto.category ?? null,
      submittedBy: isAnonymous ? null : new Types.ObjectId(actor.sub),
      isAnonymous,
      contactEmail: dto.contactEmail ?? null,
      status: 'new',
    });

    // The audit row deliberately omits the author for anonymous submissions, for
    // the same reason. The row exists so the *volume* of feedback is auditable.
    await this.audit.record({
      action: 'create',
      entityType: 'feedbacks',
      entityId: created._id,
      userId: isAnonymous ? null : actor.sub,
      username: isAnonymous ? null : actor.username,
      newValue: { category: created.category, isAnonymous },
      ip: isAnonymous ? null : ip,
    });

    return created;
  }

  async findAll(query: QueryFeedbackDto): Promise<PaginatedResponse<FeedbackDocument>> {
    const filter: Record<string, unknown> = { deletedAt: null };
    if (query.status) filter.status = query.status;
    if (query.category) filter.category = query.category;

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
      toApiDocuments(data as { _id?: unknown }[]) as unknown as FeedbackDocument[],
      total,
      query.page,
      query.limit,
    );
  }

  /** The submitter's own history — anonymous submissions are not listed here. */
  async findMine(
    userId: string,
    query: QueryFeedbackDto,
  ): Promise<PaginatedResponse<FeedbackDocument>> {
    const filter: Record<string, unknown> = {
      submittedBy: new Types.ObjectId(userId),
      deletedAt: null,
    };
    if (query.status) filter.status = query.status;

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
      toApiDocuments(data as { _id?: unknown }[]) as unknown as FeedbackDocument[],
      total,
      query.page,
      query.limit,
    );
  }

  async findOne(id: string): Promise<FeedbackDocument> {
    if (!Types.ObjectId.isValid(id)) throw AppException.notFound();
    const feedback = await this.model.findOne({ _id: id, deletedAt: null }).exec();
    if (!feedback) throw AppException.notFound();
    return feedback;
  }

  /** Moves a `new` submission to `read` when an administrator opens it. */
  async markRead(id: string): Promise<FeedbackDocument> {
    const updated = await this.model
      .findOneAndUpdate(
        { _id: id, status: 'new', deletedAt: null },
        { $set: { status: 'read' } },
        { new: true },
      )
      .exec();

    // Already read or resolved — return the current state rather than erroring.
    return updated ?? this.findOne(id);
  }

  /**
   * Responds to feedback and notifies the submitter, when there is one to
   * notify: an anonymous submission has no recipient by design.
   */
  async respond(
    id: string,
    dto: RespondFeedbackDto,
    actor: AuthenticatedUser,
    ip: string | null,
  ): Promise<FeedbackDocument> {
    const feedback = await this.findOne(id);

    const updated = await this.model
      .findOneAndUpdate(
        { _id: id },
        {
          $set: {
            response: dto.response,
            status: dto.status ?? 'resolved',
            respondedBy: new Types.ObjectId(actor.sub),
            respondedAt: new Date(),
          },
        },
        { new: true },
      )
      .exec();
    if (!updated) throw AppException.notFound();

    if (updated.submittedBy) {
      await this.notifications.notify({
        userId: updated.submittedBy,
        type: 'general',
        titleLo: 'ມີການຕອບກັບຄວາມຄິດເຫັນຂອງທ່ານ',
        titleEn: 'Your feedback has a response',
        bodyLo: dto.response.slice(0, 200),
        bodyEn: dto.response.slice(0, 200),
        data: { entityType: 'feedbacks', entityId: updated._id.toString() },
      });
    }

    await this.audit.record({
      action: 'update',
      entityType: 'feedbacks',
      entityId: updated._id,
      userId: actor.sub,
      username: actor.username,
      oldValue: { status: feedback.status },
      newValue: { status: updated.status },
      ip,
    });

    return updated;
  }

  async updateStatus(
    id: string,
    status: FeedbackStatus,
    actor: AuthenticatedUser,
  ): Promise<FeedbackDocument> {
    const updated = await this.model
      .findOneAndUpdate({ _id: id, deletedAt: null }, { $set: { status } }, { new: true })
      .exec();
    if (!updated) throw AppException.notFound();

    await this.audit.record({
      action: 'update',
      entityType: 'feedbacks',
      entityId: updated._id,
      userId: actor.sub,
      username: actor.username,
      newValue: { status },
    });

    return updated;
  }

  /** Counts per status, for the admin dashboard. */
  async getSummary(): Promise<Record<string, number>> {
    const rows = await this.model
      .aggregate<{ _id: FeedbackStatus; count: number }>([
        { $match: { deletedAt: null } },
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ])
      .exec();

    return Object.fromEntries(rows.map((row) => [row._id, row.count]));
  }
}
