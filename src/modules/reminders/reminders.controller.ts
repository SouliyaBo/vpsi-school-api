import { Controller, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from 'src/common/decorators';
import { RemindersService, type ReminderKind } from './reminders.service';

const KINDS: ReminderKind[] = [
  'attendance-gap',
  'behavior-gap',
  'homeroom-followup',
  'homeroom-review-overdue',
  'homeroom-review-digest',
];

/**
 * Firing a reminder by hand.
 *
 * The schedule sends these on its own; this is for the day the office wants one
 * now — the evening before an inspection, or to see what a reminder looks like
 * before trusting it to a cron nobody is watching.
 *
 * `notifications:manage`, because this messages other people's phones.
 */
@ApiTags('reminders')
@ApiBearerAuth()
@Controller('reminders')
export class RemindersController {
  constructor(private readonly reminders: RemindersService) {}

  @Post('run/:kind')
  @RequirePermissions({ resource: 'notifications', action: 'manage' })
  @ApiOperation({
    summary: 'Send one reminder now',
    description: `One of: ${KINDS.join(', ')}. Runs synchronously and reports what it did.`,
  })
  run(@Param('kind') kind: ReminderKind) {
    return this.reminders.run(kind);
  }
}
