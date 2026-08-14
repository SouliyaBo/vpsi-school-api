import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ClientIp, CurrentUser, RequirePermissions } from 'src/common/decorators';
import type { AuthenticatedUser } from 'src/common/interfaces/authenticated-user.interface';
import {
  BulkEnrollDto,
  BulkEnrollResultDto,
  ChangeEnrollmentStatusDto,
  CreateEnrollmentDto,
  QueryEnrollmentsDto,
} from './dto/enrollment.dto';
import { EnrollmentsService } from './enrollments.service';

@ApiTags('enrollments')
@ApiBearerAuth()
@Controller('enrollments')
export class EnrollmentsController {
  constructor(private readonly service: EnrollmentsService) {}

  @Get()
  @RequirePermissions({ resource: 'enrollments', action: 'read' })
  findAll(@Query() query: QueryEnrollmentsDto) {
    return this.service.findAll(query);
  }

  @Get('student/:studentId')
  @RequirePermissions({ resource: 'enrollments', action: 'read' })
  @ApiOperation({ summary: "A student's enrollment history across years" })
  findByStudent(@Param('studentId') studentId: string) {
    return this.service.findByStudent(studentId);
  }

  @Get('classroom/:classroomId/roster')
  @RequirePermissions({ resource: 'enrollments', action: 'read' })
  @ApiOperation({ summary: 'Active students in a classroom, in roll-number order' })
  roster(@Param('classroomId') classroomId: string) {
    return this.service.findClassRoster(classroomId);
  }

  @Get(':id')
  @RequirePermissions({ resource: 'enrollments', action: 'read' })
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  @RequirePermissions({ resource: 'enrollments', action: 'create' })
  @ApiOperation({
    summary: 'Enroll a student in a classroom',
    description:
      'Checks classroom capacity and rejects a second enrollment in the same school year. ' +
      'The enrollment and the classroom headcount are written in one transaction.',
  })
  @ApiResponse({ status: 409, description: 'Classroom full, or student already enrolled' })
  create(
    @Body() dto: CreateEnrollmentDto,
    @CurrentUser() actor: AuthenticatedUser,
    @ClientIp() ip: string | null,
  ) {
    return this.service.create(dto, { actor, ip });
  }

  @Post('bulk')
  @RequirePermissions({ resource: 'enrollments', action: 'create' })
  @ApiOperation({
    summary: 'Enroll up to 500 students by student code',
    description:
      'Each row is enrolled in its own transaction, so one bad row does not roll back the ' +
      'rest. The response lists every rejected row with its reason.',
  })
  @ApiResponse({ status: 201, type: BulkEnrollResultDto })
  bulkEnroll(
    @Body() dto: BulkEnrollDto,
    @CurrentUser() actor: AuthenticatedUser,
    @ClientIp() ip: string | null,
  ) {
    return this.service.bulkEnroll(dto, { actor, ip });
  }

  @Patch(':id/status')
  @RequirePermissions({ resource: 'enrollments', action: 'update' })
  @ApiOperation({
    summary: 'Change enrollment status',
    description:
      'Valid moves from `active`: transferred, promoted, dropped, repeated. A transfer ' +
      'creates the destination enrollment and adjusts both classroom counts atomically.',
  })
  changeStatus(
    @Param('id') id: string,
    @Body() dto: ChangeEnrollmentStatusDto,
    @CurrentUser() actor: AuthenticatedUser,
    @ClientIp() ip: string | null,
  ) {
    return this.service.changeStatus(id, dto, { actor, ip });
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions({ resource: 'enrollments', action: 'delete' })
  remove(
    @Param('id') id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @ClientIp() ip: string | null,
  ) {
    return this.service.remove(id, { actor, ip });
  }
}
