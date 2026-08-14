import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { AUDIT_ACTIONS, AuditAction } from 'src/common/constants/enums';
import { baseSchemaOptions, SoftDeletableDocument } from './base.schema';

// ── Audit log ───────────────────────────────────────────────────────────────

export type AuditLogDocument = HydratedDocument<AuditLog>;

/** Two years online; anything older must be exported to cold storage first. */
export const AUDIT_LOG_TTL_SECONDS = 730 * 24 * 60 * 60;

/**
 * Append-only. No soft delete, no updates — an audit trail that can be edited
 * is not an audit trail.
 */
@Schema({ collection: 'auditLogs', ...baseSchemaOptions })
export class AuditLog {
  /** Null for anonymous actions such as a failed login on an unknown username. */
  @Prop({ type: Types.ObjectId, ref: 'User', default: null, index: true })
  userId?: Types.ObjectId | null;

  @Prop({ type: String, default: null })
  username?: string | null;

  @Prop({ type: String, required: true, enum: AUDIT_ACTIONS, index: true })
  action: AuditAction;

  /** Collection name, e.g. `students`. */
  @Prop({ type: String, required: true, index: true })
  entityType: string;

  @Prop({ type: Types.ObjectId, default: null })
  entityId?: Types.ObjectId | null;

  /**
   * Only the fields that actually changed, with secrets redacted by
   * `redactSensitive()` before they reach here.
   */
  @Prop({ type: Object, default: null })
  oldValue?: Record<string, unknown> | null;

  @Prop({ type: Object, default: null })
  newValue?: Record<string, unknown> | null;

  @Prop({ type: String, default: null })
  ip?: string | null;

  @Prop({ type: String, default: null })
  userAgent?: string | null;

  /** Free-text reason, required for sensitive actions like a post-lock score edit. */
  @Prop({ type: String, default: null })
  reason?: string | null;

  createdAt?: Date;
}

export const AuditLogSchema = SchemaFactory.createForClass(AuditLog);
AuditLogSchema.set('timestamps', { createdAt: true, updatedAt: false });
AuditLogSchema.index({ entityType: 1, entityId: 1, createdAt: -1 });
AuditLogSchema.index({ userId: 1, createdAt: -1 });
AuditLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: AUDIT_LOG_TTL_SECONDS });

// ── Setting ─────────────────────────────────────────────────────────────────

export type SettingDocument = HydratedDocument<Setting>;

@Schema({ collection: 'settings', ...baseSchemaOptions })
export class Setting extends SoftDeletableDocument {
  /** Dotted key, e.g. `grading.scale`, `school.name`. */
  @Prop({ type: String, required: true, trim: true })
  key: string;

  /** Shape varies per key, so `Mixed` is the honest type here. */
  @Prop({ type: Object, required: true })
  value: unknown;

  @Prop({ type: String, required: true, default: 'general', index: true })
  category: string;

  @Prop({ type: String, default: null })
  description?: string | null;

  /** Readable without authentication (school name, locale) — never secrets. */
  @Prop({ type: Boolean, default: false })
  isPublic: boolean;

  /** Seeded settings the application depends on; cannot be deleted. */
  @Prop({ type: Boolean, default: false })
  isSystem: boolean;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  updatedBy?: Types.ObjectId | null;
}

export const SettingSchema = SchemaFactory.createForClass(Setting);
SettingSchema.index({ key: 1 }, { unique: true });
