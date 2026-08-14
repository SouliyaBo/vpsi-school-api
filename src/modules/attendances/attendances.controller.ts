import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ClientIp, CurrentUser, RequirePermissions } from 'src/common/decorators';
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
    summary: "Roll-call sheet for a class on one date",
    description:
      'Returns every lesson the class has that day, each with its subject, ' +
      'assigned teacher, time slot and the roster with anything already recorded.',
  })
  dailySheet(@Query('classroomId') classroomId: string, @Query('date') date: string) {
    return this.service.getDailySheet(classroomId, date);
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
