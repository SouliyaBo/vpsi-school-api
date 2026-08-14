import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ExamLevel } from 'src/common/constants/enums';
import { ClientIp, CurrentUser, RequirePermissions } from 'src/common/decorators';
import type { AuthenticatedUser } from 'src/common/interfaces/authenticated-user.interface';
import {
  ApproveExamRegistrationDto,
  CreateExamRegistrationDto,
  EligibilityCheckDto,
  QueryExamRegistrationsDto,
  QueryExamResultsDto,
  RecordExamResultDto,
  RejectExamRegistrationDto,
} from './dto/exam.dto';
import { ExamsService } from './exams.service';

@ApiTags('exams')
@ApiBearerAuth()
@Controller('exams')
export class ExamsController {
  constructor(private readonly service: ExamsService) {}

  // ── Eligibility ───────────────────────────────────────────────────────────

  @Get('eligibility')
  @RequirePermissions({ resource: 'exams', action: 'read' })
  @ApiQuery({ name: 'studentId', required: true })
  @ApiQuery({ name: 'level', required: true, enum: ['m4', 'm7'] })
  @ApiQuery({ name: 'semesterId', required: false })
  @ApiOperation({
    summary: 'Check whether a student may sit an exam',
    description:
      'Returns the individual checks that failed, so a registrar can see why a student is ' +
      'blocked before attempting a registration.',
  })
  @ApiResponse({ status: 200, type: EligibilityCheckDto })
  checkEligibility(
    @Query('studentId') studentId: string,
    @Query('level') level: ExamLevel,
    @Query('semesterId') semesterId?: string,
  ) {
    return this.service.checkStudentEligibility(studentId, level, semesterId);
  }

  // ── Registrations ─────────────────────────────────────────────────────────

  @Get('registrations')
  @RequirePermissions({ resource: 'exams', action: 'read' })
  findRegistrations(
    @Query() query: QueryExamRegistrationsDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.service.findRegistrations(query, actor);
  }

  @Get('registrations/:id')
  @RequirePermissions({ resource: 'exams', action: 'read' })
  findRegistration(@Param('id') id: string) {
    return this.service.findRegistration(id);
  }

  @Post('registrations')
  @RequirePermissions({ resource: 'exams', action: 'create' })
  @ApiOperation({
    summary: 'Register a student for an M4/M7 exam',
    description:
      'Refused with 422 when the student fails eligibility. An authorized caller may pass ' +
      '`overrideIneligible` with a reason; the override is recorded on the registration ' +
      'snapshot and in the audit log.',
  })
  @ApiResponse({ status: 422, description: 'Not eligible; see `details.failedChecks`' })
  createRegistration(
    @Body() dto: CreateExamRegistrationDto,
    @CurrentUser() actor: AuthenticatedUser,
    @ClientIp() ip: string | null,
  ) {
    return this.service.createRegistration(dto, actor, ip);
  }

  @Post('registrations/:id/approve')
  @RequirePermissions({ resource: 'exams', action: 'approve' })
  @ApiOperation({ summary: 'Approve a registration and assign a seat number' })
  approve(
    @Param('id') id: string,
    @Body() dto: ApproveExamRegistrationDto,
    @CurrentUser() actor: AuthenticatedUser,
    @ClientIp() ip: string | null,
  ) {
    return this.service.approveRegistration(id, dto, actor, ip);
  }

  @Post('registrations/:id/reject')
  @RequirePermissions({ resource: 'exams', action: 'approve' })
  @ApiOperation({ summary: 'Reject a registration with a reason' })
  reject(
    @Param('id') id: string,
    @Body() dto: RejectExamRegistrationDto,
    @CurrentUser() actor: AuthenticatedUser,
    @ClientIp() ip: string | null,
  ) {
    return this.service.rejectRegistration(id, dto, actor, ip);
  }

  @Post('registrations/:id/cancel')
  @RequirePermissions({ resource: 'exams', action: 'update' })
  @ApiOperation({ summary: 'Cancel a registration' })
  cancel(
    @Param('id') id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @ClientIp() ip: string | null,
  ) {
    return this.service.cancelRegistration(id, actor, ip);
  }

  // ── Results ───────────────────────────────────────────────────────────────

  @Get('results')
  @RequirePermissions({ resource: 'exams', action: 'read' })
  findResults(@Query() query: QueryExamResultsDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.service.findResults(query, actor);
  }

  @Get('results/student/:studentId/level/:level')
  @RequirePermissions({ resource: 'exams', action: 'read' })
  @ApiOperation({
    summary: "A student's exam result",
    description: 'Unpublished results are visible only to holders of `exams:manage`.',
  })
  findResultForStudent(
    @Param('studentId') studentId: string,
    @Param('level') level: ExamLevel,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.service.findResultForStudent(studentId, level, actor);
  }

  @Post('results')
  @RequirePermissions({ resource: 'exams', action: 'create' })
  @ApiOperation({
    summary: 'Record an exam result',
    description:
      'Totals and pass/fail are computed from the per-subject marks, never taken from the ' +
      'request. Every subject must pass for the exam to pass. Idempotent per registration.',
  })
  recordResult(
    @Body() dto: RecordExamResultDto,
    @CurrentUser() actor: AuthenticatedUser,
    @ClientIp() ip: string | null,
  ) {
    return this.service.recordResult(dto, actor, ip);
  }

  @Post('results/publish')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions({ resource: 'exams', action: 'manage' })
  @ApiOperation({
    summary: 'Publish results for a school year and level',
    description: 'Makes results visible to students and notifies them and their guardians.',
  })
  publishResults(
    @Body() body: { schoolYearId: string; level: ExamLevel },
    @CurrentUser() actor: AuthenticatedUser,
    @ClientIp() ip: string | null,
  ) {
    return this.service.publishResults(body.schoolYearId, body.level, actor, ip);
  }
}
