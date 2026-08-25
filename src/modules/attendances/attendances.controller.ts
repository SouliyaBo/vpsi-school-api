import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ClientIp, CurrentUser, RequirePermissions } from 'src/common/decorators';
import { CoverageQueryDto } from 'src/common/dto/coverage-query.dto';
import type { AuthenticatedUser } from 'src/common/interfaces/authenticated-user.interface';
import { AttendancesService } from './attendances.service';
import {
  AttendanceSubjectSummaryDto,
  AttendanceSummaryDto,
  QueryAttendancesDto,
  RecordAttendanceDto,
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

  @Get('summary/student/:studentId/semester/:semesterId')
  @RequirePermissions({ resource: 'attendances', action: 'read' })
  @ApiOperation({ summary: 'Absence/late/excused counts and attendance rate for a student' })
  @ApiResponse({ status: 200, type: AttendanceSummaryDto })
  studentSummary(@Param('studentId') studentId: string, @Param('semesterId') semesterId: string) {
    return this.service.getStudentSummary(studentId, semesterId);
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
  @ApiOperation({ summary: 'The same summary for every student in a classroom' })
  @ApiResponse({ status: 200, type: [AttendanceSummaryDto] })
  classroomSummary(
    @Param('classroomId') classroomId: string,
    @Param('semesterId') semesterId: string,
  ) {
    return this.service.getClassroomSummary(classroomId, semesterId);
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
