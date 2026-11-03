import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ClientIp, CurrentUser, RequirePermissions } from 'src/common/decorators';
import { AppException } from 'src/common/exceptions/app.exception';
import type { AuthenticatedUser } from 'src/common/interfaces/authenticated-user.interface';
import {
  BatchReportQueuedDto,
  CreateReportTemplateDto,
  GenerateClassReportsDto,
  GenerateReportCardDto,
  QueryGeneratedReportsDto,
  QueryReportTemplatesDto,
  ReportDownloadDto,
  ReportQueuedDto,
  UpdateReportTemplateDto,
} from './dto/report.dto';
import { ReportTemplatesService } from './report-templates.service';
import { ReportDataService } from './report-data.service';
import { ReportsQueueService } from './reports.queue';
import { ReportsService } from './reports.service';

@ApiTags('reports')
@ApiBearerAuth()
@Controller('reports')
export class ReportsController {
  constructor(
    private readonly reports: ReportsService,
    private readonly templates: ReportTemplatesService,
    private readonly reportData: ReportDataService,
    private readonly queue: ReportsQueueService,
  ) {}

  // ── Templates ─────────────────────────────────────────────────────────────

  @Get('templates')
  @RequirePermissions({ resource: 'reports', action: 'read' })
  @ApiOperation({ summary: 'List report templates' })
  findTemplates(@Query() query: QueryReportTemplatesDto) {
    return this.templates.findAll(query);
  }

  @Get('templates/:id')
  @RequirePermissions({ resource: 'reports', action: 'read' })
  findTemplate(@Param('id') id: string) {
    return this.templates.findOne(id);
  }

  @Post('templates')
  @RequirePermissions({ resource: 'reports', action: 'manage' })
  @ApiOperation({
    summary: 'Create a report template',
    description:
      'The layout is validated on write — unknown section types and empty text sections are ' +
      'rejected here rather than failing later inside a background job.',
  })
  createTemplate(
    @Body() dto: CreateReportTemplateDto,
    @CurrentUser() actor: AuthenticatedUser,
    @ClientIp() ip: string | null,
  ) {
    return this.templates.create(dto, { actor, ip });
  }

  @Patch('templates/:id')
  @RequirePermissions({ resource: 'reports', action: 'manage' })
  @ApiOperation({
    summary: 'Update a template',
    description: 'Changing the layout bumps `version`, so old reports stay traceable.',
  })
  updateTemplate(
    @Param('id') id: string,
    @Body() dto: UpdateReportTemplateDto,
    @CurrentUser() actor: AuthenticatedUser,
    @ClientIp() ip: string | null,
  ) {
    return this.templates.update(id, dto, { actor, ip });
  }

  @Delete('templates/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions({ resource: 'reports', action: 'manage' })
  @ApiOperation({ summary: 'Delete a template that has never been used' })
  removeTemplate(
    @Param('id') id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @ClientIp() ip: string | null,
  ) {
    return this.templates.remove(id, { actor, ip });
  }

  // ── Generation ────────────────────────────────────────────────────────────

  @Post('report-cards')
  @HttpCode(HttpStatus.ACCEPTED)
  @RequirePermissions({ resource: 'reports', action: 'create' })
  @ApiOperation({
    summary: 'Queue a report card for one student',
    description:
      'Rendering runs as a background job. Poll the returned report id for status. A ' +
      'homeroom teacher may queue one only for a student of their own room.',
  })
  @ApiResponse({ status: 202, type: ReportQueuedDto })
  async generateReportCard(
    @Body() dto: GenerateReportCardDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<ReportQueuedDto> {
    const classroomId = await this.reportData.termResultClassroomId(dto.studentId, dto.semesterId);
    await this.reports.assertMayReportOn(actor, classroomId);
    const template = await this.reports.resolveTemplate('report_card', dto.templateId);

    const report = await this.reports.createPending({
      type: 'report_card',
      templateId: template._id,
      params: { studentId: dto.studentId, semesterId: dto.semesterId },
      studentId: dto.studentId,
      classroomId,
      semesterId: dto.semesterId,
      requestedBy: actor.sub,
    });

    const jobId = await this.queue.enqueueRender(report._id.toString());
    return { reportId: report._id.toString(), jobId, status: 'queued' };
  }

  @Post('report-cards/class')
  @HttpCode(HttpStatus.ACCEPTED)
  @RequirePermissions({ resource: 'reports', action: 'create' })
  @ApiOperation({
    summary: 'Queue a report card for every student in a classroom',
    description:
      'One job per student rather than one job for the class, so a single unrenderable ' +
      'student does not lose the whole batch, and progress is visible per report. With ' +
      '`combined`, one job and one PDF for the class instead — what the office prints. A ' +
      'homeroom teacher may queue either only for their own room.',
  })
  @ApiResponse({ status: 202, type: BatchReportQueuedDto })
  async generateClassReports(
    @Body() dto: GenerateClassReportsDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<BatchReportQueuedDto> {
    await this.reports.assertMayReportOn(actor, dto.classroomId);
    const template = await this.reports.resolveTemplate('report_card', dto.templateId);
    const studentIds = await this.reportData.listClassroomStudentIds(
      dto.classroomId,
      dto.semesterId,
    );

    if (dto.combined) {
      // Refused here rather than left to fail in the worker, so the office is
      // told to compute the term at the moment it presses the button.
      if (studentIds.length === 0) {
        throw AppException.unprocessable('report.noTermResults', {
          classroomId: dto.classroomId,
          semesterId: dto.semesterId,
        });
      }
      const report = await this.reports.createPending({
        type: 'report_card',
        templateId: template._id,
        params: {
          classroomId: dto.classroomId,
          semesterId: dto.semesterId,
          students: studentIds.length,
        },
        classroomId: dto.classroomId,
        semesterId: dto.semesterId,
        requestedBy: actor.sub,
      });
      const jobId = await this.queue.enqueueRender(report._id.toString());
      return { queued: 1, reports: [{ reportId: report._id.toString(), jobId, status: 'queued' }] };
    }

    const queued: ReportQueuedDto[] = [];
    for (const studentId of studentIds) {
      const report = await this.reports.createPending({
        type: 'report_card',
        templateId: template._id,
        params: { studentId, semesterId: dto.semesterId, classroomId: dto.classroomId },
        studentId,
        classroomId: dto.classroomId,
        semesterId: dto.semesterId,
        requestedBy: actor.sub,
      });
      const jobId = await this.queue.enqueueRender(report._id.toString());
      queued.push({ reportId: report._id.toString(), jobId, status: 'queued' });
    }

    return { queued: queued.length, reports: queued };
  }

  @Post(':id/render-now')
  @RequirePermissions({ resource: 'reports', action: 'manage' })
  @ApiOperation({
    summary: 'Render a queued report synchronously',
    description:
      'Bypasses the queue — for one-off retries and for integration tests, which have no ' +
      'Redis. Holds the request open for the whole render.',
  })
  renderNow(@Param('id') id: string) {
    return this.reports.renderQueuedReport(id);
  }

  // ── Retrieval ─────────────────────────────────────────────────────────────

  @Get()
  @RequirePermissions({ resource: 'reports', action: 'read' })
  @ApiOperation({
    summary: 'List generated reports',
    description:
      'Narrowed per caller: a homeroom teacher sees what they asked for and what was made ' +
      'for their room; a student or guardian only the cards about their own child.',
  })
  findAll(@Query() query: QueryGeneratedReportsDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.reports.findAll(query, actor);
  }

  @Get('jobs/:jobId')
  @RequirePermissions({ resource: 'reports', action: 'read' })
  @ApiOperation({ summary: 'Status of a rendering job' })
  async jobStatus(@Param('jobId') jobId: string) {
    const status = await this.queue.getJobStatus(jobId);
    if (!status) throw new NotFoundException(`No job with id "${jobId}"`);
    return status;
  }

  @Get(':id')
  @RequirePermissions({ resource: 'reports', action: 'read' })
  @ApiOperation({ summary: 'One generated report, including its status and any error' })
  findOne(@Param('id') id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.reports.findOneFor(id, actor);
  }

  @Get(':id/download')
  @ApiOperation({
    summary: 'Signed download URL for a completed report',
    description:
      'Allowed for the requester, holders of `reports:export`, and the student or linked ' +
      'guardian the report is about. Every download is audited.',
  })
  @ApiResponse({ status: 200, type: ReportDownloadDto })
  download(@Param('id') id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.reports.getDownloadUrl(id, actor);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions({ resource: 'reports', action: 'delete' })
  @ApiOperation({ summary: 'Delete a report and its stored PDF' })
  remove(
    @Param('id') id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @ClientIp() ip: string | null,
  ) {
    return this.reports.remove(id, { actor, ip });
  }
}
