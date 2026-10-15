import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, SchemaTypes, Types } from 'mongoose';
import {
  GENDERS,
  GUARDIAN_RELATIONSHIPS,
  Gender,
  GuardianRelationship,
  STUDENT_ORGANIZATIONS,
  STUDENT_STATUSES,
  StudentOrganization,
  StudentStatus,
  TITLE_BY_GENDER,
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
  @Prop({ type: SchemaTypes.ObjectId, ref: 'Guardian', required: true })
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

/**
 * One mass-organisation membership — `ເຍົາວະຊົນ`, `ເຂົ້າຊາວໜຸ່ມ`,
 * `ເຂົ້າແມ່ຍິງ`.
 *
 * Only the fact and the date, which is what the school's own tally needs. Card
 * numbers, units and positions are held by the organisation itself rather than
 * the school office, so recording them here would mean maintaining a second
 * copy of a register nobody here writes.
 */
@Schema({ _id: false })
export class StudentOrganizationMembership {
  @Prop({ type: String, required: true, enum: STUDENT_ORGANIZATIONS })
  organization: StudentOrganization;

  /**
   * `ວັນເຂົ້າ`. Required: a membership with no date cannot be counted into a
   * school year, which is the only way the figure is ever asked for.
   */
  @Prop({ type: Date, required: true })
  joinedDate: Date;
}

export const StudentOrganizationMembershipSchema = SchemaFactory.createForClass(
  StudentOrganizationMembership,
);

export type StudentDocument = HydratedDocument<Student>;

@Schema({ collection: 'students', ...baseSchemaOptions })
export class Student extends SoftDeletableDocument {
  @Prop({ type: String, required: true, trim: true })
  studentCode: string;

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

  /**
   * Where the child was born, held exactly like the current address: a link into
   * the official tree plus whatever the register wrote that the tree cannot hold.
   *
   * Unlike `villageId` this may point at a province or a district rather than a
   * village. The official list carries villages for Vientiane Capital only, so a
   * child born in Savannakhet can be placed no finer than its district — and a
   * district on file beats a district buried in free text.
   */
  @Prop({ type: SchemaTypes.ObjectId, ref: 'Location', default: null, index: true })
  birthLocationId?: Types.ObjectId | null;

  /** The part of the birthplace the tree has no node for — usually the village. */
  @Prop({ type: String, default: null, trim: true })
  birthAddressDetail?: string | null;

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

  @Prop({ type: SchemaTypes.ObjectId, ref: 'Location', default: null, index: true })
  villageId?: Types.ObjectId | null;

  @Prop({ type: String, default: null })
  addressDetail?: string | null;

  /** S3 object key. Signed on read; never stored as a URL. */
  @Prop({ type: String, default: null })
  photoKey?: string | null;

  @Prop({ type: [StudentGuardianLinkSchema], default: [] })
  guardians: StudentGuardianLink[];

  /** At most one entry per organisation — enforced in StudentsService. */
  @Prop({ type: [StudentOrganizationMembershipSchema], default: [] })
  organizations: StudentOrganizationMembership[];

  @Prop({ type: Date, default: null })
  admissionDate?: Date | null;

  @Prop({ type: String, required: true, enum: STUDENT_STATUSES, default: 'active' })
  status: StudentStatus;

  /**
   * ວັນທີໂຈະການຮຽນ — when a `suspended` child stopped. The date places the
   * suspension in a school year, which is what the district report counts by;
   * cleared whenever the status moves off `suspended`.
   */
  @Prop({ type: Date, default: null })
  suspendedAt?: Date | null;

  /**
   * The status a `suspended` child was suspended from. A child who had already
   * declined the certificate (`no_certificate`) and then stopped coming is not
   * reported to the district as a suspension — the office's rule, 15 Oct 2026.
   * Set by the service on the change, never posted; cleared with `suspendedAt`.
   */
  @Prop({ type: String, default: null })
  statusBeforeSuspension?: StudentStatus | null;

  @Prop({ type: String, default: null })
  notes?: string | null;
}

export const StudentSchema = SchemaFactory.createForClass(Student);

StudentSchema.virtual('fullNameLo').get(function (this: Student) {
  return `${this.firstNameLo} ${this.lastNameLo}`;
});

/**
 * `ນາງ` or `ທ້າວ`, read off the gender rather than stored.
 *
 * Still kept out of `firstNameLo`: a honorific folded into the given name
 * breaks both search and sorting, which is why the importer strips it.
 */
StudentSchema.virtual('title').get(function (this: Student) {
  return TITLE_BY_GENDER[this.gender];
});

StudentSchema.index({ studentCode: 1 }, { unique: true });
StudentSchema.index({ villageId: 1, status: 1 });
StudentSchema.index({ 'guardians.guardianId': 1 });
// Counts members per organisation without touching the documents themselves.
StudentSchema.index({ 'organizations.organization': 1, 'organizations.joinedDate': 1 });
StudentSchema.index({ status: 1, lastNameLo: 1 }, { collation: LAO_COLLATION });
// Text index for name search. MongoDB has no Lao-specific text analyzer, so this
// behaves as whitespace tokenization — adequate for the "type part of a name" case.
StudentSchema.index({ firstNameLo: 'text', lastNameLo: 'text', studentCode: 'text' });
