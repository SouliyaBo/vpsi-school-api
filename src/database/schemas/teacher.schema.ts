import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, SchemaTypes, Types } from 'mongoose';
import {
  GENDERS,
  Gender,
  HOUSING_TYPES,
  HousingType,
  MARITAL_STATUSES,
  MaritalStatus,
  TEACHER_STATUSES,
  TeacherStatus,
} from 'src/common/constants/enums';
import { baseSchemaOptions, LAO_COLLATION, SoftDeletableDocument } from './base.schema';

/**
 * Where a teacher was born, as the three administrative levels Laos uses.
 *
 * Plain strings rather than `Location` references: a staff of seventeen is born
 * across half the provinces in the country, and resolving each birthplace would
 * seed hundreds of villages into the location tree that nothing else ever
 * points at. The tree exists to place people who live here now — that is
 * `villageId`, which stays a reference.
 */
@Schema({ _id: false })
export class PlaceOfBirth {
  @Prop({ type: String, default: null, trim: true })
  village?: string | null;

  @Prop({ type: String, default: null, trim: true })
  district?: string | null;

  @Prop({ type: String, default: null, trim: true })
  province?: string | null;
}

export const PlaceOfBirthSchema = SchemaFactory.createForClass(PlaceOfBirth);

/** Where a teacher trained, kept apart from `qualification` (the degree itself). */
@Schema({ _id: false })
export class TeacherEducation {
  /** `ມ.ຊ`, `ວິທະຍາໄລຄູດົງຄຳຊ້າງ` — the institution, as the register writes it. */
  @Prop({ type: String, default: null, trim: true })
  institution?: string | null;

  /**
   * The academic year they finished, written `2016-2017`.
   *
   * A string, not a number: the register records the span rather than a single
   * year, and a Lao academic year straddles two calendar ones.
   */
  @Prop({ type: String, default: null, trim: true })
  graduatedYear?: string | null;
}

export const TeacherEducationSchema = SchemaFactory.createForClass(TeacherEducation);

/**
 * A teacher's father or mother, as recorded on the staff form.
 *
 * Deliberately *not* a `Guardian` reference. A guardian is a person the school
 * contacts about a child and grants record access to; a teacher's parent is
 * neither, and linking the two collections would put staff family members into
 * the guardian directory the office rings.
 */
@Schema({ _id: false })
export class TeacherParent {
  @Prop({ type: String, default: null, trim: true })
  fullNameLo?: string | null;

  @Prop({ type: String, default: null, trim: true })
  address?: string | null;

  @Prop({ type: String, default: null, trim: true })
  occupation?: string | null;
}

export const TeacherParentSchema = SchemaFactory.createForClass(TeacherParent);

export type TeacherDocument = HydratedDocument<Teacher>;

@Schema({ collection: 'teachers', ...baseSchemaOptions })
export class Teacher extends SoftDeletableDocument {
  @Prop({ type: String, required: true, trim: true })
  teacherCode: string;

  /**
   * Honorific as the office writes it — `ນ.`, `ທ.`, `ທ້າວ`.
   *
   * Held apart from `firstNameLo` for the same reason it is on `Student`: folded
   * into the given name it breaks sorting, and every woman on staff files under
   * `ນ`. Free text, because the school abbreviates inconsistently.
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

  @Prop({ type: String, required: true, enum: GENDERS })
  gender: Gender;

  @Prop({ type: Date, default: null })
  dateOfBirth?: Date | null;

  @Prop({ type: String, default: null, trim: true })
  ethnicity?: string | null;

  @Prop({ type: PlaceOfBirthSchema, default: () => ({}) })
  placeOfBirth?: PlaceOfBirth;

  @Prop({ type: String, default: null, trim: true })
  nationalId?: string | null;

  @Prop({ type: String, default: null, trim: true })
  phone?: string | null;

  @Prop({ type: String, default: null, trim: true, lowercase: true })
  email?: string | null;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'Location', default: null })
  villageId?: Types.ObjectId | null;

  @Prop({ type: String, default: null })
  addressDetail?: string | null;

  /** S3 object key, not a URL — the public/signed URL is derived at read time. */
  @Prop({ type: String, default: null })
  photoKey?: string | null;

  @Prop({ type: String, default: null, trim: true })
  qualification?: string | null;

  @Prop({ type: String, default: null, trim: true })
  specialization?: string | null;

  @Prop({ type: TeacherEducationSchema, default: () => ({}) })
  education?: TeacherEducation;

  /**
   * The subjects they actually stand in front of a class and teach.
   *
   * An array of names rather than `Subject` references: the register writes
   * `ເຄມີສາດ/ຊີວະສາດ/ທຳມະຊາດ`, and only some of those are `Subject` rows for
   * some grade levels. What a teacher is *timetabled* for is already a hard link
   * — `TeachingAssignment.subjectId` — so this stays the human answer to "what
   * do you teach", used for staffing decisions before a timetable exists.
   */
  @Prop({ type: [String], default: [] })
  teachingSubjects: string[];

  /** `ລະດັບວິຊາສະເພາະ` — the ministry's professional grade, e.g. `P`. */
  @Prop({ type: String, default: null, trim: true })
  professionalLevel?: string | null;

  /** When they joined this school's payroll. */
  @Prop({ type: Date, default: null })
  hireDate?: Date | null;

  /** `ວັນເຂົ້າອົງການ` — entry into public service, which predates being hired here. */
  @Prop({ type: Date, default: null })
  joinedOrgDate?: Date | null;

  @Prop({ type: String, default: null, enum: [...MARITAL_STATUSES, null] })
  maritalStatus?: MaritalStatus | null;

  @Prop({ type: Number, default: null, min: 0 })
  childrenCount?: number | null;

  @Prop({ type: String, default: null, enum: [...HOUSING_TYPES, null] })
  housingType?: HousingType | null;

  /** `ຢູ່ກັບໃຜແດ່` — free text; the register answers it in prose. */
  @Prop({ type: String, default: null, trim: true })
  livingWith?: string | null;

  /** `ຊື່ ເອື້ອຍ/ອ້າຍ/ນ້ອງ` — siblings and where they live, as one written answer. */
  @Prop({ type: String, default: null, trim: true })
  siblings?: string | null;

  @Prop({ type: TeacherParentSchema, default: () => ({}) })
  father?: TeacherParent;

  @Prop({ type: TeacherParentSchema, default: () => ({}) })
  mother?: TeacherParent;

  @Prop({ type: String, required: true, enum: TEACHER_STATUSES, default: 'active' })
  status: TeacherStatus;

  /** Head of an academic department — gates lesson-plan approval. */
  @Prop({ type: Boolean, default: false })
  isAcademicHead: boolean;

  /**
   * The department they belong to.
   *
   * Distinct from `teachingSubjects`, which is prose, and from
   * `SubjectGroup.headTeacherId`, which points the other way: this says which
   * group's roster a teacher appears on, not which group they run. It is what
   * the lesson-plan compliance matrix groups rows by for a teacher who has no
   * timetable yet.
   */
  @Prop({ type: SchemaTypes.ObjectId, ref: 'SubjectGroup', default: null, index: true })
  subjectGroupId?: Types.ObjectId | null;

  get fullNameLo(): string {
    return `${this.firstNameLo} ${this.lastNameLo}`;
  }
}

export const TeacherSchema = SchemaFactory.createForClass(Teacher);

TeacherSchema.virtual('fullNameLo').get(function (this: Teacher) {
  return `${this.firstNameLo} ${this.lastNameLo}`;
});

TeacherSchema.index({ teacherCode: 1 }, { unique: true });
TeacherSchema.index({ status: 1, lastNameLo: 1 }, { collation: LAO_COLLATION });
TeacherSchema.index({ villageId: 1 });
TeacherSchema.index({ firstNameLo: 'text', lastNameLo: 'text', teacherCode: 'text' });
