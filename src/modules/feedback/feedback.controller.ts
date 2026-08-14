import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { ClientIp, CurrentUser, RequirePermissions } from 'src/common/decorators';
import type { AuthenticatedUser } from 'src/common/interfaces/authenticated-user.interface';
import {
  QueryFeedbackDto,
  RespondFeedbackDto,
  SubmitFeedbackDto,
  UpdateFeedbackStatusDto,
} from './dto/feedback.dto';
import { FeedbackService } from './feedback.service';

@ApiTags('feedback')
@ApiBearerAuth()
@Controller('feedback')
export class FeedbackController {
  constructor(private readonly service: FeedbackService) {}

  @Post()
  // Modest limit: feedback is written by hand, so a burst is either a mistake or
  // an attempt to flood the queue.
  @Throttle({ default: { limit: 5, ttl: 300_000 } })
  @RequirePermissions({ resource: 'feedback', action: 'create' })
  @ApiOperation({
    summary: 'Submit feedback',
    description:
      'With `isAnonymous`, no identifying data is stored at all — not the user id, not the ' +
      'IP, and not in the audit log. Anonymous submissions receive no response notification.',
  })
  submit(
    @Body() dto: SubmitFeedbackDto,
    @CurrentUser() actor: AuthenticatedUser,
    @ClientIp() ip: string | null,
  ) {
    return this.service.submit(dto, actor, ip);
  }

  @Get('mine')
  @ApiOperation({
    summary: 'Your own submissions',
    description: 'Anonymous submissions do not appear here — by design, they are untraceable.',
  })
  findMine(@CurrentUser('sub') userId: string, @Query() query: QueryFeedbackDto) {
    return this.service.findMine(userId, query);
  }

  @Get()
  @RequirePermissions({ resource: 'feedback', action: 'read' })
  @ApiOperation({ summary: 'All feedback, for the administrator inbox' })
  findAll(@Query() query: QueryFeedbackDto) {
    return this.service.findAll(query);
  }

  @Get('summary')
  @RequirePermissions({ resource: 'feedback', action: 'read' })
  @ApiOperation({ summary: 'Counts per status' })
  summary() {
    return this.service.getSummary();
  }

  @Get(':id')
  @RequirePermissions({ resource: 'feedback', action: 'read' })
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post(':id/read')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions({ resource: 'feedback', action: 'update' })
  @ApiOperation({ summary: 'Mark as read (no-op if already read or resolved)' })
  markRead(@Param('id') id: string) {
    return this.service.markRead(id);
  }

  @Post(':id/respond')
  @RequirePermissions({ resource: 'feedback', action: 'update' })
  @ApiOperation({
    summary: 'Respond and resolve',
    description: 'Notifies the submitter, unless the submission was anonymous.',
  })
  respond(
    @Param('id') id: string,
    @Body() dto: RespondFeedbackDto,
    @CurrentUser() actor: AuthenticatedUser,
    @ClientIp() ip: string | null,
  ) {
    return this.service.respond(id, dto, actor, ip);
  }

  @Patch(':id/status')
  @RequirePermissions({ resource: 'feedback', action: 'update' })
  @ApiOperation({ summary: 'Change the status without responding' })
  updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateFeedbackStatusDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.service.updateStatus(id, dto.status, actor);
  }
}
