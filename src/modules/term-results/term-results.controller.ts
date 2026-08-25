import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ClientIp, CurrentUser, RequirePermissions } from 'src/common/decorators';
import type { AuthenticatedUser } from 'src/common/interfaces/authenticated-user.interface';
import {
  ComputeQueuedDto,
  ComputeTermResultsDto,
  QueryTermResultsDto,
} from './dto/term-result.dto';
import { TermResultsQueueService } from './term-results.queue';
import { TermResultsService } from './term-results.service';

@ApiTags('term-results')
@ApiBearerAuth()
@Controller('term-results')
export class TermResultsController {
  constructor(
    private readonly service: TermResultsService,
    private readonly queue: TermResultsQueueService,
  ) {}

  @Get()
  @RequirePermissions({ resource: 'term-results', action: 'read' })
  findAll(@Query() query: QueryTermResultsDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.service.findAll(query, actor);
  }

  @Get('student/:studentId/semester/:semesterId')
  @RequirePermissions({ resource: 'term-results', action: 'read' })
  @ApiOperation({
    summary: "A student's term result",
    description:
      'Unpublished results are visible only to holders of `term-results:manage`; everyone ' +
      'else gets 403 until the school publishes them.',
  })
  findForStudent(
    @Param('studentId') studentId: string,
    @Param('semesterId') semesterId: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.service.findForStudent(studentId, semesterId, actor);
  }

  @Get('ranking/classroom/:classroomId/semester/:semesterId')
  @RequirePermissions({ resource: 'term-results', action: 'read' })
  @ApiOperation({ summary: 'Class ranking (ties share a rank)' })
  ranking(@Param('classroomId') classroomId: string, @Param('semesterId') semesterId: string) {
    return this.service.getClassRanking(classroomId, semesterId);
  }

  @Post('compute')
  @HttpCode(HttpStatus.ACCEPTED)
  @RequirePermissions({ resource: 'term-results', action: 'manage' })
  @ApiOperation({
    summary: 'Queue term-result computation for a classroom',
    description:
      'Runs as a background job: it reads every score for the class, applies the grading ' +
      'formulas, then ranks the cohort. Returns a job id to poll. Re-requesting the same ' +
      'classroom while a job is pending reuses that job rather than computing twice.',
  })
  @ApiResponse({ status: 202, type: ComputeQueuedDto })
  async compute(
    @Body() dto: ComputeTermResultsDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<ComputeQueuedDto> {
    const jobId = await this.queue.enqueueClassroom({
      classroomId: dto.classroomId,
      semesterId: dto.semesterId,
      requestedBy: { sub: actor.sub, username: actor.username },
    });

    return { jobId, classroomId: dto.classroomId, semesterId: dto.semesterId, status: 'queued' };
  }

  @Get('compute/:jobId')
  @RequirePermissions({ resource: 'term-results', action: 'manage' })
  @ApiOperation({ summary: 'Status and result of a computation job' })
  async jobStatus(@Param('jobId') jobId: string) {
    const status = await this.queue.getJobStatus(jobId);
    if (!status) throw new NotFoundException(`No job with id "${jobId}"`);
    return status;
  }

  @Post('compute-sync')
  @RequirePermissions({ resource: 'term-results', action: 'manage' })
  @ApiOperation({
    summary: 'Compute synchronously (small classes, and integration tests)',
    description:
      'Bypasses the queue and returns the summary directly. Use the queued endpoint for ' +
      'anything large — this one holds the request open for the whole computation. A ' +
      'published result whose figures the recomputation moves is withdrawn rather than ' +
      'overwritten in place, and counted in `withdrawn`; one that comes out identical stays ' +
      'published.',
  })
  computeSync(@Body() dto: ComputeTermResultsDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.service.computeForClassroom(dto.classroomId, dto.semesterId, actor);
  }

  @Post('publish')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions({ resource: 'term-results', action: 'manage' })
  @ApiOperation({
    summary: 'Publish a classroom’s results',
    description:
      'Two kinds of result are withheld and reported in `withheld`: provisional ones, ' +
      'computed from marks that are not all in, and stale ones, where a mark has changed ' +
      'since the result was computed. Recompute the class first to release those.',
  })
  publish(
    @Body() dto: ComputeTermResultsDto,
    @CurrentUser() actor: AuthenticatedUser,
    @ClientIp() ip: string | null,
  ) {
    return this.service.publish(dto.classroomId, dto.semesterId, actor, ip);
  }
}
