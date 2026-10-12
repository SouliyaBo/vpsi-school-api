import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, SchemaTypes, Types } from 'mongoose';
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

  @Prop({ type: SchemaTypes.ObjectId, ref: 'Role', required: true, index: true })
  roleId: Types.ObjectId;

  /**
   * Polymorphic link to the person this account belongs to.
   * `staff` accounts (e.g. the bootstrap admin) have no `personId`.
   */
  @Prop({ type: String, required: true, enum: PERSON_TYPES })
  personType: PersonType;

  @Prop({ type: SchemaTypes.ObjectId, default: null })
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

  /**
   * The Telegram chat this account's notifications are delivered to.
   *
   * Telegram's own id for the private conversation between the bot and the
   * person, learned when they press Start — a phone number cannot be used to
   * message anybody, so there is nothing to derive it from and it has to be
   * collected. `null` means the account has not linked, and is simply skipped
   * when notifications go out.
   *
   * A string rather than a number: Telegram's ids fit in a 64-bit integer, which
   * JavaScript does not have, and group ids are already beyond what a `number`
   * holds exactly.
   */
  @Prop({ type: String, default: null })
  telegramChatId?: string | null;

  /**
   * The one-time code the person sends the bot as `/start <code>`.
   *
   * Short-lived and single-use. It exists because the bot has no way to know who
   * is writing to it: anybody can find the bot, so a message proves only that
   * *somebody* pressed Start. The code is what ties that chat to this account,
   * and it is cleared the moment it is spent.
   */
  @Prop({ type: String, default: null, select: false })
  telegramLinkCode?: string | null;

  @Prop({ type: Date, default: null, select: false })
  telegramLinkCodeExpiresAt?: Date | null;

  @Prop({ type: Date, default: null })
  telegramLinkedAt?: Date | null;
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
    // The chat id is a delivery address, not something a client ever needs; the
    // link endpoint reports whether an account is linked and nothing more.
    delete output.telegramChatId;
    delete output.telegramLinkCode;
    delete output.telegramLinkCodeExpiresAt;
    return output;
  },
});

UserSchema.index({ username: 1 }, { unique: true });
/** Looking an account up from an incoming `/start <code>`, and from a chat id. */
UserSchema.index(
  { telegramLinkCode: 1 },
  { partialFilterExpression: { telegramLinkCode: { $type: 'string' } } },
);
UserSchema.index(
  { telegramChatId: 1 },
  { partialFilterExpression: { telegramChatId: { $type: 'string' } } },
);
UserSchema.index(
  { email: 1 },
  { unique: true, partialFilterExpression: { email: { $type: 'string' } } },
);
// One account per person. Partial so the many `personId: null` staff rows do not collide.
UserSchema.index(
  { personType: 1, personId: 1 },
  { unique: true, partialFilterExpression: { personId: { $type: 'objectId' } } },
);
