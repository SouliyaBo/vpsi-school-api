import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
  Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ClientIp, CurrentUser, RequirePermissions } from 'src/common/decorators';
import type { AuthenticatedUser } from 'src/common/interfaces/authenticated-user.interface';
import type { Response } from 'express';
import {
  CreateHomeroomReviewDto,
  MonthlyReportQueryDto,
  QueryHomeroomReviewsDto,
  ReviewComplianceQueryDto,
  ReviewSheetQueryDto,
  UpdateHomeroomReviewDto,
} from './dto/homeroom-review.dto';
import { HomeroomMonthlyReportDocxWriter } from './homeroom-monthly-report.docx';
import { HomeroomMonthlyReportService } from './homeroom-monthly-report.service';
import { HomeroomReviewsService } from './homeroom-reviews.service';

/**
 * ການຕິດຕາມນັກຮຽນຂອງຄູປະຈຳຫ້ອງ — the homeroom teacher's ວັນພຸດ/ວັນສຸກ review.
 *
 * Two audiences, and the split runs through every route here: a teacher works on
 * their own room and reads their own record, while the office reads the report
 * that names everybody's. `manage` is what separates them, as it does on the
 * register's coverage and punctuality reports — a permission to file a review is
 * not a permission to see who else has not.
 */
@ApiTags('homeroom-reviews')
@ApiBearerAuth()
@Controller('homeroom-reviews')
export class HomeroomReviewsController {
  constructor(
    private readonly service: HomeroomReviewsService,
    private readonly monthlyReport: HomeroomMonthlyReportService,
    private readonly monthlyReportDocx: HomeroomMonthlyReportDocxWriter,
  ) {}

  @Get('sheet')
  @RequirePermissions({ resource: 'homeroom-reviews', action: 'read' })
  @ApiOperation({
    summary: 'One room’s sheet for one review day — the children worth looking at',
    description:
      'The shortlist, not the roster: the roll call, the register and the discipline ledger are ' +
      'crossed against the school’s thresholds, and a child with nothing against them is not a ' +
      'row. Two scopes are reported per child — what happened since the last review, and where ' +
      'the term leaves them — because the second is the slow slide that a weekly check alone ' +
      'never catches. `dueDate` defaults to the most recent review day the calendar owes, so a ' +
      'teacher opening this on Thursday morning is offered Wednesday’s sheet and not a new one.',
  })
  sheet(@Query() query: ReviewSheetQueryDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.service.getSheet(query, actor);
  }

  @Get('monthly-report')
  @RequirePermissions({ resource: 'homeroom-reviews', action: 'read' })
  @ApiOperation({
    summary: 'ຮ່າງບົດສະຫຼຸບຄູປະຈຳຫ້ອງ — the month’s report, filled from the records',
    description:
      'Absences of three days or more, lates that made up a day, the register’s write-ups, ' +
      'conduct points lost and the rung they reached, ກວດກາ marks under half, and guardians ' +
      'contacted in the reviews filed — each read from the screen that owns it. The sections ' +
      'nobody records (ສະພາບລວມ, extra classes, outside activities, ຂໍ້ສະເໜີ) are left for the ' +
      'teacher in the Word export. A homeroom teacher reads their own rooms only.',
  })
  monthlyReportJson(
    @Query() query: MonthlyReportQueryDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.monthlyReport.build(query, actor);
  }

  @Get('monthly-report/docx')
  @RequirePermissions({ resource: 'homeroom-reviews', action: 'read' })
  @ApiOperation({ summary: 'The same report as the office’s Word form, with blank rows to fill' })
  async monthlyReportFile(
    @Query() query: MonthlyReportQueryDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Res() response: Response,
  ) {
    const report = await this.monthlyReport.build(query, actor);
    const buffer = await this.monthlyReportDocx.write(report);
    // Month in words with its number, then the class, split by a fullwidth
    // solidus — a plain `/` does not survive a browser download.
    const filename =
      `ຮ່າງບົດສະຫຼຸບຄູປະຈຳຫ້ອງເດືອນ${report.monthNameLo}(${String(report.month).padStart(2, '0')})` +
      `／${report.classroom.name.replace(/\//g, '／').replace(/[\\:*?"<>|]+/g, '-')}.docx`;
    response.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
    response.setHeader('Content-Length', buffer.length);
    response.setHeader(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
    );
    response.end(buffer);
  }

  @Get('mine')
  @RequirePermissions({ resource: 'homeroom-reviews', action: 'read' })
  @ApiOperation({
    summary: 'The signed-in teacher’s own rooms, and what each owes now',
    description:
      'What the reminder banner reads. Scoped to the teacher on the session and never to one ' +
      'named by the client; an office account is nobody’s homeroom teacher and gets an empty ' +
      'list rather than the school’s.',
  })
  mine(@CurrentUser() actor: AuthenticatedUser) {
    return this.service.getMine(actor);
  }

  @Get('compliance')
  @RequirePermissions({ resource: 'homeroom-reviews', action: 'manage' })
  @ApiOperation({
    summary: 'Which homeroom teacher has checked their class, and which has not',
    description:
      'Crosses the calendar’s ວັນພຸດ/ວັນສຸກ with the reviews on file, so a room nobody has ' +
      'opened is a row rather than an absence. A review day the school did not teach on is not ' +
      'owed, and one whose deadline — noon of the next working day — has not passed counts as ' +
      'pending rather than missing. Defaults to the active term to date. `manage` rather than ' +
      '`read`: this names other people’s work, and is held by the administrator and the head of ' +
      'academic affairs.',
  })
  compliance(@Query() query: ReviewComplianceQueryDto) {
    return this.service.getCompliance(query);
  }

  @Get()
  @RequirePermissions({ resource: 'homeroom-reviews', action: 'manage' })
  @ApiOperation({
    summary: 'The reviews themselves, newest first',
    description:
      '`studentId` narrows it to every review one child was named in and what was done about ' +
      'them — which is what a guardian meeting is prepared from.',
  })
  findAll(@Query() query: QueryHomeroomReviewsDto) {
    return this.service.findAll(query);
  }

  @Post()
  @RequirePermissions({ resource: 'homeroom-reviews', action: 'create' })
  @ApiOperation({
    summary: 'ຢືນຢັນການຕິດຕາມ — file the review',
    description:
      'The sheet is rebuilt server-side and the reasons are snapshotted from it, so a review ' +
      'cannot claim a child was flagged for something they were not. `students` may be empty: a ' +
      'class with nothing wrong in it is the good outcome, and a review that found nothing is ' +
      'still a review. A child the teacher adds who was not flagged is kept, with no reasons.',
  })
  create(
    @Body() dto: CreateHomeroomReviewDto,
    @CurrentUser() actor: AuthenticatedUser,
    @ClientIp() ip: string | null,
  ) {
    return this.service.create(dto, actor, ip);
  }

  @Put(':id')
  @RequirePermissions({ resource: 'homeroom-reviews', action: 'update' })
  @ApiOperation({
    summary: 'Amend a review already filed',
    description:
      'The room, the day and the filing time are not editable — the first two make it a ' +
      'different review, and the third is what the punctuality column is measured against.',
  })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateHomeroomReviewDto,
    @CurrentUser() actor: AuthenticatedUser,
    @ClientIp() ip: string | null,
  ) {
    return this.service.update(id, dto, actor, ip);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions({ resource: 'homeroom-reviews', action: 'delete' })
  @ApiOperation({
    summary: 'Withdraw a review',
    description:
      'Soft, and the room may then file for that day again. `delete` is the office’s: a teacher ' +
      'who could delete their own review could un-say what they told a guardian.',
  })
  remove(
    @Param('id') id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @ClientIp() ip: string | null,
  ) {
    return this.service.remove(id, actor, ip);
  }
}
