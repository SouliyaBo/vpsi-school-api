import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ClientIp, CurrentUser, RequirePermissions } from 'src/common/decorators';
import { CoverageQueryDto } from 'src/common/dto/coverage-query.dto';
import { TimelinessQueryDto } from 'src/common/dto/timeliness-query.dto';
import type { AuthenticatedUser } from 'src/common/interfaces/authenticated-user.interface';
import { AttendancesService } from './attendances.service';
import {
  AttendanceAbsenceRowDto,
  AttendanceSubjectSummaryDto,
  AttendanceSummaryDto,
  ClassAttendanceSummaryQueryDto,
  QueryAttendancesDto,
  RecordAttendanceDto,
  SemesterAbsencesQueryDto,
} from './dto/attendance.dto';

@ApiTags('attendances')
@ApiBearerAuth()
@Controller('attendances')
export class AttendancesController {
  constructor(private readonly service: AttendancesService) {}

  @Get()
  @RequirePermissions({ resource: 'attendances', action: 'read' })
  findAll(@Query() query: QueryAttendancesDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.service.findAll(query, actor);
  }

  @Get('daily-sheet')
  @RequirePermissions({ resource: 'attendances', action: 'read' })
  @ApiQuery({ name: 'classroomId', required: true })
  @ApiQuery({ name: 'date', required: true, example: '2025-09-15' })
  @ApiOperation({
    summary: 'Roll-call sheet for a class on one date',
    description:
      'Returns every lesson the class has that day, each with its subject, ' +
      'assigned teacher, time slot and the roster with anything already recorded.',
  })
  dailySheet(@Query('classroomId') classroomId: string, @Query('date') date: string) {
    return this.service.getDailySheet(classroomId, date);
  }

  @Get('coverage')
  @RequirePermissions({ resource: 'attendances', action: 'manage' })
  @ApiOperation({
    summary: 'Which teacher has not marked the roll',
    description:
      'Crosses the timetable with the roll call, so a lesson nobody marked shows as a gap — ' +
      'which the plain list cannot report, since it only holds records that exist. Defaults ' +
      'to this week and the term the window falls in, and is measured up to today, so a ' +
      'lesson later in the week is not yet owed. Unlike the behaviour register, attendance is ' +
      'owed once for every lesson day: a teacher who marked Monday and skipped Wednesday is ' +
      'reported behind, and the days they missed come back with the row. Rotating periods are ' +
      'left out: both arrangements of a swap are on the timetable, so it cannot say which ' +
      'teacher took which class. `manage` rather than `read`, because this is oversight of ' +
      'other people’s work — held by the administrator and the head of academic affairs.',
  })
  coverage(@Query() query: CoverageQueryDto) {
    return this.service.getCoverage(query);
  }

  @Get('timeliness')
  @RequirePermissions({ resource: 'attendances', action: 'manage' })
  @ApiOperation({
    summary: 'Who marks the roll late',
    description:
      'Not whether a lesson was written up but *when*. The deadline is the school’s own: noon ' +
      'of the next working day after the lesson, so Friday’s is due Monday noon and a lesson ' +
      'before ບຸນປີໃໝ່ is due at noon on the day the school comes back — weekends, holidays and ' +
      'the days the office closed all come from `calendarEvents`. The unit judged is one act ' +
      'per class per day, timed from the earliest `createdAt` of the rows it wrote, so a ' +
      'teacher of a large class is not reported as forty times as late as a teacher of a ' +
      'small one. Defaults to the active term to date. Rotating periods are left out, as in ' +
      'the coverage report. `manage` rather than `read`, because this names and ranks other ' +
      'people’s work — held by the administrator and the head of academic affairs.',
  })
  timeliness(@Query() query: TimelinessQueryDto) {
    return this.service.getTimeliness(query);
  }

  @Get('summary/student/:studentId/semester/:semesterId')
  @RequirePermissions({ resource: 'attendances', action: 'read' })
  @ApiOperation({
    summary: 'Absence/late/excused counts and attendance rate for a student',
    description:
      'Counts the whole term unless `month` or `from`/`to` narrows it — the month is the ' +
      "window the child's monthly mark card is read over. `subjectId` counts one subject's " +
      'lessons only.',
  })
  @ApiResponse({ status: 200, type: AttendanceSummaryDto })
  studentSummary(
    @Param('studentId') studentId: string,
    @Param('semesterId') semesterId: string,
    @Query() query: ClassAttendanceSummaryQueryDto,
  ) {
    return this.service.getStudentSummary(studentId, semesterId, undefined, query);
  }

  @Get('summary/student/:studentId/semester/:semesterId/by-subject')
  @RequirePermissions({ resource: 'attendances', action: 'read' })
  @ApiOperation({
    summary: 'The same counts for a student, split by subject',
    description:
      'Worst attendance first. With one lesson per school day a student can lose a whole ' +
      'subject while their overall rate stays healthy, which the overall summary hides.',
  })
  @ApiResponse({ status: 200, type: [AttendanceSubjectSummaryDto] })
  studentSubjectSummary(
    @Param('studentId') studentId: string,
    @Param('semesterId') semesterId: string,
  ) {
    return this.service.getStudentSubjectSummary(studentId, semesterId);
  }

  @Get('summary/classroom/:classroomId/semester/:semesterId')
  @RequirePermissions({ resource: 'attendances', action: 'read' })
  @ApiOperation({
    summary: 'The same summary for every student in a classroom',
    description:
      'Counts the whole term unless `month` or `from`/`to` narrows it — the month is what the ' +
      "monthly mark sheet prints. `subjectId` counts one subject's lessons only. Students with " +
      'nothing recorded are not listed.',
  })
  @ApiResponse({ status: 200, type: [AttendanceSummaryDto] })
  classroomSummary(
    @Param('classroomId') classroomId: string,
    @Param('semesterId') semesterId: string,
    @Query() query: ClassAttendanceSummaryQueryDto,
  ) {
    return this.service.getClassroomSummary(classroomId, semesterId, query);
  }

  @Get('summary/semester/:semesterId/absences')
  @RequirePermissions({ resource: 'attendances', action: 'read' })
  @ApiOperation({
    summary: 'Every student whose ວັນຂາດ have reached a threshold, across the school',
    description:
      'The class summary answers for one room; the office asks who is at 15 or 30 days in ' +
      'any room. Absences with and without a reason are added, under the same rule as every ' +
      'other summary (three lates are a day). Takes the same window as the class summary. ' +
      'Worst first, each with the room they were most recently marked in.',
  })
  @ApiResponse({ status: 200, type: [AttendanceAbsenceRowDto] })
  semesterAbsences(
    @Param('semesterId') semesterId: string,
    @Query() query: SemesterAbsencesQueryDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.service.getSemesterAbsences(semesterId, query, actor);
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  @RequirePermissions({ resource: 'attendances', action: 'create' })
  @ApiOperation({
    summary: 'Record attendance for a class on one date/period',
    description:
      'Idempotent — re-submitting a corrected roll call updates the existing records rather ' +
      'than duplicating them. Future dates and dates outside the semester are rejected.',
  })
  record(
    @Body() dto: RecordAttendanceDto,
    @CurrentUser() actor: AuthenticatedUser,
    @ClientIp() ip: string | null,
  ) {
    return this.service.record(dto, actor, ip);
  }
}
