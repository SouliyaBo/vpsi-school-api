import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { ReportType } from 'src/common/constants/enums';
import { PaginatedResponse } from 'src/common/dto/pagination.dto';
import { AppException } from 'src/common/exceptions/app.exception';
import type { AuthenticatedUser } from 'src/common/interfaces/authenticated-user.interface';
import { CrudContext } from 'src/common/services/base-crud.service';
import { toApiDocuments } from 'src/common/utils/serialize';
import {
  GeneratedReport,
  GeneratedReportDocument,
  ReportTemplate,
  ReportTemplateDocument,
} from 'src/database/schemas';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ReportTemplatesService } from './report-templates.service';
import { StorageService } from '../storage/storage.service';
import { QueryGeneratedReportsDto } from './dto/report.dto';
import { ReportLayout } from './pdf/layout.types';
import { PdfRendererService } from './pdf/pdf-renderer.service';
import { ReportDataService } from './report-data.service';

@Injectable()
export class ReportsService {
  private readonly logger = new Logger(ReportsService.name);

  constructor(
    @InjectModel(GeneratedReport.name)
    private readonly model: Model<GeneratedReportDocument>,
    @InjectModel(ReportTemplate.name)
    private readonly templateModel: Model<ReportTemplateDocument>,
    private readonly templates: ReportTemplatesService,
    private readonly reportData: ReportDataService,
    private readonly renderer: PdfRendererService,
    private readonly storage: StorageService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditLogsService,
  ) {}

  async findAll(
    query: QueryGeneratedReportsDto,
  ): Promise<PaginatedResponse<GeneratedReportDocument>> {
    const filter: Record<string, unknown> = { deletedAt: null };
    if (query.type) filter.type = query.type;
    if (query.status) filter.status = query.status;
    if (query.studentId) filter.studentId = new Types.ObjectId(query.studentId);
    if (query.classroomId) filter.classroomId = new Types.ObjectId(query.classroomId);
    if (query.semesterId) filter.semesterId = new Types.ObjectId(query.semesterId);

    const [data, total] = await Promise.all([
      this.model
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(query.skip)
        .limit(query.limit)
        .lean()
        .exec(),
      this.model.countDocuments(filter).exec(),
    ]);

    return new PaginatedResponse(
      toApiDocuments(data as { _id?: unknown }[]) as unknown as GeneratedReportDocument[],
      total,
      query.page,
      query.limit,
    );
  }

  async findOne(id: string): Promise<GeneratedReportDocument> {
    if (!Types.ObjectId.isValid(id)) throw AppException.notFound();
    const report = await this.model.findOne({ _id: id, deletedAt: null }).exec();
    if (!report) throw AppException.notFound();
    return report;
  }

  /**
   * Creates the tracking row for a report that is about to be rendered.
   *
   * The row exists before the job runs so the caller has something to poll, and
   * so a crashed worker leaves visible evidence (`status: 'queued'`) rather than
   * silence.
   */
  async createPending(input: {
    type: ReportType;
    templateId: Types.ObjectId;
    params: Record<string, unknown>;
    studentId?: string | null;
    classroomId?: string | null;
    semesterId?: string | null;
    requestedBy: string;
  }): Promise<GeneratedReportDocument> {
    return this.model.create({
      templateId: input.templateId,
      type: input.type,
      params: input.params,
      studentId: input.studentId ? new Types.ObjectId(input.studentId) : null,
      classroomId: input.classroomId ? new Types.ObjectId(input.classroomId) : null,
      semesterId: input.semesterId ? new Types.ObjectId(input.semesterId) : null,
      status: 'queued',
      requestedBy: new Types.ObjectId(input.requestedBy),
    });
  }

  /**
   * Renders a queued report and stores the PDF.
   *
   * Called by the queue processor. Records the failure on the document before
   * rethrowing, so a permanently failing report is diagnosable from the API
   * instead of only from worker logs.
   */
  async renderQueuedReport(reportId: string): Promise<{ fileKey: string; sizeBytes: number }> {
    const report = await this.findOne(reportId);

    await this.model.updateOne({ _id: report._id }, { $set: { status: 'processing' } }).exec();

    try {
      const template = await this.templateModel.findById(report.templateId).lean().exec();
      if (!template) {
        throw AppException.badRequest('common.notFound', { field: 'templateId' });
      }

      const layout = template.layout as unknown as ReportLayout;
      if (!Array.isArray(layout?.sections)) {
        throw AppException.unprocessable('common.validationFailed', {
          reason: 'template layout has no `sections` array',
          templateCode: template.code,
        });
      }

      const data =
        report.type === 'certificate'
          ? await this.reportData.buildCertificate(report.studentId!.toString(), {
              certificateNumber: String(report.params.certificateNumber ?? '—'),
              issuedDate: new Date(),
              titleLo: (report.params.titleLo as string) ?? null,
              schoolYearId: (report.params.schoolYearId as string) ?? null,
              gradeLevelId: (report.params.gradeLevelId as string) ?? null,
              semesterId: report.semesterId?.toString() ?? null,
            })
          : await this.reportData.buildReportCard(
              report.studentId!.toString(),
              report.semesterId!.toString(),
            );

      const pdf = await this.renderer.render(layout, data);

      const fileKey = `reports/${report.type}/${report._id.toString()}.pdf`;
      await this.storage.putBuffer(fileKey, pdf, 'application/pdf');

      await this.model
        .updateOne(
          { _id: report._id },
          {
            $set: {
              status: 'completed',
              fileKey,
              fileSizeBytes: pdf.length,
              completedAt: new Date(),
              errorMessage: null,
            },
          },
        )
        .exec();

      await this.notifyRequester(report, 'ready');

      this.logger.log(`Rendered report ${report._id.toString()} (${pdf.length} bytes)`);
      return { fileKey, sizeBytes: pdf.length };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.model
        .updateOne(
          { _id: report._id },
          { $set: { status: 'failed', errorMessage: message.slice(0, 1000) } },
        )
        .exec();

      await this.notifyRequester(report, 'failed');
      // Rethrow so BullMQ applies its retry policy.
      throw error;
    }
  }

  /**
   * A signed download URL.
   *
   * Only the requester and holders of `reports:export` may download — a report
   * card is personal data, and the id is guessable enough not to be a secret.
   */
  async getDownloadUrl(
    id: string,
    actor: AuthenticatedUser,
  ): Promise<{ url: string; expiresInSeconds: number }> {
    const report = await this.findOne(id);

    if (report.status !== 'completed' || !report.fileKey) {
      throw AppException.conflict('common.validationFailed', {
        reason: `report is ${report.status}, not completed`,
      });
    }

    const isRequester = report.requestedBy.toString() === actor.sub;
    const canExport = actor.permissions.some(
      (p) =>
        p.resource === 'reports' && (p.actions.includes('export') || p.actions.includes('manage')),
    );

    // A student or guardian may fetch their own report card even without the
    // export grant, subject to the same link rules used elsewhere.
    const isOwnRecord =
      report.studentId !== null &&
      report.studentId !== undefined &&
      ((actor.personType === 'student' && actor.personId === report.studentId.toString()) ||
        (actor.personType === 'guardian' &&
          (await this.isLinkedGuardian(actor.personId, report.studentId.toString()))));

    if (!isRequester && !canExport && !isOwnRecord) {
      throw AppException.forbidden();
    }

    const url = await this.storage.getSignedUrl(report.fileKey);
    if (!url) throw AppException.notFound();

    await this.audit.record({
      action: 'export',
      entityType: 'generatedReports',
      entityId: report._id,
      userId: actor.sub,
      username: actor.username,
      newValue: { type: report.type, fileKey: report.fileKey },
    });

    return { url, expiresInSeconds: 900 };
  }

  async remove(id: string, context: CrudContext): Promise<void> {
    const report = await this.findOne(id);

    // Remove the stored object too — an orphaned PDF of a student's marks is a
    // data-retention problem, not just wasted space.
    if (report.fileKey) {
      await this.storage.delete(report.fileKey).catch((error) => {
        this.logger.warn(`Could not delete ${report.fileKey}: ${String(error)}`);
      });
    }

    report.deletedAt = new Date();
    report.deletedBy = context.actor?.sub ? new Types.ObjectId(context.actor.sub) : null;
    await report.save();

    await this.audit.record({
      action: 'delete',
      entityType: 'generatedReports',
      entityId: report._id,
      userId: context.actor?.sub,
      username: context.actor?.username,
      oldValue: { type: report.type, fileKey: report.fileKey },
      ip: context.ip,
    });
  }

  /**
   * Resolves the template to use, falling back to the active one for the type.
   * Delegates so certificates and reports agree on what "current" means.
   */
  resolveTemplate(type: ReportType, templateId?: string): Promise<ReportTemplateDocument> {
    return this.templates.findActiveForType(type, templateId);
  }

  private async isLinkedGuardian(
    guardianPersonId: string | null,
    studentId: string,
  ): Promise<boolean> {
    if (!guardianPersonId) return false;
    const guardianUserIds = await this.notifications.findGuardianUserIdsForStudent(studentId);
    // findGuardianUserIdsForStudent returns *user* ids; resolve this guardian's
    // account and check membership.
    const own = await this.notifications.findUserIdForPerson('guardian', guardianPersonId);
    return own !== null && guardianUserIds.some((id) => id.equals(own));
  }

  private async notifyRequester(
    report: GeneratedReportDocument,
    outcome: 'ready' | 'failed',
  ): Promise<void> {
    await this.notifications.notify({
      userId: report.requestedBy,
      type: 'report_ready',
      titleLo: outcome === 'ready' ? 'ລາຍງານພ້ອມແລ້ວ' : 'ສ້າງລາຍງານບໍ່ສຳເລັດ',
      titleEn: outcome === 'ready' ? 'Report ready' : 'Report generation failed',
      bodyLo:
        outcome === 'ready'
          ? 'ລາຍງານທີ່ທ່ານຮ້ອງຂໍສ້າງສຳເລັດແລ້ວ ສາມາດດາວໂຫຼດໄດ້'
          : 'ການສ້າງລາຍງານລົ້ມເຫລວ ກະລຸນາລອງໃໝ່ ຫຼື ຕິດຕໍ່ຜູ້ດູແລລະບົບ',
      bodyEn:
        outcome === 'ready'
          ? 'The report you requested is ready to download.'
          : 'Report generation failed. Please retry or contact an administrator.',
      data: { entityType: 'generatedReports', entityId: report._id.toString(), outcome },
    });
  }
}
