import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseFilePipeBuilder,
  Patch,
  Post,
  Put,
  Query,
  Res,
  UploadedFile,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { ClientIp, CurrentUser, RequirePermissions } from 'src/common/decorators';
import type { AuthenticatedUser } from 'src/common/interfaces/authenticated-user.interface';
import { UPLOAD_RULES } from '../storage/storage.service';
import {
  AnswerSheetsQueryDto,
  ExportSetsQueryDto,
  GenerateVariantsDto,
  PushToMonthlyMarksDto,
  QueryExamPapersDto,
  ResponsesQueryDto,
  SaveResponseDto,
  ScansQueryDto,
  SeatPlanQueryDto,
  UpdateScanDto,
  UpdateExamPaperDto,
  UploadExamPaperDto,
} from './dto/exam-paper.dto';
import { ExamPapersService, ExportedFile } from './exam-papers.service';

/**
 * ບົດສອບປາລະໄນ — multiple-choice papers, shuffled into sets.
 *
 * A teacher uploads the Word file they wrote, checks what the reader made
 * of it, asks for N sets, and downloads the sets, the answer key and a seat
 * plan for the class. Every route is narrowed in the service to the papers
 * the caller uploaded, unless they hold `manage`.
 */
@ApiTags('exam-papers')
@ApiBearerAuth()
@Controller('exam-papers')
export class ExamPapersController {
  constructor(private readonly service: ExamPapersService) {}

  @Get()
  @RequirePermissions({ resource: 'exam-papers', action: 'read' })
  @ApiOperation({ summary: 'My papers — the school’s, with `manage`' })
  findAll(@Query() query: QueryExamPapersDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.service.findAll(query, actor);
  }

  @Get(':id')
  @RequirePermissions({ resource: 'exam-papers', action: 'read' })
  @ApiOperation({ summary: 'One paper with its questions; pictures carry a short-lived URL' })
  findOne(@Param('id') id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.service.findOne(id, actor);
  }

  @Get(':id/source')
  @RequirePermissions({ resource: 'exam-papers', action: 'read' })
  @ApiOperation({ summary: 'A short-lived link to the Word file as uploaded' })
  source(@Param('id') id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.service.sourceUrl(id, actor);
  }

  @Post()
  @RequirePermissions({ resource: 'exam-papers', action: 'create' })
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary', description: 'The paper, as .docx' },
        title: { type: 'string' },
        subjectId: { type: 'string' },
        classroomId: { type: 'string' },
        semesterId: { type: 'string' },
      },
      required: ['file'],
    },
  })
  @ApiOperation({
    summary: 'Upload a Word file and read it into questions',
    description:
      'Questions start with their number (`1.`), options with their letter (`A.` or `ກ.`), and ' +
      'the right answer is the option set in bold. What the reader could not place is returned ' +
      'as `warnings` for the review page.',
  })
  upload(
    @Body() dto: UploadExamPaperDto,
    @UploadedFile(
      new ParseFilePipeBuilder()
        .addMaxSizeValidator({ maxSize: UPLOAD_RULES.document.maxBytes })
        .build({ fileIsRequired: true }),
    )
    file: Express.Multer.File,
    @CurrentUser() actor: AuthenticatedUser,
    @ClientIp() ip: string | null,
  ) {
    return this.service.create(dto, file, actor, ip);
  }

  @Patch(':id')
  @RequirePermissions({ resource: 'exam-papers', action: 'update' })
  @ApiOperation({
    summary: 'The teacher’s corrections',
    description:
      '`questions`, when sent, replaces the list whole. Sets already drawn are re-drawn from ' +
      'the same seed, so they stay the same sets.',
  })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateExamPaperDto,
    @CurrentUser() actor: AuthenticatedUser,
    @ClientIp() ip: string | null,
  ) {
    return this.service.update(id, dto, actor, ip);
  }

  @Post(':id/generate')
  @RequirePermissions({ resource: 'exam-papers', action: 'update' })
  @ApiOperation({ summary: 'Draw the sets — a new drawing each time unless a seed is given back' })
  generate(
    @Param('id') id: string,
    @Body() dto: GenerateVariantsDto,
    @CurrentUser() actor: AuthenticatedUser,
    @ClientIp() ip: string | null,
  ) {
    return this.service.generate(id, dto, actor, ip);
  }

  @Delete(':id')
  @RequirePermissions({ resource: 'exam-papers', action: 'delete' })
  @ApiOperation({ summary: 'Withdraw a paper' })
  remove(
    @Param('id') id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @ClientIp() ip: string | null,
  ) {
    return this.service.remove(id, actor, ip);
  }

  // ── Printing ──────────────────────────────────────────────────────────────

  @Get(':id/sets')
  @RequirePermissions({ resource: 'exam-papers', action: 'read' })
  @ApiOperation({
    summary: 'The sets, as one PDF or Word file',
    description: '`set=A` for one set, `set=all` for every set in order, each on a fresh page.',
  })
  async sets(
    @Param('id') id: string,
    @Query() query: ExportSetsQueryDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Res() response: Response,
  ) {
    this.send(response, await this.service.exportSets(id, query.format, query.set, actor));
  }

  @Get(':id/answer-key')
  @RequirePermissions({ resource: 'exam-papers', action: 'read' })
  @ApiOperation({ summary: 'ເສີຍ — every set’s answers side by side, as PDF' })
  async answerKey(
    @Param('id') id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Res() response: Response,
  ) {
    this.send(response, await this.service.answerKey(id, actor));
  }

  @Get(':id/seat-plan')
  @RequirePermissions({ resource: 'exam-papers', action: 'read' })
  @ApiOperation({
    summary: 'Who sits where and holds which set',
    description:
      'The class in roll order, seated `columns` across, so that no two pupils side by side ' +
      'or one behind the other hold the same set.',
  })
  seatPlan(
    @Param('id') id: string,
    @Query() query: SeatPlanQueryDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.service.seatPlan(id, query, actor);
  }

  @Get(':id/seat-plan.pdf')
  @RequirePermissions({ resource: 'exam-papers', action: 'read' })
  @ApiOperation({ summary: 'The seat plan as a sheet to hand the sets out from' })
  async seatPlanPdf(
    @Param('id') id: string,
    @Query() query: SeatPlanQueryDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Res() response: Response,
  ) {
    this.send(response, await this.service.seatPlanPdf(id, query, actor));
  }

  @Get(':id/answer-sheets.pdf')
  @RequirePermissions({ resource: 'exam-papers', action: 'read' })
  @ApiOperation({
    summary: 'ເຈ້ຍຕອບ — a bubble sheet per pupil, named and with their set filled in, plus spares',
  })
  async answerSheets(
    @Param('id') id: string,
    @Query() query: AnswerSheetsQueryDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Res() response: Response,
  ) {
    this.send(response, await this.service.answerSheetsPdf(id, query, actor));
  }

  // ── Marking ───────────────────────────────────────────────────────────────

  @Get(':id/responses')
  @RequirePermissions({ resource: 'exam-papers', action: 'read' })
  @ApiOperation({
    summary: 'The class with each pupil’s sheet as keyed in, and the class’s figures',
  })
  responses(
    @Param('id') id: string,
    @Query() query: ResponsesQueryDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.service.responses(id, query, actor);
  }

  @Put(':id/responses/:studentId')
  @RequirePermissions({ resource: 'exam-papers', action: 'update' })
  @ApiOperation({ summary: 'Key in (or correct) one pupil’s sheet; it is marked on the spot' })
  saveResponse(
    @Param('id') id: string,
    @Param('studentId') studentId: string,
    @Body() dto: SaveResponseDto,
    @CurrentUser() actor: AuthenticatedUser,
    @ClientIp() ip: string | null,
  ) {
    return this.service.saveResponse(id, studentId, dto, actor, ip);
  }

  @Delete(':id/responses/:studentId')
  @RequirePermissions({ resource: 'exam-papers', action: 'update' })
  @ApiOperation({ summary: 'Withdraw one pupil’s sheet' })
  deleteResponse(
    @Param('id') id: string,
    @Param('studentId') studentId: string,
    @CurrentUser() actor: AuthenticatedUser,
    @ClientIp() ip: string | null,
  ) {
    return this.service.deleteResponse(id, studentId, actor, ip);
  }

  // ── Scanning ──────────────────────────────────────────────────────────────

  @Post(':id/scans')
  @RequirePermissions({ resource: 'exam-papers', action: 'update' })
  @UseInterceptors(FilesInterceptor('files', 40))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        files: { type: 'array', items: { type: 'string', format: 'binary' } },
      },
      required: ['files'],
    },
  })
  @ApiOperation({
    summary: 'Photographs of filled answer sheets — read, and filed for review',
    description:
      'Each photo becomes a scan: the reader proposes the pupil (from the QR, else the code ' +
      'bubbles), the set and the answers, with its confidence per question. Nothing is marked ' +
      'until the teacher confirms the scan.',
  })
  uploadScans(
    @Param('id') id: string,
    @UploadedFiles(
      new ParseFilePipeBuilder()
        .addMaxSizeValidator({ maxSize: 15 * 1024 * 1024 })
        .build({ fileIsRequired: true }),
    )
    files: Express.Multer.File[],
    @CurrentUser() actor: AuthenticatedUser,
    @ClientIp() ip: string | null,
  ) {
    return this.service.uploadScans(id, files, actor, ip);
  }

  @Get(':id/scans')
  @RequirePermissions({ resource: 'exam-papers', action: 'read' })
  @ApiOperation({ summary: 'The scans of this paper, newest first, with a short-lived image URL' })
  scans(
    @Param('id') id: string,
    @Query() query: ScansQueryDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.service.scans(id, query, actor);
  }

  @Patch(':id/scans/:scanId')
  @RequirePermissions({ resource: 'exam-papers', action: 'update' })
  @ApiOperation({
    summary: 'Correct a scan — the pupil, the set, an answer — and, with `confirm`, mark it',
  })
  updateScan(
    @Param('id') id: string,
    @Param('scanId') scanId: string,
    @Body() dto: UpdateScanDto,
    @CurrentUser() actor: AuthenticatedUser,
    @ClientIp() ip: string | null,
  ) {
    return this.service.updateScan(id, scanId, dto, actor, ip);
  }

  @Delete(':id/scans/:scanId')
  @RequirePermissions({ resource: 'exam-papers', action: 'update' })
  @ApiOperation({ summary: 'Discard a scan (the response it made, if any, stays)' })
  deleteScan(
    @Param('id') id: string,
    @Param('scanId') scanId: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.service.deleteScan(id, scanId, actor);
  }

  @Post(':id/push-to-monthly-marks')
  @RequirePermissions({ resource: 'exam-papers', action: 'update' })
  @ApiOperation({
    summary: 'ສົ່ງຄະແນນເຂົ້າຄະແນນປະຈຳເດືອນ — every keyed sheet’s points into the ກວດກາ column',
    description:
      'Goes through the monthly sheet’s own save, so the teacher must be the one assigned to ' +
      'the subject and a submitted month needs `overrideReason`. Returns what that save returns.',
  })
  pushToMonthlyMarks(
    @Param('id') id: string,
    @Body() dto: PushToMonthlyMarksDto,
    @CurrentUser() actor: AuthenticatedUser,
    @ClientIp() ip: string | null,
  ) {
    return this.service.pushToMonthlyMarks(id, dto, actor, ip);
  }

  /** `attachment`: the sets are printed, not read in a browser tab. */
  private send(response: Response, file: ExportedFile): void {
    response.setHeader('Content-Type', file.contentType);
    response.setHeader('Content-Length', file.buffer.length);
    response.setHeader(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
    );
    response.end(file.buffer);
  }
}
