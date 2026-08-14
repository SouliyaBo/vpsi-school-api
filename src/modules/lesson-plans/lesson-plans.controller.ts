import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseFilePipeBuilder,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ClientIp, CurrentUser, RequirePermissions } from 'src/common/decorators';
import type { AuthenticatedUser } from 'src/common/interfaces/authenticated-user.interface';
import { UPLOAD_RULES } from '../storage/storage.service';
import {
  CreateLessonPlanDto,
  MarkActivityCompletedDto,
  QueryComplianceDto,
  QueryLessonPlansDto,
  ReviewLessonPlanDto,
  UpdateLessonPlanDto,
} from './dto/lesson-plan.dto';
import { LessonPlansService } from './lesson-plans.service';

@ApiTags('lesson-plans')
@ApiBearerAuth()
@Controller('lesson-plans')
export class LessonPlansController {
  constructor(private readonly service: LessonPlansService) {}

  @Get()
  @RequirePermissions({ resource: 'lesson-plans', action: 'read' })
  @ApiOperation({ summary: 'List lesson plans' })
  findAll(@Query() query: QueryLessonPlansDto) {
    return this.service.findAll(query);
  }

  @Get('compliance')
  @RequirePermissions({ resource: 'lesson-plans', action: 'approve' })
  @ApiOperation({
    summary: 'Who owes a lesson plan, by department and week',
    description:
      'Crosses the timetable with the semester’s weeks and fills in the plans that exist, so a ' +
      'plan that was never written shows as a gap — which the plain list cannot report. ' +
      'Defaults to the active semester, from its start up to the current week.',
  })
  compliance(@Query() query: QueryComplianceDto) {
    return this.service.findCompliance(query);
  }

  @Get('review-queue')
  @RequirePermissions({ resource: 'lesson-plans', action: 'approve' })
  @ApiOperation({ summary: 'Plans awaiting review, earliest deadline first' })
  reviewQueue(@Query() query: QueryLessonPlansDto) {
    return this.service.findReviewQueue(query);
  }

  @Get(':id')
  @RequirePermissions({ resource: 'lesson-plans', action: 'read' })
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Get(':id/attachments')
  @RequirePermissions({ resource: 'lesson-plans', action: 'read' })
  @ApiOperation({ summary: 'Signed download URLs for the attachments' })
  attachments(@Param('id') id: string) {
    return this.service.getAttachmentUrls(id);
  }

  @Post()
  @RequirePermissions({ resource: 'lesson-plans', action: 'create' })
  @ApiOperation({
    summary: 'Create a lesson plan as a draft',
    description:
      'The plan is filed against the calling teacher — the owner is taken from the token, ' +
      'never from the request body.',
  })
  create(
    @Body() dto: CreateLessonPlanDto,
    @CurrentUser() actor: AuthenticatedUser,
    @ClientIp() ip: string | null,
  ) {
    return this.service.create(dto, actor, ip);
  }

  @Patch(':id')
  @RequirePermissions({ resource: 'lesson-plans', action: 'update' })
  @ApiOperation({
    summary: 'Edit a draft or returned plan',
    description: 'A plan under review or already approved cannot be edited.',
  })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateLessonPlanDto,
    @CurrentUser() actor: AuthenticatedUser,
    @ClientIp() ip: string | null,
  ) {
    return this.service.update(id, dto, actor, ip);
  }

  @Post(':id/submit')
  @RequirePermissions({ resource: 'lesson-plans', action: 'update' })
  @ApiOperation({
    summary: 'Submit a plan for review',
    description:
      'Lateness is determined at submission time and then fixed, so a later change to the ' +
      'deadline cannot make a late plan punctual. Notifies the academic heads.',
  })
  submit(
    @Param('id') id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @ClientIp() ip: string | null,
  ) {
    return this.service.submit(id, actor, ip);
  }

  @Post(':id/review')
  @RequirePermissions({ resource: 'lesson-plans', action: 'approve' })
  @ApiOperation({
    summary: 'Approve or return a plan',
    description: 'Returning requires a comment. The teacher is notified either way.',
  })
  review(
    @Param('id') id: string,
    @Body() dto: ReviewLessonPlanDto,
    @CurrentUser() actor: AuthenticatedUser,
    @ClientIp() ip: string | null,
  ) {
    return this.service.review(id, dto, actor, ip);
  }

  @Patch(':id/activities')
  @RequirePermissions({ resource: 'lesson-plans', action: 'update' })
  @ApiOperation({ summary: 'Mark a planned session as taught, with an optional reflection' })
  markActivity(
    @Param('id') id: string,
    @Body() dto: MarkActivityCompletedDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.service.markActivity(id, dto, actor);
  }

  @Post(':id/attachments')
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
  @ApiOperation({ summary: 'Attach a document (PDF/Word/Excel/image, max 20 MB)' })
  addAttachment(
    @Param('id') id: string,
    @UploadedFile(
      new ParseFilePipeBuilder()
        .addMaxSizeValidator({ maxSize: UPLOAD_RULES.document.maxBytes })
        .build({ fileIsRequired: true }),
    )
    file: Express.Multer.File,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.service.addAttachment(id, file, actor);
  }

  @Post('run-due-reminders')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions({ resource: 'lesson-plans', action: 'manage' })
  @ApiOperation({
    summary: 'Send deadline reminders now',
    description:
      'Notifies teachers of plans due within 48 hours or already overdue. Intended to be ' +
      'called by a daily scheduler; exposed so it can be triggered and tested by hand.',
  })
  runDueReminders() {
    return this.service.runDueReminders();
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions({ resource: 'lesson-plans', action: 'delete' })
  @ApiOperation({ summary: 'Delete a plan that has not been approved' })
  remove(
    @Param('id') id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @ClientIp() ip: string | null,
  ) {
    return this.service.remove(id, actor, ip);
  }
}
