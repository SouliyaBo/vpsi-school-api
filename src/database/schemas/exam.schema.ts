import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import {
  CERTIFICATE_TYPES,
  CertificateType,
  EXAM_LEVELS,
  EXAM_REGISTRATION_STATUSES,
  ExamLevel,
  ExamRegistrationStatus,
} from 'src/common/constants/enums';
import { baseSchemaOptions, SoftDeletableDocument } from './base.schema';

// ── Exam registration ───────────────────────────────────────────────────────

export type ExamRegistrationDocument = HydratedDocument<ExamRegistration>;

@Schema({ collection: 'examRegistrations', ...baseSchemaOptions })
export class ExamRegistration extends SoftDeletableDocument {
  @Prop({ type: Types.ObjectId, ref: 'Student', required: true, index: true })
  studentId: Types.ObjectId;

  @Prop({ type: String, required: true }) // denormalized from Student
  studentCode: string;

  @Prop({ type: String, required: true }) // denormalized from Student
  studentNameLo: string;

  @Prop({ type: String, required: true, enum: EXAM_LEVELS, index: true })
  level: ExamLevel;

  @Prop({ type: Types.ObjectId, ref: 'SchoolYear', required: true, index: true })
  schoolYearId: Types.ObjectId;

  /** Seat number issued by the exam authority after approval. */
  @Prop({ type: String, default: null, trim: true })
  examNumber?: string | null;

  @Prop({ type: String, default: null, trim: true })
  examCenter?: string | null;

  @Prop({ type: Date, default: null })
  examDate?: Date | null;

  @Prop({ type: String, required: true, enum: EXAM_REGISTRATION_STATUSES, default: 'pending' })
  status: ExamRegistrationStatus;

  /**
   * Snapshot of the eligibility check at registration time — attendance rate,
   * failed subjects, outstanding fees. Kept so a later rule change cannot
   * retroactively invalidate an approved registration.
   */
  @Prop({ type: Object, default: {} })
  eligibilitySnapshot: Record<string, unknown>;

  @Prop({ type: String, default: null })
  rejectionReason?: string | null;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  approvedBy?: Types.ObjectId | null;

  @Prop({ type: Date, default: null })
  approvedAt?: Date | null;
}

export const ExamRegistrationSchema = SchemaFactory.createForClass(ExamRegistration);
ExamRegistrationSchema.index(
  { studentId: 1, level: 1, schoolYearId: 1 },
  { unique: true, partialFilterExpression: { deletedAt: null } },
);
ExamRegistrationSchema.index({ schoolYearId: 1, level: 1, status: 1 });
ExamRegistrationSchema.index(
  { examNumber: 1 },
  { unique: true, partialFilterExpression: { examNumber: { $type: 'string' } } },
);

// ── Exam result ─────────────────────────────────────────────────────────────

/** One subject's mark in the national exam. */
@Schema({ _id: false })
export class ExamSubjectScore {
  @Prop({ type: Types.ObjectId, ref: 'Subject', default: null })
  subjectId?: Types.ObjectId | null;

  @Prop({ type: String, required: true })
  subjectNameLo: string;

  @Prop({ type: Number, required: true, min: 0 })
  score: number;

  @Prop({ type: Number, required: true, min: 0 })
  maxScore: number;

  @Prop({ type: Boolean, required: true })
  isPassed: boolean;
}

export const ExamSubjectScoreSchema = SchemaFactory.createForClass(ExamSubjectScore);

export type ExamResultDocument = HydratedDocument<ExamResult>;

@Schema({ collection: 'examResults', ...baseSchemaOptions })
export class ExamResult extends SoftDeletableDocument {
  // Indexed below as a unique index; declaring it here too would create a duplicate.
  @Prop({ type: Types.ObjectId, ref: 'ExamRegistration', required: true })
  registrationId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Student', required: true, index: true })
  studentId: Types.ObjectId;

  @Prop({ type: String, required: true, enum: EXAM_LEVELS })
  level: ExamLevel;

  @Prop({ type: Types.ObjectId, ref: 'SchoolYear', required: true })
  schoolYearId: Types.ObjectId;

  /** Bounded (~5–8 exam subjects) and always read together with the result. */
  @Prop({ type: [ExamSubjectScoreSchema], default: [] })
  subjects: ExamSubjectScore[];

  @Prop({ type: Number, required: true, default: 0 })
  totalScore: number;

  @Prop({ type: Number, required: true, default: 0 })
  maxTotalScore: number;

  @Prop({ type: Number, required: true, default: 0 })
  percentage: number;

  @Prop({ type: Boolean, required: true, default: false })
  isPassed: boolean;

  @Prop({ type: String, default: null, trim: true })
  resultGrade?: string | null;

  @Prop({ type: Number, default: null })
  nationalRank?: number | null;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  recordedBy: Types.ObjectId;

  @Prop({ type: Boolean, default: false })
  isPublished: boolean;
}

export const ExamResultSchema = SchemaFactory.createForClass(ExamResult);
ExamResultSchema.index(
  { registrationId: 1 },
  { unique: true, partialFilterExpression: { deletedAt: null } },
);
ExamResultSchema.index({ schoolYearId: 1, level: 1, isPassed: 1 });

// ── Certificate ─────────────────────────────────────────────────────────────

/**
 * The written details of a `study_verification` letter.
 *
 * Held on the certificate rather than pushed back onto the student, because most
 * of it is not student data the school otherwise keeps: the register records no
 * birthplace at all, and the study period is a statement about this letter's
 * claim, not a fact about the pupil. Keeping the copy here also means a reissue
 * or a re-render reproduces the letter that was actually handed over, which is
 * the whole point of a document series that outsiders verify.
 */
@Schema({ _id: false })
export class StudyVerificationDetails {
  /** `ບ່ອນເກີດ` — one address line, already formatted. */
  @Prop({ type: String, default: null, trim: true })
  birthPlaceLo?: string | null;

  @Prop({ type: String, default: null, trim: true })
  fatherNameLo?: string | null;

  @Prop({ type: String, default: null, trim: true })
  motherNameLo?: string | null;

  /** `ປັດຈຸບັນຢູ່` — the pupil's address on the day the letter was written. */
  @Prop({ type: String, default: null, trim: true })
  currentAddressLo?: string | null;

  /** First school year of the attendance the letter attests to, e.g. `2022-2023`. */
  @Prop({ type: String, default: null, trim: true })
  studyFromYearCode?: string | null;

  @Prop({ type: String, default: null, trim: true })
  studyToYearCode?: string | null;

  /** The class as the letter writes it — `ມ.4`, not the classroom's full name. */
  @Prop({ type: String, default: null, trim: true })
  classLabelLo?: string | null;

  /** Denormalized: the register code may be corrected after the letter is out. */
  @Prop({ type: String, default: null, trim: true })
  studentCode?: string | null;
}

export const StudyVerificationDetailsSchema =
  SchemaFactory.createForClass(StudyVerificationDetails);

export type CertificateDocument = HydratedDocument<Certificate>;

@Schema({ collection: 'certificates', ...baseSchemaOptions })
export class Certificate extends SoftDeletableDocument {
  /** Gap-free serial issued by CertificatesService; unique across all years. */
  @Prop({ type: String, required: true, trim: true })
  certificateNumber: string;

  @Prop({ type: Types.ObjectId, ref: 'Student', required: true, index: true })
  studentId: Types.ObjectId;

  @Prop({ type: String, required: true }) // denormalized from Student
  studentNameLo: string;

  @Prop({ type: String, required: true, enum: CERTIFICATE_TYPES })
  type: CertificateType;

  @Prop({ type: Types.ObjectId, ref: 'SchoolYear', required: true, index: true })
  schoolYearId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'GradeLevel', default: null })
  gradeLevelId?: Types.ObjectId | null;

  @Prop({ type: String, default: null })
  titleLo?: string | null;

  @Prop({ type: String, default: null })
  descriptionLo?: string | null;

  /** Set only for `study_verification`; null for the award types. */
  @Prop({ type: StudyVerificationDetailsSchema, default: null })
  studyDetails?: StudyVerificationDetails | null;

  @Prop({ type: Date, required: true })
  issuedDate: Date;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  issuedBy: Types.ObjectId;

  /** S3 key of the rendered certificate PDF. */
  @Prop({ type: String, default: null })
  fileKey?: string | null;

  @Prop({ type: Boolean, default: false })
  isRevoked: boolean;

  @Prop({ type: String, default: null })
  revocationReason?: string | null;
}

export const CertificateSchema = SchemaFactory.createForClass(Certificate);
CertificateSchema.index({ certificateNumber: 1 }, { unique: true });
CertificateSchema.index({ studentId: 1, type: 1 });
CertificateSchema.index({ schoolYearId: 1, type: 1 });
