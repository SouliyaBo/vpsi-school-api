import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import { PaginatedResponse } from 'src/common/dto/pagination.dto';
import { AppException } from 'src/common/exceptions/app.exception';
import type { AuthenticatedUser } from 'src/common/interfaces/authenticated-user.interface';
import { toApiDocuments } from 'src/common/utils/serialize';
import {
  Certificate,
  CertificateDocument,
  Student,
  StudentDocument,
  StudyVerificationDetails,
} from 'src/database/schemas';
import { TransactionHelper } from 'src/database/transaction.helper';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ReportDataService } from '../reports/report-data.service';
import { PdfRendererService } from '../reports/pdf/pdf-renderer.service';
import { ReportLayout } from '../reports/pdf/layout.types';
import { ReportTemplatesService } from '../reports/report-templates.service';
import { StudyCertificateRenderer } from '../reports/pdf/study-certificate.renderer';
import { SettingsService } from '../settings/settings.service';
import {
  StudyCertificateDataService,
  StudyCertificatePrefill,
} from './study-certificate-data.service';
import { SchoolYearsService } from '../school-years/school-years.service';
import { StorageService } from '../storage/storage.service';
import {
  IssueCertificateDto,
  IssueStudyCertificateDto,
  QueryCertificatesDto,
  RevokeCertificateDto,
} from './dto/certificate.dto';

@Injectable()
export class CertificatesService {
  private readonly logger = new Logger(CertificatesService.name);

  constructor(
    @InjectModel(Certificate.name) private readonly model: Model<CertificateDocument>,
    @InjectModel(Student.name) private readonly studentModel: Model<StudentDocument>,
    private readonly templates: ReportTemplatesService,
    private readonly reportData: ReportDataService,
    private readonly renderer: PdfRendererService,
    private readonly studyRenderer: StudyCertificateRenderer,
    private readonly studyData: StudyCertificateDataService,
    private readonly settings: SettingsService,
    private readonly storage: StorageService,
    private readonly schoolYears: SchoolYearsService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditLogsService,
    private readonly tx: TransactionHelper,
  ) {}

  async findAll(query: QueryCertificatesDto): Promise<PaginatedResponse<CertificateDocument>> {
    const filter: Record<string, unknown> = { deletedAt: null };
    if (query.studentId) filter.studentId = new Types.ObjectId(query.studentId);
    if (query.schoolYearId) filter.schoolYearId = new Types.ObjectId(query.schoolYearId);
    if (query.type) filter.type = query.type;
    if (query.isRevoked !== undefined) filter.isRevoked = query.isRevoked;

    const [data, total] = await Promise.all([
      this.model
        .find(filter)
        .sort({ issuedDate: -1 })
        .skip(query.skip)
        .limit(query.limit)
        .lean()
        .exec(),
      this.model.countDocuments(filter).exec(),
    ]);

    return new PaginatedResponse(
      toApiDocuments(data as { _id?: unknown }[]) as unknown as CertificateDocument[],
      total,
      query.page,
      query.limit,
    );
  }

  async findOne(id: string): Promise<CertificateDocument> {
    if (!Types.ObjectId.isValid(id)) throw AppException.notFound();
    const certificate = await this.model.findOne({ _id: id, deletedAt: null }).exec();
    if (!certificate) throw AppException.notFound();
    return certificate;
  }

  /**
   * Issues a certificate: allocates a number, renders the PDF, stores it.
   *
   * The record and its number are committed in a transaction *before* the PDF is
   * rendered. Rendering is slow and can fail on an environment problem (a
   * missing font); holding a transaction open across it would risk allocating a
   * number and then rolling it back, leaving a gap in a document series that is
   * expected to be gap-free.
   */
  async issue(
    dto: IssueCertificateDto,
    actor: AuthenticatedUser,
    ip: string | null,
  ): Promise<CertificateDocument> {
    if (dto.type === 'study_verification') {
      // Not a rejection of the caller's intent so much as of this route: the
      // letter needs a birthplace, parents and a study period, none of which
      // this DTO carries, and issuing it here would burn a number on a letter
      // with four dotted lines in it.
      throw AppException.badRequest('common.validationFailed', {
        field: 'type',
        reason: 'use POST /certificates/study-verification for ໃບຢັ້ງຢືນການສຶກສາ',
      });
    }

    const student = await this.studentModel.findById(dto.studentId).lean().exec();
    if (!student) throw AppException.badRequest('common.notFound', { field: 'studentId' });

    const schoolYear = dto.schoolYearId
      ? await this.schoolYears.findOneOrFail(dto.schoolYearId)
      : await this.schoolYears.getActiveOrFail();

    const issuedDate = dto.issuedDate ? new Date(dto.issuedDate) : new Date();

    const certificate = await this.tx.run(async (session) => {
      const certificateNumber = await this.allocateNumber(schoolYear.code, dto.type, session);

      const [created] = await this.model.create(
        [
          {
            certificateNumber,
            studentId: student._id,
            studentNameLo: `${student.firstNameLo} ${student.lastNameLo}`,
            type: dto.type,
            schoolYearId: schoolYear._id,
            gradeLevelId: dto.gradeLevelId ? new Types.ObjectId(dto.gradeLevelId) : null,
            titleLo: dto.titleLo ?? null,
            descriptionLo: dto.descriptionLo ?? null,
            issuedDate,
            issuedBy: new Types.ObjectId(actor.sub),
          },
        ],
        { session },
      );

      await this.audit.record(
        {
          action: 'create',
          entityType: 'certificates',
          entityId: created._id,
          userId: actor.sub,
          username: actor.username,
          newValue: { certificateNumber, studentCode: student.studentCode, type: dto.type },
          ip,
        },
        session,
      );

      return created;
    });

    // Rendering failure leaves the record with `fileKey: null`, which
    // `regenerateFile` can fix — the number stays valid either way.
    await this.renderAndAttach(certificate, dto).catch((error) => {
      this.logger.error(
        `Certificate ${certificate.certificateNumber} was issued but its PDF failed to render`,
        error instanceof Error ? error.stack : String(error),
      );
    });

    await this.notifyStudent(certificate);
    return this.findOne(certificate._id.toString());
  }

  /** The draft the office reviews before a letter is issued. */
  prefillStudyVerification(studentId: string): Promise<StudyCertificatePrefill> {
    return this.studyData.prefill(studentId);
  }

  /**
   * Renders a letter without issuing it — no number, no record, no file.
   *
   * Worth its own path because the numbers are gap-free and outsiders verify
   * them: a teacher who wants to check the wording before printing must be able
   * to do so without consuming `100/ວຈພທນ(ຄນຮ)`. Where the number would go the
   * preview prints `(ຮ່າງ)`, so a printed draft cannot pass as a real letter.
   */
  async previewStudyVerification(dto: IssueStudyCertificateDto): Promise<Buffer> {
    const details = await this.studyData.resolveDetails(dto.studentId, dto);
    const data = await this.studyData.assemble({
      studentId: dto.studentId,
      certificateNumber: '(ຮ່າງ)',
      issuedDate: dto.issuedDate ? new Date(dto.issuedDate) : new Date(),
      details,
    });
    return this.studyRenderer.render(data);
  }

  /**
   * Issues a `ໃບຢັ້ງຢືນການສຶກສາ` and returns the record together with its PDF.
   *
   * The PDF comes back in the same call rather than through a signed URL: the
   * teacher is standing at the counter with the parent, and a letter that exists
   * only as an S3 key they have to fetch separately is a letter that fails on
   * the day object storage is unreachable. The upload still happens — the office
   * needs its copy — but its failure costs the reprint, not the visit.
   */
  async issueStudyVerification(
    dto: IssueStudyCertificateDto,
    actor: AuthenticatedUser,
    ip: string | null,
  ): Promise<{ certificate: CertificateDocument; pdf: Buffer }> {
    const student = await this.studentModel.findById(dto.studentId).lean().exec();
    if (!student) throw AppException.badRequest('common.notFound', { field: 'studentId' });

    const schoolYear = dto.schoolYearId
      ? await this.schoolYears.findOneOrFail(dto.schoolYearId)
      : await this.schoolYears.getActiveOrFail();

    const issuedDate = dto.issuedDate ? new Date(dto.issuedDate) : new Date();
    const details = await this.studyData.resolveDetails(dto.studentId, dto);

    const certificate = await this.tx.run(async (session) => {
      const certificateNumber = await this.allocateStudyVerificationNumber(session);

      const [created] = await this.model.create(
        [
          {
            certificateNumber,
            studentId: student._id,
            studentNameLo: `${student.firstNameLo} ${student.lastNameLo}`,
            type: 'study_verification',
            schoolYearId: schoolYear._id,
            titleLo: 'ໃບຢັ້ງຢືນການສຶກສາ',
            issuedDate,
            issuedBy: new Types.ObjectId(actor.sub),
            studyDetails: details,
          },
        ],
        { session },
      );

      await this.audit.record(
        {
          action: 'create',
          entityType: 'certificates',
          entityId: created._id,
          userId: actor.sub,
          username: actor.username,
          newValue: {
            certificateNumber,
            studentCode: student.studentCode,
            type: 'study_verification',
          },
          ip,
        },
        session,
      );

      return created;
    });

    const pdf = await this.renderStudyVerification(certificate);
    await this.storeStudyVerification(certificate, pdf);

    return { certificate: await this.findOne(certificate._id.toString()), pdf };
  }

  /**
   * The PDF of an already-issued certificate.
   *
   * Re-renders when the stored file is missing rather than returning a 404. The
   * record is what makes the number valid; the file is a rendering of it, and
   * reproducing it from `studyDetails` gives the same letter back.
   */
  async getFile(id: string, actor: AuthenticatedUser): Promise<{ pdf: Buffer; filename: string }> {
    const certificate = await this.findOne(id);
    await this.assertMayRead(certificate, actor);

    const filename = `${certificate.certificateNumber.replace(/[^\p{L}\p{N}]+/gu, '-')}.pdf`;

    if (certificate.fileKey) {
      const stored = await this.storage.getBuffer(certificate.fileKey);
      if (stored) return { pdf: stored, filename };
    }

    if (certificate.type !== 'study_verification') {
      // The award types render from a template plus marks, which
      // `regenerateFile` already knows how to redo and store.
      await this.regenerateFile(id, actor);
      const refreshed = await this.findOne(id);
      const stored = refreshed.fileKey ? await this.storage.getBuffer(refreshed.fileKey) : null;
      if (!stored) throw AppException.notFound();
      return { pdf: stored, filename };
    }

    const pdf = await this.renderStudyVerification(certificate);
    await this.storeStudyVerification(certificate, pdf);
    return { pdf, filename };
  }

  /** Re-renders the PDF for a certificate whose file is missing or stale. */
  async regenerateFile(id: string, actor: AuthenticatedUser): Promise<CertificateDocument> {
    const certificate = await this.findOne(id);
    if (certificate.isRevoked) {
      throw AppException.conflict('common.validationFailed', {
        reason: 'a revoked certificate is not re-rendered',
      });
    }

    await this.renderAndAttach(certificate, {
      studentId: certificate.studentId.toString(),
      type: certificate.type,
      titleLo: certificate.titleLo ?? undefined,
      schoolYearId: certificate.schoolYearId.toString(),
      gradeLevelId: certificate.gradeLevelId?.toString(),
    });

    await this.audit.record({
      action: 'update',
      entityType: 'certificates',
      entityId: certificate._id,
      userId: actor.sub,
      username: actor.username,
      reason: 'certificate PDF regenerated',
    });

    return this.findOne(id);
  }

  async getDownloadUrl(
    id: string,
    actor: AuthenticatedUser,
  ): Promise<{ url: string; expiresInSeconds: number }> {
    const certificate = await this.findOne(id);

    if (!certificate.fileKey) {
      throw AppException.conflict('common.validationFailed', {
        reason: 'no PDF has been rendered for this certificate yet',
      });
    }

    await this.assertMayRead(certificate, actor);

    const url = await this.storage.getSignedUrl(certificate.fileKey);
    if (!url) throw AppException.notFound();

    await this.audit.record({
      action: 'export',
      entityType: 'certificates',
      entityId: certificate._id,
      userId: actor.sub,
      username: actor.username,
      newValue: { certificateNumber: certificate.certificateNumber },
    });

    return { url, expiresInSeconds: 900 };
  }

  /**
   * Revokes a certificate.
   *
   * The record is kept and flagged rather than deleted — a certificate number
   * that has been in circulation must remain verifiable, and "revoked" is a
   * different answer from "never existed".
   */
  async revoke(
    id: string,
    dto: RevokeCertificateDto,
    actor: AuthenticatedUser,
    ip: string | null,
  ): Promise<CertificateDocument> {
    const certificate = await this.findOne(id);
    if (certificate.isRevoked) {
      throw AppException.conflict('common.validationFailed', {
        reason: 'certificate is already revoked',
      });
    }

    const updated = await this.model
      .findOneAndUpdate(
        { _id: id },
        { $set: { isRevoked: true, revocationReason: dto.reason } },
        { new: true },
      )
      .exec();
    if (!updated) throw AppException.notFound();

    await this.audit.record({
      action: 'update',
      entityType: 'certificates',
      entityId: updated._id,
      userId: actor.sub,
      username: actor.username,
      oldValue: { isRevoked: false },
      newValue: { isRevoked: true },
      ip,
      reason: `REVOKED: ${dto.reason}`,
    });

    return updated;
  }

  /**
   * Public verification by certificate number.
   *
   * Deliberately minimal: it confirms a number is genuine and names the holder,
   * but exposes no marks, contact details or internal ids. An unknown number
   * returns `isValid: false` rather than 404, so the endpoint reads the same for
   * a typo and for a forgery.
   */
  async verify(certificateNumber: string): Promise<{
    isValid: boolean;
    certificateNumber: string;
    studentNameLo: string | null;
    type: string | null;
    issuedDate: Date | null;
    isRevoked: boolean;
  }> {
    const certificate = await this.model
      .findOne({ certificateNumber: certificateNumber.trim(), deletedAt: null })
      .lean()
      .exec();

    if (!certificate) {
      return {
        isValid: false,
        certificateNumber,
        studentNameLo: null,
        type: null,
        issuedDate: null,
        isRevoked: false,
      };
    }

    return {
      isValid: !certificate.isRevoked,
      certificateNumber: certificate.certificateNumber,
      studentNameLo: certificate.studentNameLo,
      type: certificate.type,
      issuedDate: certificate.issuedDate,
      isRevoked: certificate.isRevoked,
    };
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  /**
   * Staff with `certificates:read`, or the pupil and their linked guardians.
   *
   * Kept as one method so the signed-URL route and the streaming route cannot
   * drift apart — a letter names a child's home address and both parents, so the
   * looser of two checks is the one that matters.
   */
  private async assertMayRead(
    certificate: CertificateDocument,
    actor: AuthenticatedUser,
  ): Promise<void> {
    const isOwnRecord =
      (actor.personType === 'student' && actor.personId === certificate.studentId.toString()) ||
      (actor.personType === 'guardian' &&
        (await this.isLinkedGuardian(actor.personId, certificate.studentId.toString())));

    const canRead = actor.permissions.some(
      (p) =>
        p.resource === 'certificates' &&
        (p.actions.includes('read') || p.actions.includes('manage')),
    );

    if (!isOwnRecord && !canRead) throw AppException.forbidden();
  }

  /**
   * Allocates the next `ໃບຢັ້ງຢືນການສຶກສາ` number, e.g. `99/ວຈພທນ(ຄນຮ)`.
   *
   * A different shape from the award series on purpose: this is a numbered
   * outgoing letter of the school's own register, which is what the department
   * code after the slash means, and its series continues from where the paper
   * book left off — hence the configurable start rather than 1.
   *
   * The ordinals are compared as **numbers**. Sorting them as strings, which is
   * what the award series does, puts `99` after `100` and would hand out `100`
   * twice; the unique index would then reject the second issue rather than
   * silently reuse it, but the office would be stuck.
   */
  private async allocateStudyVerificationNumber(session: ClientSession): Promise<string> {
    const [code, start, padding] = await Promise.all([
      this.settings.getValue<string>('school.documentCodeLo'),
      this.settings.getValue<number>('certificates.studyVerificationStartNumber'),
      this.settings.getValue<number>('certificates.studyVerificationNumberPadding'),
    ]);

    const issued = await this.model
      .find({ type: 'study_verification' })
      .select('certificateNumber')
      .session(session)
      .lean()
      .exec();

    const first = typeof start === 'number' && start > 0 ? start : 99;

    // The start number is a floor, not a reset: once a letter is out, the series
    // continues past it. Lowering the setting on a series already in use cannot
    // hand out a number twice — which is the point, since the number is what an
    // outsider verifies. Restarting means removing the letters that were issued.
    const highest = issued.reduce((max, doc) => {
      const ordinal = Number.parseInt(doc.certificateNumber.split('/')[0] ?? '', 10);
      return Number.isFinite(ordinal) && ordinal > max ? ordinal : max;
    }, first - 1);

    const width = typeof padding === 'number' && padding > 0 ? padding : 0;
    const ordinal = String(highest + 1).padStart(width, '0');

    return `${ordinal}/${code ?? 'ຄມຮ'}`;
  }

  private async renderStudyVerification(certificate: CertificateDocument): Promise<Buffer> {
    const data = await this.studyData.assemble({
      studentId: certificate.studentId.toString(),
      certificateNumber: certificate.certificateNumber,
      issuedDate: certificate.issuedDate,
      details: (certificate.studyDetails ?? {}) as StudyVerificationDetails,
    });
    return this.studyRenderer.render(data);
  }

  /**
   * Files the office's copy. A failure here is logged, never thrown: the caller
   * already holds the bytes, and losing the archive copy must not turn into the
   * parent being told to come back tomorrow.
   */
  private async storeStudyVerification(
    certificate: CertificateDocument,
    pdf: Buffer,
  ): Promise<void> {
    const fileKey = `certificates/${certificate._id.toString()}.pdf`;
    try {
      await this.storage.putBuffer(fileKey, pdf, 'application/pdf');
      await this.model.updateOne({ _id: certificate._id }, { $set: { fileKey } }).exec();
    } catch (error) {
      this.logger.error(
        `Certificate ${certificate.certificateNumber} was issued but its PDF could not be stored`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  /**
   * Allocates the next certificate number, e.g. `2025-2026/GRAD/0001`.
   *
   * Counts existing certificates of the same year and type inside the caller's
   * transaction and takes the next ordinal. The unique index on
   * `certificateNumber` is the real guarantee: if two requests race, one commits
   * and the other fails on the duplicate key rather than silently reusing a
   * number.
   */
  private async allocateNumber(
    schoolYearCode: string,
    type: string,
    session: ClientSession,
  ): Promise<string> {
    const prefix = `${schoolYearCode}/${type.slice(0, 4).toUpperCase()}`;

    const last = await this.model
      .findOne({ certificateNumber: { $regex: `^${escapeForRegex(prefix)}/` } })
      .sort({ certificateNumber: -1 })
      .select('certificateNumber')
      .session(session)
      .lean()
      .exec();

    const lastOrdinal = last
      ? Number.parseInt(last.certificateNumber.split('/').pop() ?? '0', 10)
      : 0;

    const next = String(lastOrdinal + 1).padStart(4, '0');
    return `${prefix}/${next}`;
  }

  private async renderAndAttach(
    certificate: CertificateDocument,
    dto: {
      studentId: string;
      type: string;
      titleLo?: string;
      schoolYearId?: string;
      gradeLevelId?: string;
      semesterId?: string;
      templateId?: string;
    },
  ): Promise<void> {
    const template = await this.templates.findActiveForType('certificate', dto.templateId);

    const data = await this.reportData.buildCertificate(dto.studentId, {
      certificateNumber: certificate.certificateNumber,
      issuedDate: certificate.issuedDate,
      titleLo: certificate.titleLo ?? dto.titleLo ?? null,
      schoolYearId: dto.schoolYearId ?? null,
      gradeLevelId: dto.gradeLevelId ?? null,
      semesterId: dto.semesterId ?? null,
    });

    const pdf = await this.renderer.render(template.layout as unknown as ReportLayout, data);
    const fileKey = `certificates/${certificate._id.toString()}.pdf`;
    await this.storage.putBuffer(fileKey, pdf, 'application/pdf');

    await this.model.updateOne({ _id: certificate._id }, { $set: { fileKey } }).exec();
  }

  private async notifyStudent(certificate: CertificateDocument): Promise<void> {
    const userIds = [
      await this.notifications.findUserIdForPerson('student', certificate.studentId),
      ...(await this.notifications.findGuardianUserIdsForStudent(certificate.studentId)),
    ].filter((id): id is Types.ObjectId => id !== null);

    await this.notifications.notifyMany(userIds, {
      type: 'general',
      titleLo: 'ອອກໃບປະກາດແລ້ວ',
      titleEn: 'Certificate issued',
      bodyLo: `ໃບປະກາດເລກທີ ${certificate.certificateNumber} ຖືກອອກໃຫ້ແລ້ວ`,
      bodyEn: `Certificate ${certificate.certificateNumber} has been issued.`,
      data: { entityType: 'certificates', entityId: certificate._id.toString() },
    });
  }

  private async isLinkedGuardian(
    guardianPersonId: string | null,
    studentId: string,
  ): Promise<boolean> {
    if (!guardianPersonId) return false;
    const own = await this.notifications.findUserIdForPerson('guardian', guardianPersonId);
    if (!own) return false;
    const linked = await this.notifications.findGuardianUserIdsForStudent(studentId);
    return linked.some((id) => id.equals(own));
  }
}

/** Escapes a string for safe use inside a regex. */
function escapeForRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
