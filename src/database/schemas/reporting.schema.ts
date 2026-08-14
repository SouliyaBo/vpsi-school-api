import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import {
  DOCUMENT_VISIBILITIES,
  DocumentVisibility,
  REPORT_STATUSES,
  REPORT_TYPES,
  ReportStatus,
  ReportType,
} from 'src/common/constants/enums';
import { baseSchemaOptions, SoftDeletableDocument } from './base.schema';
import { Attachment, AttachmentSchema } from './lesson-plan.schema';

// ── Report template ─────────────────────────────────────────────────────────

export type ReportTemplateDocument = HydratedDocument<ReportTemplate>;

@Schema({ collection: 'reportTemplates', ...baseSchemaOptions })
export class ReportTemplate extends SoftDeletableDocument {
  @Prop({ type: String, required: true, trim: true })
  code: string;

  @Prop({ type: String, required: true, trim: true })
  nameLo: string;

  @Prop({ type: String, default: null, trim: true })
  nameEn?: string | null;

  @Prop({ type: String, required: true, enum: REPORT_TYPES })
  type: ReportType;

  /**
   * Free-form layout definition consumed by the PDF renderer. Genuinely
   * schemaless — each report type has its own shape — so `Mixed` is correct here
   * rather than a sub-schema.
   */
  @Prop({ type: Object, required: true, default: {} })
  layout: Record<string, unknown>;

  @Prop({ type: String, default: 'lo' })
  locale: string;

  @Prop({ type: Boolean, default: true })
  isActive: boolean;

  @Prop({ type: Number, default: 1 })
  version: number;
}

export const ReportTemplateSchema = SchemaFactory.createForClass(ReportTemplate);
ReportTemplateSchema.index({ code: 1 }, { unique: true });
ReportTemplateSchema.index({ type: 1, isActive: 1 });

// ── Generated report ────────────────────────────────────────────────────────

export type GeneratedReportDocument = HydratedDocument<GeneratedReport>;

@Schema({ collection: 'generatedReports', ...baseSchemaOptions })
export class GeneratedReport extends SoftDeletableDocument {
  @Prop({ type: Types.ObjectId, ref: 'ReportTemplate', required: true, index: true })
  templateId: Types.ObjectId;

  @Prop({ type: String, required: true, enum: REPORT_TYPES })
  type: ReportType;

  /** Parameters the report was generated with (semesterId, classroomId, …). */
  @Prop({ type: Object, default: {} })
  params: Record<string, unknown>;

  /** Subject of the report, when it targets a single student. */
  @Prop({ type: Types.ObjectId, ref: 'Student', default: null, index: true })
  studentId?: Types.ObjectId | null;

  @Prop({ type: Types.ObjectId, ref: 'Classroom', default: null })
  classroomId?: Types.ObjectId | null;

  @Prop({ type: Types.ObjectId, ref: 'Semester', default: null })
  semesterId?: Types.ObjectId | null;

  @Prop({ type: String, required: true, enum: REPORT_STATUSES, default: 'queued' })
  status: ReportStatus;

  /** S3 key of the rendered PDF; set once `status` is `completed`. */
  @Prop({ type: String, default: null })
  fileKey?: string | null;

  @Prop({ type: Number, default: null })
  fileSizeBytes?: number | null;

  @Prop({ type: String, default: null })
  errorMessage?: string | null;

  @Prop({ type: String, default: null })
  jobId?: string | null;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  requestedBy: Types.ObjectId;

  @Prop({ type: Date, default: null })
  completedAt?: Date | null;
}

export const GeneratedReportSchema = SchemaFactory.createForClass(GeneratedReport);
GeneratedReportSchema.index({ requestedBy: 1, createdAt: -1 });
GeneratedReportSchema.index({ status: 1, createdAt: 1 });

// ── Document centre ─────────────────────────────────────────────────────────

export type SchoolDocumentDocument = HydratedDocument<SchoolDocument>;

@Schema({ collection: 'documents', ...baseSchemaOptions })
export class SchoolDocument extends SoftDeletableDocument {
  @Prop({ type: String, required: true, trim: true })
  title: string;

  @Prop({ type: String, default: null })
  description?: string | null;

  @Prop({ type: String, required: true, trim: true, index: true })
  category: string;

  @Prop({ type: [String], default: [] })
  tags: string[];

  @Prop({ type: AttachmentSchema, required: true })
  file: Attachment;

  @Prop({ type: String, required: true, enum: DOCUMENT_VISIBILITIES, default: 'staff' })
  visibility: DocumentVisibility;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  uploadedBy: Types.ObjectId;

  @Prop({ type: Number, default: 0 })
  downloadCount: number;
}

export const SchoolDocumentSchema = SchemaFactory.createForClass(SchoolDocument);
SchoolDocumentSchema.index({ category: 1, visibility: 1, createdAt: -1 });
SchoolDocumentSchema.index({ title: 'text', description: 'text' });
