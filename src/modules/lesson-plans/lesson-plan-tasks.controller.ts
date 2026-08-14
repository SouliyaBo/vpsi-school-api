import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ParseFilePipeBuilder } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ClientIp, CurrentUser, RequirePermissions } from 'src/common/decorators';
import type { AuthenticatedUser } from 'src/common/interfaces/authenticated-user.interface';
import { UPLOAD_RULES } from '../storage/storage.service';
import {
  DraftLessonPlanMonthDto,
  QueryLessonPlanMonthsDto,
  QueryLessonPlanTasksDto,
  RemoveLessonPlanTasksDto,
  UpdateLessonPlanMonthDto,
  UpdateLessonPlanTaskDto,
} from './dto/lesson-plan-task.dto';
import { LessonPlanTasksService } from './lesson-plan-tasks.service';

/**
 * The monthly checklist, from the academic office's side.
 *
 * Managing a month needs `approve` rather than `create`: deciding what the school
 * owes is the academic head's job, and it is the same authority that reviews what
 * comes back. A teacher holds `create`/`update` on lesson plans and must not be
 * able to shorten their own list.
 */
@ApiTags('lesson-plan-months')
@ApiBearerAuth()
@Controller('lesson-plan-months')
export class LessonPlanMonthsController {
  constructor(private readonly service: LessonPlanTasksService) {}

  @Get()
  @RequirePermissions({ resource: 'lesson-plans', action: 'read' })
  @ApiOperation({
    summary: 'Months that have a checklist',
    description: 'A teacher sees published months only — a draft is the office’s working copy.',
  })
  findAll(@Query() query: QueryLessonPlanMonthsDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.service.findMonths(query, actor);
  }

  @Post('draft')
  @RequirePermissions({ resource: 'lesson-plans', action: 'approve' })
  @ApiOperation({
    summary: 'Draft a month from the timetable',
    description:
      'Creates one line per teaching assignment per week whose Monday falls in the month. ' +
      'Additive and repeatable: it fills in what is missing and never removes a line, so ' +
      'trim after drafting rather than before.',
  })
  draft(
    @Body() dto: DraftLessonPlanMonthDto,
    @CurrentUser() actor: AuthenticatedUser,
    @ClientIp() ip: string | null,
  ) {
    return this.service.draftMonth(dto, actor, ip);
  }

  @Get(':id')
  @RequirePermissions({ resource: 'lesson-plans', action: 'read' })
  @ApiOperation({
    summary: 'One month’s checklist, with what has been handed in',
    description: 'A teacher gets their own lines; the office gets the whole school’s.',
  })
  findOne(
    @Param('id') id: string,
    @Query() query: QueryLessonPlanTasksDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.service.checklist(id, actor, query);
  }

  @Patch(':id')
  @RequirePermissions({ resource: 'lesson-plans', action: 'approve' })
  @ApiOperation({ summary: 'Set the instruction shown to teachers on the list' })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateLessonPlanMonthDto,
    @CurrentUser() actor: AuthenticatedUser,
    @ClientIp() ip: string | null,
  ) {
    return this.service.setNote(id, dto.note, actor, ip);
  }

  @Post(':id/publish')
  @RequirePermissions({ resource: 'lesson-plans', action: 'approve' })
  @ApiOperation({
    summary: 'Publish the month to its teachers',
    description:
      'One-way, and notifies every teacher with lines on it. Teachers act on what they were ' +
      'told, so a list that could be pulled back is one they could not rely on.',
  })
  publish(
    @Param('id') id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @ClientIp() ip: string | null,
  ) {
    return this.service.publish(id, actor, ip);
  }

  @Post(':id/remove-tasks')
  @RequirePermissions({ resource: 'lesson-plans', action: 'approve' })
  @ApiOperation({
    summary: 'Drop lines that are not owed — an exam week, a holiday, a teacher on leave',
    description: 'Refused for a line a plan has already been handed in against.',
  })
  removeTasks(
    @Param('id') id: string,
    @Body() dto: RemoveLessonPlanTasksDto,
    @CurrentUser() actor: AuthenticatedUser,
    @ClientIp() ip: string | null,
  ) {
    return this.service.removeTasks(id, dto.taskIds, actor, ip);
  }
}

@ApiTags('lesson-plan-tasks')
@ApiBearerAuth()
@Controller('lesson-plan-tasks')
export class LessonPlanTasksController {
  constructor(private readonly service: LessonPlanTasksService) {}

  @Patch(':id')
  @RequirePermissions({ resource: 'lesson-plans', action: 'approve' })
  @ApiOperation({ summary: 'Move one line’s deadline off the standing policy' })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateLessonPlanTaskDto,
    @CurrentUser() actor: AuthenticatedUser,
    @ClientIp() ip: string | null,
  ) {
    return this.service.setTaskDueDate(id, dto.dueDate!, actor, ip);
  }

  @Post(':id/upload')
  @RequirePermissions({ resource: 'lesson-plans', action: 'update' })
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { file: { type: 'string', format: 'binary' } },
      required: ['file'],
    },
  })
  @ApiOperation({
    summary: 'Hand a document in against a line',
    description:
      'Creates the plan for the week if there is none, attaches the document and submits it in ' +
      'one action — the file is the plan on this path. Only the teacher who owes the line may ' +
      'use it. PDF/Word/Excel/PowerPoint/image, max 20 MB.',
  })
  upload(
    @Param('id') id: string,
    @UploadedFile(
      new ParseFilePipeBuilder()
        .addMaxSizeValidator({ maxSize: UPLOAD_RULES.document.maxBytes })
        .build({ fileIsRequired: true }),
    )
    file: Express.Multer.File,
    @CurrentUser() actor: AuthenticatedUser,
    @ClientIp() ip: string | null,
  ) {
    return this.service.uploadAgainstTask(id, file, actor, ip);
  }
}
