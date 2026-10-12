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
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { ClientIp, CurrentUser, RequirePermissions } from 'src/common/decorators';
import { CoverageQueryDto } from 'src/common/dto/coverage-query.dto';
import { TimelinessQueryDto } from 'src/common/dto/timeliness-query.dto';
import type { AuthenticatedUser } from 'src/common/interfaces/authenticated-user.interface';
import { BehaviorLogsService } from './behavior-logs.service';
import {
  BehaviorTallyQueryDto,
  CreateBehaviorLogDto,
  MonthlySheetQueryDto,
  QueryBehaviorLogsDto,
  UpdateBehaviorLogDto,
} from './dto/behavior-log.dto';

/**
 * The homeroom behaviour register (ການຕິດຕາມ ແລະ ບັນທຶກພຶດຕິກຳຂອງນັກຮຽນ).
 *
 * The unit of writing is a *row* of the paper sheet, not a record: a row names
 * several students at once, and the id in the write paths is therefore a
 * `groupId`. Reads come in two shapes because the register answers two
 * questions — the month as a class sheet, and the term as one student's history.
 */
@ApiTags('behavior-logs')
@ApiBearerAuth()
@Controller('behavior-logs')
export class BehaviorLogsController {
  constructor(private readonly service: BehaviorLogsService) {}

  @Get()
  @RequirePermissions({ resource: 'behavior-logs', action: 'read' })
  @ApiOperation({
    summary: 'The register as a flat log, newest first — one record per student',
  })
  findAll(@Query() query: QueryBehaviorLogsDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.service.findAll(query, actor);
  }

  @Get('monthly-sheet')
  @RequirePermissions({ resource: 'behavior-logs', action: 'read' })
  @ApiOperation({
    summary: 'The monthly sheet for one class, laid out as the paper form',
    description:
      'Rows are reassembled from the group each set of records was written with, so several ' +
      'students named in one entry come back on one row. Chronological, and printable.',
  })
  monthlySheet(@Query() query: MonthlySheetQueryDto) {
    return this.service.getMonthlySheet(query);
  }

  @Get('weekly-coverage')
  @RequirePermissions({ resource: 'behavior-logs', action: 'manage' })
  @ApiOperation({
    summary: 'Which class and which teacher wrote nothing this week',
    description:
      'Crosses the timetable with the register, so a lesson nobody wrote about shows as a gap — ' +
      'which the plain list cannot report, since it only holds rows that exist. Defaults to ' +
      'this week and the active semester, and is measured up to today, so a lesson later in ' +
      'the week is not yet owed. Rotating periods are left out: both arrangements of a swap ' +
      'are on the timetable, so it cannot say which teacher took which class. `manage` rather ' +
      'than `read`: this is oversight of other ' +
      'people’s work, held by the administrator and the head of academic affairs — a teacher ' +
      'reads their own week from `weekly-coverage/mine`.',
  })
  weeklyCoverage(@Query() query: CoverageQueryDto) {
    return this.service.getWeeklyCoverage(query);
  }

  @Get('timeliness')
  @RequirePermissions({ resource: 'behavior-logs', action: 'manage' })
  @ApiOperation({
    summary: 'Who writes the register up late',
    description:
      'Not whether a lesson was written up but *when*. The deadline is the school’s own: noon ' +
      'of the next working day after the lesson, so Friday’s is due Monday noon and a lesson ' +
      'before ບຸນປີໃໝ່ is due at noon on the day the school comes back — weekends, holidays and ' +
      'the days the office closed all come from `calendarEvents`. The unit judged is one act ' +
      'per class per day, timed from the earliest `createdAt` of the rows it wrote, so a ' +
      'teacher of a large class is not reported as forty times as late as a teacher of a ' +
      'small one. Defaults to the active term to date. Rotating periods are left out, as in ' +
      'the coverage report. `manage` rather than `read`, because this names and ranks other ' +
      'people’s work — held by the administrator and the head of academic affairs.' +
      ' Unlike the roll call there is no missing count: the register is written when there is ' +
      'something to note, so only the entries that exist are judged.',
  })
  timeliness(@Query() query: TimelinessQueryDto) {
    return this.service.getTimeliness(query);
  }

  @Get('weekly-coverage/mine')
  @RequirePermissions({ resource: 'behavior-logs', action: 'read' })
  @ApiOperation({
    summary: 'The signed-in teacher’s own week — what they have not written up yet',
    description:
      'The same report narrowed to the teacher on the session, never to a teacher named by the ' +
      'client. An account that is not a teacher gets an empty week rather than the school’s.',
  })
  myWeeklyCoverage(@Query() query: CoverageQueryDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.service.getMyWeeklyCoverage(query, actor);
  }

  @Get('entry-context')
  @RequirePermissions({ resource: 'behavior-logs', action: 'read' })
  @ApiQuery({ name: 'classroomId', required: true })
  @ApiQuery({ name: 'date', required: true, example: '2025-11-06' })
  @ApiOperation({
    summary: "The class's lessons on one date, plus its roster",
    description: 'What the entry form offers: a row must be filed against a timetabled lesson.',
  })
  entryContext(@Query('classroomId') classroomId: string, @Query('date') date: string) {
    return this.service.getEntryContext(classroomId, date);
  }

  @Get('tally/classroom/:classroomId/semester/:semesterId')
  @RequirePermissions({ resource: 'behavior-logs', action: 'read' })
  @ApiOperation({
    summary: 'Entry counts per student for one class over a semester, most-flagged first',
    description:
      'The whole term unless `from`, `to` or `subjectId` narrow it. Only students who appear ' +
      'in the register are returned — unlike the attendance summary, a student missing from ' +
      'this list is the good outcome.',
  })
  classroomTally(
    @Param('classroomId') classroomId: string,
    @Param('semesterId') semesterId: string,
    @Query() query: BehaviorTallyQueryDto,
  ) {
    return this.service.getClassroomTally(classroomId, semesterId, query);
  }

  @Post()
  @RequirePermissions({ resource: 'behavior-logs', action: 'create' })
  @ApiOperation({
    summary: 'File one row of the register',
    description:
      'Classroom, semester, subject, teacher and period are read off the lesson, never from ' +
      'the body. `entries` may be empty for a row that only records the state of the class, ' +
      'but a row that is empty on both counts is refused.',
  })
  create(
    @Body() dto: CreateBehaviorLogDto,
    @CurrentUser() actor: AuthenticatedUser,
    @ClientIp() ip: string | null,
  ) {
    return this.service.create(dto, actor, ip);
  }

  @Put(':groupId')
  @RequirePermissions({ resource: 'behavior-logs', action: 'update' })
  @ApiOperation({
    summary: 'Replace one row, keeping its identity',
    description:
      'Omitted fields keep what the row already says. The lesson and the date are not ' +
      'editable — changing either invalidates every field copied from the timetable.',
  })
  replace(
    @Param('groupId') groupId: string,
    @Body() dto: UpdateBehaviorLogDto,
    @CurrentUser() actor: AuthenticatedUser,
    @ClientIp() ip: string | null,
  ) {
    return this.service.replaceGroup(groupId, dto, actor, ip);
  }

  @Delete(':groupId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions({ resource: 'behavior-logs', action: 'delete' })
  @ApiOperation({ summary: 'Soft-delete one row and every record in it' })
  remove(
    @Param('groupId') groupId: string,
    @CurrentUser() actor: AuthenticatedUser,
    @ClientIp() ip: string | null,
  ) {
    return this.service.removeGroup(groupId, actor, ip);
  }
}
