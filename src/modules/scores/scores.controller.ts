import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ClientIp, CurrentUser, RequirePermissions } from 'src/common/decorators';
import type { AuthenticatedUser } from 'src/common/interfaces/authenticated-user.interface';
import {
  BatchSaveResultDto,
  BatchSaveScoresDto,
  LockScoresDto,
  QueryScoresDto,
  UnlockScoresDto,
} from './dto/score.dto';
import { ScoresService } from './scores.service';

@ApiTags('scores')
@ApiBearerAuth()
@Controller('scores')
export class ScoresController {
  constructor(private readonly service: ScoresService) {}

  @Get()
  @RequirePermissions({ resource: 'scores', action: 'read' })
  findAll(@Query() query: QueryScoresDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.service.findAll(query, actor);
  }

  @Get('entry-grid')
  @RequirePermissions({ resource: 'scores', action: 'read' })
  @ApiOperation({
    summary: 'Grade-entry grid for a component and classroom',
    description:
      'Returns every actively enrolled student in roll-number order, including those with ' +
      'no mark recorded yet, so the client can render the full grid in one request.',
  })
  entryGrid(@Query('componentId') componentId: string, @Query('classroomId') classroomId: string) {
    return this.service.getEntryGrid(componentId, classroomId);
  }

  @Get('student/:studentId/semester/:semesterId')
  @RequirePermissions({ resource: 'scores', action: 'read' })
  @ApiOperation({ summary: "All of a student's scores for a semester" })
  studentScores(
    @Param('studentId') studentId: string,
    @Param('semesterId') semesterId: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.service.findStudentScores(studentId, semesterId, actor);
  }

  @Post('batch')
  @RequirePermissions({ resource: 'scores', action: 'create' })
  @ApiOperation({
    summary: 'Save marks for up to 200 students at once',
    description:
      'Only the teacher assigned to this subject and classroom may enter marks; holders of ' +
      '`scores:manage` may act on any class. Amending a locked score requires ' +
      '`overrideReason`, and each amendment is audited individually with that reason.',
  })
  @ApiResponse({ status: 201, type: BatchSaveResultDto })
  @ApiResponse({ status: 403, description: 'Caller is not the assigned teacher' })
  @ApiResponse({ status: 409, description: 'Scores are locked and no override reason was given' })
  batchSave(
    @Body() dto: BatchSaveScoresDto,
    @CurrentUser() actor: AuthenticatedUser,
    @ClientIp() ip: string | null,
  ) {
    return this.service.batchSave(dto, actor, ip);
  }

  @Post('lock')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions({ resource: 'scores', action: 'update' })
  @ApiOperation({
    summary: 'Submit and lock the marks for a component in a classroom',
    description:
      'Locks both the existing scores and the component itself, so no further marks can be ' +
      'added without an explicit unlock.',
  })
  lock(
    @Body() dto: LockScoresDto,
    @CurrentUser() actor: AuthenticatedUser,
    @ClientIp() ip: string | null,
  ) {
    return this.service.lock(dto, actor, ip);
  }

  @Post('unlock')
  @HttpCode(HttpStatus.OK)
  // Deliberately stricter than `update`: reopening submitted grades is an
  // administrative act, not part of normal teaching.
  @RequirePermissions({ resource: 'scores', action: 'manage' })
  @ApiOperation({
    summary: 'Lift a score lock',
    description: 'Requires `scores:manage` and a reason of at least 10 characters, both audited.',
  })
  unlock(
    @Body() dto: UnlockScoresDto,
    @CurrentUser() actor: AuthenticatedUser,
    @ClientIp() ip: string | null,
  ) {
    return this.service.unlock(dto, actor, ip);
  }
}
