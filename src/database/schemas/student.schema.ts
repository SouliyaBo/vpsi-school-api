import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import {
  GENDERS,
  GUARDIAN_RELATIONSHIPS,
  Gender,
  GuardianRelationship,
  STUDENT_STATUSES,
  StudentStatus,
} from 'src/common/constants/enums';
import { baseSchemaOptions, LAO_COLLATION, SoftDeletableDocument } from './base.schema';

/**
 * The student↔guardian relationship, embedded on the student side.
 *
 * `fullNameLo` and `phone` are denormalized copies of the guardian record so
 * student lists and report cards can show a contact without a `$lookup`.
 * GuardiansService.update() re-syncs them inside the same transaction that
 * writes the guardian.
 */
@Schema({ _id: false })
export class StudentGuardianLink {
  @Prop({ type: Types.ObjectId, ref: 'Guardian', required: true })
  guardianId: Types.ObjectId;

  @Prop({ type: String, required: true }) // denormalized from Guardian
  fullNameLo: string;

  @Prop({ type: String, required: true }) // denormalized from Guardian
  phone: string;

  @Prop({ type: String, required: true, enum: GUARDIAN_RELATIONSHIPS })
  relationship: GuardianRelationship;

  /** Exactly one link per student must be primary — enforced in StudentsService. */
  @Prop({ type: Boolean, default: false })
  isPrimary: boolean;

  @Prop({ type: Boolean, default: false })
  isEmergencyContact: boolean;

  /** Whether this guardian may view the student's academic records. */
  @Prop({ type: Boolean, default: true })
  canViewRecords: boolean;
}

export const StudentGuardianLinkSchema = SchemaFactory.createForClass(StudentGuardianLink);

export type StudentDocument = HydratedDocument<Student>;

@Schema({ collection: 'students', ...baseSchemaOptions })
export class Student extends SoftDeletableDocument {
  @Prop({ type: String, required: true, trim: true })
  studentCode: string;

  /**
   * Honorific as the office writes it — `ນ.`, `ທ້າວ`, `ນາງ`.
   *
   * Kept apart from `firstNameLo` because the register carries it on every name
   * and a title folded into the given name breaks both search and sorting.
   * Free text rather than an enum: the school abbreviates inconsistently, and
   * rejecting a spelling would only push it back into the name field.
   */
  @Prop({ type: String, default: null, trim: true })
  title?: string | null;

  @Prop({ type: String, required: true, trim: true })
  firstNameLo: string;

  @Prop({ type: String, required: true, trim: true })
  lastNameLo: string;

  @Prop({ type: String, default: null, trim: true })
  firstNameEn?: string | null;

  @Prop({ type: String, default: null, trim: true })
  lastNameEn?: string | null;

  /**
   * What the child is actually called. Teachers know a class by nickname long
   * before they know its register names, so this is searchable alongside them.
   */
  @Prop({ type: String, default: null, trim: true })
  nickname?: string | null;

  @Prop({ type: String, default: null, trim: true })
  nicknameEn?: string | null;

  @Prop({ type: String, required: true, enum: GENDERS })
  gender: Gender;

  @Prop({ type: Date, required: true })
  dateOfBirth: Date;

  @Prop({ type: String, default: null, trim: true })
  placeOfBirth?: string | null;

  @Prop({ type: String, default: null, trim: true })
  nationality?: string | null;

  @Prop({ type: String, default: null, trim: true })
  ethnicity?: string | null;

  @Prop({ type: String, default: null, trim: true })
  nationalId?: string | null;

  @Prop({ type: String, default: null, trim: true })
  phone?: string | null;

  /**
   * The number the office actually rings about this child.
   *
   * Not derivable from the guardian list: the register routinely names a nanny,
   * an aunt or an older sibling who is nobody's `Guardian` record, and copying
   * that number onto a parent would misattribute it.
   */
  @Prop({ type: String, default: null, trim: true })
  contactPhone?: string | null;

  /**
   * Who `contactPhone` reaches, when that is not obvious — the register writes
   * it inline as `9112 1155 (ເອື້ອຍລ້ຽງ)`. Kept as its own field so the number
   * still normalizes and stays searchable.
   */
  @Prop({ type: String, default: null, trim: true })
  contactName?: string | null;

  @Prop({ type: Types.ObjectId, ref: 'Location', default: null, index: true })
  villageId?: Types.ObjectId | null;

  @Prop({ type: String, default: null })
  addressDetail?: string | null;

  /** S3 object key. Signed on read; never stored as a URL. */
  @Prop({ type: String, default: null })
  photoKey?: string | null;

  @Prop({ type: [StudentGuardianLinkSchema], default: [] })
  guardians: StudentGuardianLink[];

  @Prop({ type: Date, default: null })
  admissionDate?: Date | null;

  @Prop({ type: String, required: true, enum: STUDENT_STATUSES, default: 'active' })
  status: StudentStatus;

  @Prop({ type: String, default: null })
  notes?: string | null;
}

export const StudentSchema = SchemaFactory.createForClass(Student);

StudentSchema.virtual('fullNameLo').get(function (this: Student) {
  return `${this.firstNameLo} ${this.lastNameLo}`;
});

StudentSchema.index({ studentCode: 1 }, { unique: true });
StudentSchema.index({ villageId: 1, status: 1 });
StudentSchema.index({ 'guardians.guardianId': 1 });
StudentSchema.index({ status: 1, lastNameLo: 1 }, { collation: LAO_COLLATION });
// Text index for name search. MongoDB has no Lao-specific text analyzer, so this
// behaves as whitespace tokenization — adequate for the "type part of a name" case.
StudentSchema.index({ firstNameLo: 'text', lastNameLo: 'text', studentCode: 'text' });
