import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AppException } from 'src/common/exceptions/app.exception';
import { BaseCrudService, CrudContext } from 'src/common/services/base-crud.service';
import {
  GeneratedReport,
  GeneratedReportDocument,
  ReportTemplate,
  ReportTemplateDocument,
} from 'src/database/schemas';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import {
  CreateReportTemplateDto,
  QueryReportTemplatesDto,
  UpdateReportTemplateDto,
} from './dto/report.dto';
import { ReportLayout, ReportSection } from './pdf/layout.types';

/** Section types the renderer knows how to draw. */
const KNOWN_SECTION_TYPES: ReportSection['type'][] = [
  'studentInfo',
  'subjectsTable',
  'summary',
  'attendance',
  'conduct',
  'text',
  'signatures',
  'spacer',
];

@Injectable()
export class ReportTemplatesService extends BaseCrudService<ReportTemplateDocument> {
  protected readonly entityType = 'reportTemplates';
  protected readonly sortableFields = ['code', 'nameLo', 'type', 'version'] as const;
  protected readonly defaultSort = { code: 1 as const };

  constructor(
    @InjectModel(ReportTemplate.name) model: Model<ReportTemplateDocument>,
    @InjectModel(GeneratedReport.name)
    private readonly generatedModel: Model<GeneratedReportDocument>,
    audit: AuditLogsService,
  ) {
    super(model, audit);
  }

  protected buildFilter(query: QueryReportTemplatesDto) {
    const filter: Record<string, unknown> = {};
    if (query.type) filter.type = query.type;
    if (query.isActive !== undefined) filter.isActive = query.isActive;
    return filter;
  }

  findAll(query: QueryReportTemplatesDto) {
    return this.findAllPaginated(query);
  }

  findOne(id: string) {
    return this.findOneOrFail(id);
  }

  /**
   * The template to render a given report type with.
   *
   * Shared by the reports and certificates modules so both resolve "the current
   * template" the same way — the newest active version, unless one is named.
   */
  async findActiveForType(
    type: ReportTemplateDocument['type'],
    templateId?: string,
  ): Promise<ReportTemplateDocument> {
    if (templateId) {
      const explicit = await this.findOneOrFail(templateId);
      if (explicit.type !== type) {
        throw AppException.badRequest('common.validationFailed', {
          reason: `template is for "${explicit.type}", not "${type}"`,
        });
      }
      return explicit;
    }

    const active = await this.model
      .findOne({ type, isActive: true, deletedAt: null })
      .sort({ version: -1 })
      .exec();

    if (!active) {
      throw AppException.badRequest('common.notFound', {
        reason: `no active report template for type "${type}"; seed or create one first`,
      });
    }
    return active;
  }

  create(dto: CreateReportTemplateDto, context: CrudContext) {
    this.assertValidLayout(dto.layout);
    return this.createDocument(dto as Partial<ReportTemplateDocument>, context);
  }

  /**
   * Updates a template, bumping `version` whenever the layout changes.
   *
   * The version is what lets an already-generated report be traced to the layout
   * that produced it — editing in place without it would make an old PDF
   * unexplainable.
   */
  async update(id: string, dto: UpdateReportTemplateDto, context: CrudContext) {
    const current = await this.findOneOrFail(id);
    const patch: Record<string, unknown> = { ...dto };

    if (dto.layout) {
      this.assertValidLayout(dto.layout);
      patch.version = current.version + 1;
    }

    return this.updateDocument(id, patch, context);
  }

  async remove(id: string, context: CrudContext): Promise<void> {
    // Reports reference their template to explain how they were rendered.
    const used = await this.generatedModel.exists({ templateId: id, deletedAt: null }).exec();
    if (used) {
      throw AppException.conflict('common.inUse', {
        reason: 'reports have been generated from this template; deactivate it instead',
      });
    }
    await this.softDelete(id, context);
  }

  /**
   * Validates a layout before it is stored.
   *
   * Catching a malformed layout here rather than at render time matters: a
   * template is saved once and used for hundreds of reports, and a background
   * job that fails on every student is a much worse way to learn the layout was
   * wrong.
   */
  private assertValidLayout(layout: Record<string, unknown>): void {
    const candidate = layout as unknown as ReportLayout;

    if (!Array.isArray(candidate.sections)) {
      throw AppException.badRequest('common.validationFailed', {
        field: 'layout.sections',
        reason: 'must be an array of sections',
      });
    }

    if (candidate.sections.length === 0) {
      throw AppException.badRequest('common.validationFailed', {
        field: 'layout.sections',
        reason: 'a template needs at least one section',
      });
    }

    const unknownTypes = candidate.sections
      .map((section) => (section as { type?: string })?.type)
      .filter((type) => !type || !KNOWN_SECTION_TYPES.includes(type as ReportSection['type']));

    if (unknownTypes.length > 0) {
      throw AppException.badRequest('common.validationFailed', {
        field: 'layout.sections',
        reason: 'unknown section type(s)',
        unknownTypes,
        supported: KNOWN_SECTION_TYPES,
      });
    }

    // A `text` section with no content renders as a blank gap, which looks like
    // a rendering bug to whoever receives the report.
    const emptyText = candidate.sections.filter(
      (section) => section.type === 'text' && !('contentLo' in section && section.contentLo),
    );
    if (emptyText.length > 0) {
      throw AppException.badRequest('common.validationFailed', {
        field: 'layout.sections',
        reason: 'every `text` section needs contentLo',
      });
    }
  }
}
