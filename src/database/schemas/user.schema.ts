import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { PERSON_TYPES, PersonType, USER_STATUSES, UserStatus } from 'src/common/constants/enums';
import { baseSchemaOptions, SoftDeletableDocument } from './base.schema';

/**
 * A single issued refresh token, stored as a SHA-256 hash.
 *
 * Hashed so a database leak cannot be replayed as a live session. Bounded to
 * MAX_ACTIVE_SESSIONS entries — oldest evicted first — so the array can never
 * grow without limit.
 */
@Schema({ _id: false })
export class RefreshTokenEntry {
  @Prop({ type: String, required: true })
  tokenHash: string;

  @Prop({ type: Date, required: true })
  expiresAt: Date;

  @Prop({ type: Date, required: true })
  createdAt: Date;

  @Prop({ type: String, default: null })
  userAgent?: string | null;

  @Prop({ type: String, default: null })
  ip?: string | null;
}

export const RefreshTokenEntrySchema = SchemaFactory.createForClass(RefreshTokenEntry);

/** Keeping five devices per account bounds the array without annoying users. */
export const MAX_ACTIVE_SESSIONS = 5;

export type UserDocument = HydratedDocument<User>;

@Schema({ collection: 'users', ...baseSchemaOptions })
export class User extends SoftDeletableDocument {
  @Prop({ type: String, required: true, trim: true, lowercase: true })
  username: string;

  @Prop({ type: String, default: null, trim: true, lowercase: true })
  email?: string | null;

  /** argon2id hash. Never selected by default — see the `select: false` below. */
  @Prop({ type: String, required: true, select: false })
  passwordHash: string;

  @Prop({ type: Types.ObjectId, ref: 'Role', required: true, index: true })
  roleId: Types.ObjectId;

  /**
   * Polymorphic link to the person this account belongs to.
   * `staff` accounts (e.g. the bootstrap admin) have no `personId`.
   */
  @Prop({ type: String, required: true, enum: PERSON_TYPES })
  personType: PersonType;

  @Prop({ type: Types.ObjectId, default: null })
  personId?: Types.ObjectId | null;

  @Prop({ type: String, required: true, enum: USER_STATUSES, default: 'active' })
  status: UserStatus;

  @Prop({ type: [RefreshTokenEntrySchema], default: [], select: false })
  refreshTokens: RefreshTokenEntry[];

  @Prop({ type: Date, default: null })
  lastLoginAt?: Date | null;

  // ── Brute-force protection ────────────────────────────────────────────────

  @Prop({ type: Number, default: 0 })
  failedLoginAttempts: number;

  /** While in the future, login is rejected regardless of password validity. */
  @Prop({ type: Date, default: null })
  lockedUntil?: Date | null;

  // ── Password reset ────────────────────────────────────────────────────────

  @Prop({ type: String, default: null, select: false })
  passwordResetTokenHash?: string | null;

  @Prop({ type: Date, default: null, select: false })
  passwordResetExpiresAt?: Date | null;

  @Prop({ type: Date, default: null })
  passwordChangedAt?: Date | null;

  /** Forces a password change on next login — set for seeded/admin-reset accounts. */
  @Prop({ type: Boolean, default: false })
  mustChangePassword: boolean;

  @Prop({ type: String, default: 'lo' })
  locale: string;
}

export const UserSchema = SchemaFactory.createForClass(User);

// Defence in depth: even if a query does `.select('+passwordHash')`, serializing
// the document to JSON must never expose the hash or session tokens.
UserSchema.set('toJSON', {
  ...baseSchemaOptions.toJSON,
  transform: (_doc, ret) => {
    const output = ret as unknown as Record<string, unknown>;
    output.id = output._id?.toString();
    delete output._id;
    delete output.passwordHash;
    delete output.refreshTokens;
    delete output.passwordResetTokenHash;
    delete output.passwordResetExpiresAt;
    return output;
  },
});

UserSchema.index({ username: 1 }, { unique: true });
UserSchema.index(
  { email: 1 },
  { unique: true, partialFilterExpression: { email: { $type: 'string' } } },
);
// One account per person. Partial so the many `personId: null` staff rows do not collide.
UserSchema.index(
  { personType: 1, personId: 1 },
  { unique: true, partialFilterExpression: { personId: { $type: 'objectId' } } },
);
