import type { ReminderKind } from './reminders.service';

/**
 * When each reminder goes out.
 *
 * Five-field cron, read in `Asia/Vientiane` — the school's own clock, which has
 * no daylight saving, so these times mean what they say all year.
 *
 * The school teaches 15:10–16:55 (`schedule.dayStartTime` / `dayEndTime`), which
 * is why nothing here fires in the morning: a reminder that arrives before the
 * lessons it is about has nothing to report.
 *
 * Changing a time means editing this file and restarting the worker. That is
 * deliberate rather than a setting: BullMQ registers a repeatable job by its
 * pattern, so a schedule that could change underneath a running queue would
 * leave the old pattern firing alongside the new one until somebody noticed.
 */
export interface ReminderSchedule {
  kind: ReminderKind;
  /** Minute Hour Day-of-month Month Day-of-week. */
  pattern: string;
  /** What the pattern means, for whoever reads the log wondering why now. */
  why: string;
}

export const REMINDER_TIMEZONE = 'Asia/Vientiane';

export const REMINDER_SCHEDULE: ReminderSchedule[] = [
  {
    kind: 'attendance-gap',
    pattern: '30 17 * * 1-5',
    why: 'every teaching day, half an hour after the last lesson ends',
  },
  {
    // Thursday rather than Friday: the register is owed by the end of the week,
    // and a reminder on Friday evening arrives after the last chance to write it.
    kind: 'behavior-gap',
    pattern: '30 17 * * 4',
    why: 'Thursday evening, leaving Friday to catch up',
  },
  {
    // The two days the school already asks homeroom teachers to check their class.
    kind: 'homeroom-followup',
    pattern: '0 17 * * 3,5',
    why: 'Wednesday and Friday, as the school does it on paper',
  },
  {
    // Monday for Friday's review and Thursday for Wednesday's — the morning of the
    // day each one falls due, since the deadline is noon of the next working day.
    // Any later and the nag arrives after the day it is about has already been
    // counted missing, which makes it a reproach rather than a reminder.
    kind: 'homeroom-review-overdue',
    pattern: '0 9 * * 1,4',
    why: 'the morning a review falls due, before the noon deadline',
  },
  {
    // After the last lesson of the week, so the week it summarizes is complete.
    kind: 'homeroom-review-digest',
    pattern: '0 18 * * 5',
    why: 'Friday evening, to whoever holds the compliance report',
  },
];
