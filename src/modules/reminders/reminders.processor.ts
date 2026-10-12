import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { REMINDERS_QUEUE } from './reminders.constants';
import { RemindersService, type ReminderKind, type ReminderRun } from './reminders.service';

/**
 * Runs the reminders, in the worker container.
 *
 * One queue and one job name, with the kind in the payload: the three reminders
 * differ only in what they read, and three processors would be three places to
 * change when delivery changes.
 *
 * Errors are left to propagate. BullMQ retries the job, and a reminder that
 * silently swallowed a failed database read would report "0 teachers behind" —
 * the same thing a quiet week looks like, which is the one confusion this must
 * not create.
 */
@Processor(REMINDERS_QUEUE)
export class RemindersProcessor extends WorkerHost {
  private readonly logger = new Logger(RemindersProcessor.name);

  constructor(private readonly reminders: RemindersService) {
    super();
  }

  async process(job: Job<{ kind: ReminderKind }>): Promise<ReminderRun> {
    this.logger.log(`running ${job.data.kind}`);
    return this.reminders.run(job.data.kind);
  }
}
