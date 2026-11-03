import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, SchemaTypes, Types } from 'mongoose';
import { baseSchemaOptions, SoftDeletableDocument } from './base.schema';

export type GuardianReportDocument = HydratedDocument<GuardianReport>;

/**
 * ລາຍງານຫາຜູ້ປົກຄອງ — one month of one child, sent by the homeroom teacher to one
 * guardian as a link that opens without an account.
 *
 * No guardian has a login and none is going to make one, so the report travels
 * the way the school already talks to families: a message in WhatsApp. What
 * keeps that from becoming a leak is in the shape of this document:
 *
 * - **A frozen snapshot, not a window.** `snapshot` is assembled once, when the
 *   teacher sends it, and is all the link can ever show. A link forwarded to the
 *   wrong chat hands over one month of one child, never live access to the
 *   record, and never anything the teacher did not see in the preview.
 * - **Only the hash of the token.** The token itself is shown to the teacher once
 *   and lives in the link's `#fragment`, so neither this collection nor a server
 *   log can be replayed into a working link.
 * - **A second factor the link does not carry.** The last four digits of the
 *   guardian's phone, read live off the guardian at open time — so a guardian who
 *   changes number keeps their report, and a forwarded link without the phone is
 *   inert. Five wrong guesses lock it for good; the teacher reissues.
 * - **Re-checked on every open.** A child who has left, or a guardian unlinked or
 *   stripped of `canViewRecords` since, closes the link without anyone having to
 *   remember to revoke it.
 */
@Schema({ collection: 'guardianReports', ...baseSchemaOptions })
export class GuardianReport extends SoftDeletableDocument {
  @Prop({ type: SchemaTypes.ObjectId, ref: 'Student', required: true, index: true })
  studentId: Types.ObjectId;

  /** The one guardian this report is addressed to, and whose phone opens it. */
  @Prop({ type: SchemaTypes.ObjectId, ref: 'Guardian', required: true })
  guardianId: Types.ObjectId;

  /** The room the child was in when it was sent — what the homeroom rule judged. */
  @Prop({ type: SchemaTypes.ObjectId, ref: 'Classroom', required: true, index: true })
  classroomId: Types.ObjectId;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'Semester', required: true })
  semesterId: Types.ObjectId;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'SchoolYear', required: true })
  schoolYearId: Types.ObjectId;

  /** Calendar month, 1–12, inside `semesterId`. */
  @Prop({ type: Number, required: true, min: 1, max: 12 })
  month: number;

  /** SHA-256 of the link's token, hex. Never the token. */
  @Prop({ type: String, required: true, unique: true })
  tokenHash: string;

  @Prop({ type: Date, required: true })
  expiresAt: Date;

  /** Everything the guardian sees — see `GuardianReportSnapshot`. */
  @Prop({ type: Object, required: true })
  snapshot: Record<string, unknown>;

  /** Wrong phone digits entered, over the life of the current token. */
  @Prop({ type: Number, default: 0 })
  failedAttempts: number;

  @Prop({ type: Date, default: null })
  lockedAt?: Date | null;

  @Prop({ type: Date, default: null })
  revokedAt?: Date | null;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'User', default: null })
  revokedBy?: Types.ObjectId | null;

  /** Successful opens, so the teacher can see it was read. */
  @Prop({ type: Number, default: 0 })
  viewCount: number;

  @Prop({ type: Date, default: null })
  firstViewedAt?: Date | null;

  @Prop({ type: Date, default: null })
  lastViewedAt?: Date | null;

  /**
   * The room's homeroom teacher when it was sent — the name the report carries.
   * `null` for a room the office sent for while it had none; `createdBy` is who
   * actually pressed send.
   */
  @Prop({ type: SchemaTypes.ObjectId, ref: 'Teacher', default: null })
  teacherId?: Types.ObjectId | null;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'User', required: true })
  createdBy: Types.ObjectId;
}

export const GuardianReportSchema = SchemaFactory.createForClass(GuardianReport);

// The student page's list of what has been sent, newest first.
GuardianReportSchema.index({ studentId: 1, createdAt: -1 });
