import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, SchemaTypes, Types } from 'mongoose';
import {
  ANNOUNCEMENT_PRIORITIES,
  ANNOUNCEMENT_TARGET_TYPES,
  AnnouncementPriority,
  AnnouncementTargetType,
  CALENDAR_EVENT_TYPES,
  CalendarEventType,
  FEEDBACK_STATUSES,
  FeedbackStatus,
  NOTIFICATION_TYPES,
  NotificationType,
  SCHOOL_DAY_EFFECTS,
  SchoolDayEffect,
} from 'src/common/constants/enums';
import { baseSchemaOptions, SoftDeletableDocument } from './base.schema';
import { Attachment, AttachmentSchema } from './lesson-plan.schema';

// ── Announcement ────────────────────────────────────────────────────────────

/**
 * One audience selector. Embedded because an announcement has a handful of
 * targets and they are only ever read while resolving that announcement.
 */
@Schema({ _id: false })
export class AnnouncementTarget {
  @Prop({ type: String, required: true, enum: ANNOUNCEMENT_TARGET_TYPES })
  targetType: AnnouncementTargetType;

  /** Role / grade level / classroom id. Null when `targetType` needs no id. */
  @Prop({ type: SchemaTypes.ObjectId, default: null })
  targetId?: Types.ObjectId | null;
}

export const AnnouncementTargetSchema = SchemaFactory.createForClass(AnnouncementTarget);

export type AnnouncementDocument = HydratedDocument<Announcement>;

@Schema({ collection: 'announcements', ...baseSchemaOptions })
export class Announcement extends SoftDeletableDocument {
  @Prop({ type: String, required: true, trim: true })
  titleLo: string;

  @Prop({ type: String, default: null, trim: true })
  titleEn?: string | null;

  @Prop({ type: String, required: true })
  contentLo: string;

  @Prop({ type: String, default: null })
  contentEn?: string | null;

  @Prop({ type: [AnnouncementTargetSchema], default: [] })
  targets: AnnouncementTarget[];

  @Prop({ type: String, required: true, enum: ANNOUNCEMENT_PRIORITIES, default: 'normal' })
  priority: AnnouncementPriority;

  @Prop({ type: [AttachmentSchema], default: [] })
  attachments: Attachment[];

  @Prop({ type: SchemaTypes.ObjectId, ref: 'User', required: true })
  authorId: Types.ObjectId;

  @Prop({ type: Boolean, default: false })
  isPublished: boolean;

  @Prop({ type: Date, default: null })
  publishedAt?: Date | null;

  /** After this moment the announcement drops out of the default feed. */
  @Prop({ type: Date, default: null })
  expiresAt?: Date | null;

  @Prop({ type: Boolean, default: false })
  isPinned: boolean;

  @Prop({ type: Number, default: 0 })
  viewCount: number;
}

export const AnnouncementSchema = SchemaFactory.createForClass(Announcement);
AnnouncementSchema.index({ isPublished: 1, isPinned: -1, publishedAt: -1 });
AnnouncementSchema.index({ 'targets.targetType': 1, 'targets.targetId': 1 });
AnnouncementSchema.index({ expiresAt: 1 });

// ── Notification ────────────────────────────────────────────────────────────

export type NotificationDocument = HydratedDocument<Notification>;

/** Ninety days of in-app history is plenty; a TTL index handles the pruning. */
export const NOTIFICATION_TTL_SECONDS = 90 * 24 * 60 * 60;

@Schema({ collection: 'notifications', ...baseSchemaOptions })
export class Notification {
  @Prop({ type: SchemaTypes.ObjectId, ref: 'User', required: true, index: true })
  userId: Types.ObjectId;

  @Prop({ type: String, required: true, enum: NOTIFICATION_TYPES })
  type: NotificationType;

  @Prop({ type: String, required: true })
  titleLo: string;

  @Prop({ type: String, default: null })
  titleEn?: string | null;

  @Prop({ type: String, required: true })
  bodyLo: string;

  @Prop({ type: String, default: null })
  bodyEn?: string | null;

  /** Deep-link target in the client, e.g. `{ entityType, entityId }`. */
  @Prop({ type: Object, default: {} })
  data: Record<string, unknown>;

  @Prop({ type: Boolean, default: false })
  isRead: boolean;

  @Prop({ type: Date, default: null })
  readAt?: Date | null;

  createdAt?: Date;
  updatedAt?: Date;
}

export const NotificationSchema = SchemaFactory.createForClass(Notification);
NotificationSchema.set('timestamps', true);
NotificationSchema.index({ userId: 1, isRead: 1, createdAt: -1 });
NotificationSchema.index({ createdAt: 1 }, { expireAfterSeconds: NOTIFICATION_TTL_SECONDS });

// ── Calendar event ──────────────────────────────────────────────────────────

export type CalendarEventDocument = HydratedDocument<CalendarEvent>;

@Schema({ collection: 'calendarEvents', ...baseSchemaOptions })
export class CalendarEvent extends SoftDeletableDocument {
  @Prop({ type: String, required: true, trim: true })
  titleLo: string;

  @Prop({ type: String, default: null, trim: true })
  titleEn?: string | null;

  @Prop({ type: String, default: null })
  description?: string | null;

  @Prop({ type: String, required: true, enum: CALENDAR_EVENT_TYPES, index: true })
  type: CalendarEventType;

  /**
   * Whether the school is open, staffed but not teaching, or shut — the field the
   * roll-call and behaviour-register reports read the calendar for.
   *
   * Stored per event rather than derived from `type` on read, and indexed: the
   * office overrides it (a festival that closes the school one year and does not
   * the next), and a stored value is what makes the override survive. Defaulted
   * from `DEFAULT_DAY_EFFECT` at write time so nothing has to be picked twice.
   */
  @Prop({ type: String, required: true, enum: SCHOOL_DAY_EFFECTS, index: true })
  dayEffect: SchoolDayEffect;

  @Prop({ type: Date, required: true, index: true })
  startDate: Date;

  /** Inclusive — a one-day event has `endDate` equal to `startDate`. */
  @Prop({ type: Date, required: true })
  endDate: Date;

  @Prop({ type: Boolean, default: true })
  isAllDay: boolean;

  /**
   * ຄຶ່ງວັນ — set on a day the school runs a morning only.
   *
   * The sheet prints exactly one (`10 Jun — Last Day of School (half day)`), and
   * it is a flag rather than a `dayEffect` of its own because the day is open and
   * the lessons that do run are owed like any other.
   */
  @Prop({ type: Boolean, default: false })
  isHalfDay: boolean;

  @Prop({ type: String, default: null, trim: true })
  location?: string | null;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'SchoolYear', default: null, index: true })
  schoolYearId?: Types.ObjectId | null;

  /** Empty means school-wide. Who is *told*, which is not who is closed. */
  @Prop({ type: [AnnouncementTargetSchema], default: [] })
  targets: AnnouncementTarget[];

  /**
   * The classes this event closes, when it does not close the whole school.
   *
   * Both empty — the usual case — means school-wide. The school also stands one
   * year or one room down on its own: ມ.7 sitting a national exam, a room whose
   * teacher is away. On such a day the rest of the school teaches and owes its
   * registers; only the named classes do not, and counting the day against them
   * is what this exists to stop.
   *
   * Deliberately *not* `targets`. That list says who is shown the event and can
   * name a role — a holiday announced to every teacher is not a holiday for
   * every teacher's class. Conflating the two would make "tell the parents"
   * close a classroom.
   *
   * A grade level closes every room in it; a classroom closes only itself. The
   * office writes both, so both are stored rather than the rooms being expanded
   * at write time — a room added to ມ.1 next month must be closed by last
   * month's "ມ.1 ຫຍຸດ" too.
   */
  @Prop({ type: [SchemaTypes.ObjectId], ref: 'GradeLevel', default: [] })
  appliesToGradeLevelIds: Types.ObjectId[];

  @Prop({ type: [SchemaTypes.ObjectId], ref: 'Classroom', default: [] })
  appliesToClassroomIds: Types.ObjectId[];

  @Prop({ type: String, default: null })
  colorHex?: string | null;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'User', required: true })
  createdBy: Types.ObjectId;
}

export const CalendarEventSchema = SchemaFactory.createForClass(CalendarEvent);
CalendarEventSchema.index({ startDate: 1, endDate: 1 });
CalendarEventSchema.index({ schoolYearId: 1, type: 1, startDate: 1 });

// ── Feedback ────────────────────────────────────────────────────────────────

export type FeedbackDocument = HydratedDocument<Feedback>;

@Schema({ collection: 'feedbacks', ...baseSchemaOptions })
export class Feedback extends SoftDeletableDocument {
  @Prop({ type: String, required: true, trim: true })
  subject: string;

  @Prop({ type: String, required: true })
  message: string;

  @Prop({ type: String, default: null, trim: true })
  category?: string | null;

  /**
   * Null for anonymous submissions. When anonymous, no identifying field is
   * recorded at all — not even an IP — so the submission cannot be traced back.
   */
  @Prop({ type: SchemaTypes.ObjectId, ref: 'User', default: null, index: true })
  submittedBy?: Types.ObjectId | null;

  @Prop({ type: Boolean, default: false })
  isAnonymous: boolean;

  @Prop({ type: String, default: null, trim: true })
  contactEmail?: string | null;

  @Prop({ type: String, required: true, enum: FEEDBACK_STATUSES, default: 'new' })
  status: FeedbackStatus;

  @Prop({ type: String, default: null })
  response?: string | null;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'User', default: null })
  respondedBy?: Types.ObjectId | null;

  @Prop({ type: Date, default: null })
  respondedAt?: Date | null;
}

export const FeedbackSchema = SchemaFactory.createForClass(Feedback);
FeedbackSchema.index({ status: 1, createdAt: -1 });
