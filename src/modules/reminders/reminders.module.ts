import { BullModule, InjectQueue } from '@nestjs/bullmq';
import { Logger, Module, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import type { Queue } from 'bullmq';
import {
  Classroom,
  ClassroomSchema,
  Role,
  RoleSchema,
  User,
  UserSchema,
} from 'src/database/schemas';
import { AttendancesModule } from '../attendances/attendances.module';
import { BehaviorLogsModule } from '../behavior-logs/behavior-logs.module';
import { HomeroomReviewsModule } from '../homeroom-reviews/homeroom-reviews.module';
import { REMINDER_JOB, REMINDERS_QUEUE } from './reminders.constants';
import { RemindersController } from './reminders.controller';
import { RemindersProcessor } from './reminders.processor';
import { REMINDER_SCHEDULE, REMINDER_TIMEZONE } from './reminders.schedule';
import { RemindersService } from './reminders.service';

/**
 * The reminders the school sends its teachers, and the clock that sends them.
 *
 * The repeatable jobs are registered at boot, keyed by their pattern, so
 * starting twice does not schedule twice; a pattern that has been edited leaves
 * the old job behind, which `removeOldRepeatables` clears out.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Classroom.name, schema: ClassroomSchema },
      { name: User.name, schema: UserSchema },
      // The weekly digest is addressed by permission rather than by role code —
      // see `RemindersService.reviewOverseers`.
      { name: Role.name, schema: RoleSchema },
    ]),
    BullModule.registerQueue({ name: REMINDERS_QUEUE }),
    AttendancesModule,
    BehaviorLogsModule,
    HomeroomReviewsModule,
  ],
  controllers: [RemindersController],
  providers: [RemindersService, RemindersProcessor],
  exports: [RemindersService],
})
export class RemindersModule implements OnModuleInit {
  private readonly logger = new Logger(RemindersModule.name);

  constructor(
    @InjectQueue(REMINDERS_QUEUE) private readonly queue: Queue,
    private readonly config: ConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    // Cleared either way: switching the schedule off has to actually stop the
    // jobs a previous boot registered, not just stop adding new ones. They live
    // in Redis and would otherwise keep firing with nobody having asked.
    await this.removeOldRepeatables();

    if (this.config.get<boolean>('REMINDERS_ENABLED') !== true) {
      this.logger.log('REMINDERS_ENABLED is not true — nothing is scheduled');
      return;
    }

    for (const entry of REMINDER_SCHEDULE) {
      await this.queue.add(
        REMINDER_JOB,
        { kind: entry.kind },
        {
          // The job id is the kind, so a second boot replaces rather than adds.
          repeat: { pattern: entry.pattern, tz: REMINDER_TIMEZONE },
          jobId: entry.kind,
          removeOnComplete: 50,
          removeOnFail: 50,
        },
      );
      this.logger.log(`${entry.kind}: ${entry.pattern} (${entry.why})`);
    }
  }

  /**
   * Drops repeatable jobs whose pattern is no longer in the schedule.
   *
   * Editing a time would otherwise leave the previous one running: BullMQ keys a
   * repeatable by its pattern, so a new pattern is a new job rather than a
   * changed one, and teachers would be reminded at both times.
   */
  private async removeOldRepeatables(): Promise<void> {
    // Nothing is wanted while the schedule is off, so every repeatable goes.
    const wanted =
      this.config.get<boolean>('REMINDERS_ENABLED') === true
        ? new Set(REMINDER_SCHEDULE.map((entry) => `${entry.kind}:${entry.pattern}`))
        : new Set<string>();

    for (const job of await this.queue.getRepeatableJobs()) {
      const kind = job.name === REMINDER_JOB ? job.id : null;
      if (kind && !wanted.has(`${kind}:${job.pattern ?? ''}`)) {
        await this.queue.removeRepeatableByKey(job.key);
        this.logger.log(`removed stale schedule ${kind}: ${job.pattern ?? '?'}`);
      }
    }
  }
}
