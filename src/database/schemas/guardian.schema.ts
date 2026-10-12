import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, SchemaTypes, Types } from 'mongoose';
import { GENDERS, Gender } from 'src/common/constants/enums';
import { baseSchemaOptions, LAO_COLLATION, SoftDeletableDocument } from './base.schema';

export type GuardianDocument = HydratedDocument<Guardian>;

/**
 * Full guardian record. A short projection of this ({ fullName, phone }) is also
 * embedded in `students.guardians[]` for list rendering — GuardiansService.update()
 * is the single place that keeps the two in sync. See docs/schema-design.md §3.1.
 */
@Schema({ collection: 'guardians', ...baseSchemaOptions })
export class Guardian extends SoftDeletableDocument {
  @Prop({ type: String, required: true, trim: true })
  firstNameLo: string;

  @Prop({ type: String, required: true, trim: true })
  lastNameLo: string;

  @Prop({ type: String, default: null, enum: [...GENDERS, null] })
  gender?: Gender | null;

  @Prop({ type: Date, default: null })
  dateOfBirth?: Date | null;

  @Prop({ type: String, default: null, trim: true })
  nationalId?: string | null;

  @Prop({ type: String, required: true, trim: true })
  phone: string;

  @Prop({ type: String, default: null, trim: true })
  alternatePhone?: string | null;

  @Prop({ type: String, default: null, trim: true, lowercase: true })
  email?: string | null;

  @Prop({ type: String, default: null, trim: true })
  occupation?: string | null;

  @Prop({ type: String, default: null, trim: true })
  workplace?: string | null;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'Location', default: null })
  villageId?: Types.ObjectId | null;

  @Prop({ type: String, default: null })
  addressDetail?: string | null;
}

export const GuardianSchema = SchemaFactory.createForClass(Guardian);

GuardianSchema.virtual('fullNameLo').get(function (this: Guardian) {
  return `${this.firstNameLo} ${this.lastNameLo}`;
});

GuardianSchema.index(
  { nationalId: 1 },
  { unique: true, partialFilterExpression: { nationalId: { $type: 'string' } } },
);
GuardianSchema.index({ phone: 1 });
GuardianSchema.index({ villageId: 1 });
GuardianSchema.index({ lastNameLo: 1, firstNameLo: 1 }, { collation: LAO_COLLATION });
GuardianSchema.index({ firstNameLo: 'text', lastNameLo: 'text', phone: 'text' });
