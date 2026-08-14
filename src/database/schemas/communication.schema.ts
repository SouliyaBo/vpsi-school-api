import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
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
  @Prop({ type: Types.ObjectId, default: null })
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

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
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
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
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

  @Prop({ type: Date, required: true, index: true })
  startDate: Date;

  @Prop({ type: Date, required: true })
  endDate: Date;

  @Prop({ type: Boolean, default: true })
  isAllDay: boolean;

  @Prop({ type: String, default: null, trim: true })
  location?: string | null;

  @Prop({ type: Types.ObjectId, ref: 'SchoolYear', default: null, index: true })
  schoolYearId?: Types.ObjectId | null;

  /** Empty means school-wide. */
  @Prop({ type: [AnnouncementTargetSchema], default: [] })
  targets: AnnouncementTarget[];

  @Prop({ type: String, default: null })
  colorHex?: string | null;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
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
  @Prop({ type: Types.ObjectId, ref: 'User', default: null, index: true })
  submittedBy?: Types.ObjectId | null;

  @Prop({ type: Boolean, default: false })
  isAnonymous: boolean;

  @Prop({ type: String, default: null, trim: true })
  contactEmail?: string | null;

  @Prop({ type: String, required: true, enum: FEEDBACK_STATUSES, default: 'new' })
  status: FeedbackStatus;

  @Prop({ type: String, default: null })
  response?: string | null;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  respondedBy?: Types.ObjectId | null;

  @Prop({ type: Date, default: null })
  respondedAt?: Date | null;
}

export const FeedbackSchema = SchemaFactory.createForClass(Feedback);
FeedbackSchema.index({ status: 1, createdAt: -1 });
