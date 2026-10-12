import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import { NotificationType } from 'src/common/constants/enums';
import { PaginatedResponse } from 'src/common/dto/pagination.dto';
import { AppException } from 'src/common/exceptions/app.exception';
import { toApiDocuments } from 'src/common/utils/serialize';
import {
  Notification,
  NotificationDocument,
  Student,
  StudentDocument,
  User,
  UserDocument,
} from 'src/database/schemas';
import { TelegramLinkService } from '../telegram/telegram-link.service';
import { TelegramService } from '../telegram/telegram.service';
import { QueryNotificationsDto } from './dto/notification.dto';

/**
 * One notification as a chat message.
 *
 * Lao only, and both lines always present. The catalogue requires a Lao title
 * and body and leaves English optional, so Lao is the one that is always there
 * — and a staff room that reads Lao does not want the same thing twice.
 */
function telegramText(input: Omit<NotificationInput, 'userId'>): string {
  const escape = (text: string) =>
    text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<b>${escape(input.titleLo)}</b>\n${escape(input.bodyLo)}`;
}

export interface NotificationInput {
  userId: Types.ObjectId | string;
  type: NotificationType;
  titleLo: string;
  titleEn?: string;
  bodyLo: string;
  bodyEn?: string;
  /** Deep-link payload for the client, e.g. `{ entityType, entityId }`. */
  data?: Record<string, unknown>;
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    @InjectModel(Notification.name) private readonly model: Model<NotificationDocument>,
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    @InjectModel(Student.name) private readonly studentModel: Model<StudentDocument>,
    private readonly telegram: TelegramService,
    private readonly links: TelegramLinkService,
  ) {}

  /**
   * Delivers one notification.
   *
   * Failures are logged and swallowed when no session is given: a notification
   * is a side effect of a business action, and losing one must not turn a
   * successful score submission into a 500. Pass a session where the
   * notification is genuinely part of the transaction.
   */
  async notify(input: NotificationInput, session?: ClientSession): Promise<void> {
    const document = {
      userId: new Types.ObjectId(input.userId),
      type: input.type,
      titleLo: input.titleLo,
      titleEn: input.titleEn ?? null,
      bodyLo: input.bodyLo,
      bodyEn: input.bodyEn ?? null,
      data: input.data ?? {},
    };

    if (session) {
      // Inside a transaction the push is deliberately not sent: the write can
      // still be rolled back, and a message that has arrived on somebody's phone
      // cannot be. The in-app row is the record; the caller that wants it pushed
      // sends it after the transaction commits.
      await this.model.create([document], { session });
      return;
    }

    try {
      await this.model.create(document);
    } catch (error) {
      this.logger.error(
        `Failed to deliver ${input.type} notification to ${String(input.userId)}`,
        error instanceof Error ? error.stack : String(error),
      );
    }

    await this.push([input.userId], input);
  }

  /**
   * Delivers the same notification to many users in one write.
   *
   * `insertMany` with `ordered: false` so one bad row does not abort the rest —
   * a fan-out to a whole grade must not fail because a single account was
   * deleted mid-flight.
   */
  async notifyMany(
    userIds: (Types.ObjectId | string)[],
    input: Omit<NotificationInput, 'userId'>,
  ): Promise<number> {
    if (userIds.length === 0) return 0;

    const documents = userIds.map((userId) => ({
      userId: new Types.ObjectId(userId),
      type: input.type,
      titleLo: input.titleLo,
      titleEn: input.titleEn ?? null,
      bodyLo: input.bodyLo,
      bodyEn: input.bodyEn ?? null,
      data: input.data ?? {},
    }));

    try {
      const inserted = await this.model.insertMany(documents, { ordered: false });
      await this.push(userIds, input);
      return inserted.length;
    } catch (error) {
      // `insertMany` unordered throws after inserting what it could; report the
      // partial success rather than claiming total failure.
      const partial = (error as { insertedDocs?: unknown[] }).insertedDocs?.length ?? 0;
      this.logger.error(
        `Fan-out partially failed: ${partial}/${documents.length} delivered`,
        error instanceof Error ? error.stack : String(error),
      );
      await this.push(userIds, input);
      return partial;
    }
  }

  /**
   * Sends the same notification out over Telegram, to whoever has linked.
   *
   * Everything here is best-effort and after the fact. The row in the database
   * is what the system considers delivered — the app's bell shows it whether or
   * not a phone was reachable — so a bot that is down, a person who never
   * linked, or a chat that has gone stale costs a log line and nothing else.
   *
   * Accounts with no link are simply absent from the map, which is also how the
   * feature stays opt-in: nobody is messaged until they have pressed Start.
   */
  private async push(
    userIds: (Types.ObjectId | string)[],
    input: Omit<NotificationInput, 'userId'>,
  ): Promise<void> {
    if (!this.telegram.enabled) return;

    try {
      const chats = await this.links.chatIdsFor(userIds);
      if (chats.size === 0) return;

      const text = telegramText(input);
      // Sequential on purpose: Telegram's own guidance is about thirty messages
      // a second, and the largest fan-out here is one per teacher.
      for (const chatId of chats.values()) {
        await this.telegram.sendMessage(chatId, text);
      }
    } catch (error) {
      this.logger.error(
        `Telegram fan-out for ${input.type} failed`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  /** The current user's inbox. */
  async findForUser(
    userId: string,
    query: QueryNotificationsDto,
  ): Promise<PaginatedResponse<NotificationDocument>> {
    const filter: Record<string, unknown> = { userId: new Types.ObjectId(userId) };
    if (query.isRead !== undefined) filter.isRead = query.isRead;
    if (query.type) filter.type = query.type;

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
      toApiDocuments(data as { _id?: unknown }[]) as unknown as NotificationDocument[],
      total,
      query.page,
      query.limit,
    );
  }

  async countUnread(userId: string): Promise<{ unread: number }> {
    const unread = await this.model
      .countDocuments({ userId: new Types.ObjectId(userId), isRead: false })
      .exec();
    return { unread };
  }

  /** Marks one notification read. Scoped to the owner, so ids cannot be probed. */
  async markRead(id: string, userId: string): Promise<void> {
    if (!Types.ObjectId.isValid(id)) throw AppException.notFound();

    const result = await this.model
      .updateOne(
        { _id: id, userId: new Types.ObjectId(userId), isRead: false },
        { $set: { isRead: true, readAt: new Date() } },
      )
      .exec();

    // `matchedCount === 0` covers both "not yours" and "already read"; treat a
    // missing row as not-found rather than revealing which.
    if (result.matchedCount === 0) {
      const exists = await this.model
        .exists({ _id: id, userId: new Types.ObjectId(userId) })
        .exec();
      if (!exists) throw AppException.notFound();
    }
  }

  async markAllRead(userId: string): Promise<{ updated: number }> {
    const result = await this.model
      .updateMany(
        { userId: new Types.ObjectId(userId), isRead: false },
        { $set: { isRead: true, readAt: new Date() } },
      )
      .exec();
    return { updated: result.modifiedCount };
  }

  async remove(id: string, userId: string): Promise<void> {
    const result = await this.model
      .deleteOne({ _id: id, userId: new Types.ObjectId(userId) })
      .exec();
    if (result.deletedCount === 0) throw AppException.notFound();
  }

  // ── Audience resolution ───────────────────────────────────────────────────

  /**
   * The account belonging to a person, if they have one.
   *
   * Teachers, students and guardians exist independently of accounts — a student
   * may have no login at all — so this returns null rather than throwing.
   */
  async findUserIdForPerson(
    personType: 'teacher' | 'student' | 'guardian',
    personId: Types.ObjectId | string,
  ): Promise<Types.ObjectId | null> {
    const user = await this.userModel
      .findOne({
        personType,
        personId: new Types.ObjectId(personId),
        status: 'active',
        deletedAt: null,
      })
      .select('_id')
      .lean()
      .exec();
    return user?._id ?? null;
  }

  /** Accounts of every guardian linked to a student and allowed to see records. */
  async findGuardianUserIdsForStudent(
    studentId: Types.ObjectId | string,
  ): Promise<Types.ObjectId[]> {
    const student = await this.studentModel.findById(studentId).select('guardians').lean().exec();
    if (!student) return [];

    const guardianIds = student.guardians
      .filter((link) => link.canViewRecords)
      .map((link) => link.guardianId);
    if (guardianIds.length === 0) return [];

    const users = await this.userModel
      .find({
        personType: 'guardian',
        personId: { $in: guardianIds },
        status: 'active',
        deletedAt: null,
      })
      .select('_id')
      .lean()
      .exec();

    return users.map((user) => user._id);
  }

  /** Every active account holding a given role. */
  async findUserIdsByRole(roleId: Types.ObjectId | string): Promise<Types.ObjectId[]> {
    const users = await this.userModel
      .find({ roleId: new Types.ObjectId(roleId), status: 'active', deletedAt: null })
      .select('_id')
      .lean()
      .exec();
    return users.map((user) => user._id);
  }

  /** Every active account of a given person type. */
  async findUserIdsByPersonType(
    personType: 'teacher' | 'student' | 'guardian' | 'staff',
  ): Promise<Types.ObjectId[]> {
    const users = await this.userModel
      .find({ personType, status: 'active', deletedAt: null })
      .select('_id')
      .lean()
      .exec();
    return users.map((user) => user._id);
  }

  async findAllActiveUserIds(): Promise<Types.ObjectId[]> {
    const users = await this.userModel
      .find({ status: 'active', deletedAt: null })
      .select('_id')
      .lean()
      .exec();
    return users.map((user) => user._id);
  }
}
