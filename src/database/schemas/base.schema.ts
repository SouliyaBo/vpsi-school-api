import { Prop, Schema } from '@nestjs/mongoose';
import { Types } from 'mongoose';

/**
 * Shared schema options.
 *
 * `toJSON` maps `_id` → `id` and strips `__v` so controllers never leak Mongo
 * internals; `passwordHash` and `refreshTokens` are additionally removed in the
 * User schema's own transform.
 */
export const baseSchemaOptions = {
  timestamps: true,
  // `as const` keeps this literal `false` rather than widening to `boolean`,
  // which Mongoose's SchemaOptions type rejects.
  versionKey: false as const,
  toJSON: {
    virtuals: true,
    transform: (_doc: unknown, ret: Record<string, unknown>) => {
      ret.id = ret._id?.toString();
      delete ret._id;
      return ret;
    },
  },
  toObject: { virtuals: true },
};

/**
 * Base for master data that other collections reference.
 *
 * These are soft-deleted (`deletedAt`) rather than removed, because historical
 * records — a score from 2019 — still point at them and must stay resolvable.
 */
@Schema({ ...baseSchemaOptions })
export abstract class SoftDeletableDocument {
  @Prop({ type: Date, default: null, index: true })
  deletedAt?: Date | null;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  deletedBy?: Types.ObjectId | null;

  createdAt?: Date;
  updatedAt?: Date;
}

/** Matches documents that have not been soft-deleted. */
export const NOT_DELETED = { deletedAt: null } as const;

/** Collation that sorts Lao (and Thai) text by alphabet rather than code point. */
export const LAO_COLLATION = { locale: 'lo', strength: 2 } as const;
