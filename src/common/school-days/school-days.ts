import { CalendarEventType, DEFAULT_DAY_EFFECT, SchoolDayEffect } from '../constants/enums';
import { toUtcMidnight } from '../../modules/lesson-plans/lesson-plan-weeks';

/**
 * The school's working year, read off the calendar.
 *
 * Every module that counts days had been counting calendar days: the roll-call
 * coverage report expected a lesson on every timetabled weekday of a window, and
 * so reported a school-wide gap for the week of ບຸນປີໃໝ່. What was missing is not
 * a smarter count but the one fact the count needs — which days the school
 * actually works — and that fact belongs in exactly one place, because a second
 * idea of when the school is shut is a second thing to get wrong.
 *
 * That place is `calendarEvents`, which the office maintains, and this file is how
 * the rest of the system asks it. Kept free of Mongoose so the rules can be tested
 * against a hand-written list of events; the service alongside does the reads.
 *
 * Two questions are asked of it, and they are not the same question:
 *
 * - **was a lesson owed?** — `isTeachingDay`. False on a weekend, a holiday, a
 *   Teacher PD day ("no school for students") and an exam period, because on none
 *   of those does the timetable run.
 * - **when could a teacher have written it up?** — `isWorkingDay`. True on a PD
 *   day and in an exam week: the staff are in the building. This is what a
 *   deadline may fall on, and the distinction is the difference between giving a
 *   teacher until Monday noon and giving them until Tuesday.
 */

/** Saturday and Sunday. Every timetable slot on file is `dayOfWeek` 1–5. */
export const DEFAULT_WEEKEND_DAYS: readonly number[] = [0, 6];

/**
 * Asia/Vientiane, which is UTC+7 and has never observed daylight saving.
 *
 * A fixed offset rather than a timezone database lookup: the offset has one value
 * for the whole of the school's history, and `Intl` would make every day
 * classification a formatting call.
 */
export const LAO_UTC_OFFSET_MINUTES = 420;

const MS_PER_DAY = 86_400_000;
const MS_PER_MINUTE = 60_000;

/** What a day is, once the calendar has been read over it. */
export type DayState =
  /** Lessons run; the roll call and the behaviour register are owed. */
  | 'teaching'
  /** Staff in, timetable suspended — Teacher PD, exam periods. */
  | 'no_classes'
  /** Shut. */
  | 'closed'
  /** Shut, and shut every week — Saturday and Sunday. */
  | 'weekend'
  /** Outside the school year altogether. */
  | 'out_of_year';

/** The part of a calendar event a day classification depends on. */
export interface SchoolDayEvent {
  id?: string;
  titleLo: string;
  titleEn?: string | null;
  type: CalendarEventType;
  /** Omitted falls back to the type's default, for a row written before the field. */
  dayEffect?: SchoolDayEffect | null;
  startDate: Date | string;
  /** Inclusive. */
  endDate: Date | string;
  isHalfDay?: boolean;
}

/** One day of the year, and what the calendar says about it. */
export interface SchoolDay {
  /** `yyyy-MM-dd`. */
  date: string;
  state: DayState;
  /** `state === 'teaching'` — whether the timetable ran. */
  isTeachingDay: boolean;
  /** Whether staff were in, so a write-up could have been made. */
  isWorkingDay: boolean;
  isHalfDay: boolean;
  /**
   * The events covering the day, most restrictive first.
   *
   * Carried so a report can say *why* a day was not counted. "3 of 5 lessons
   * missing" invites an argument; "the school was shut for ບຸນທາດຫຼວງ" ends one.
   */
  events: SchoolDayEvent[];
}

export interface SchoolDayOptions {
  /** Defaults to Saturday and Sunday. */
  weekendDays?: readonly number[];
  /** When given, a date outside the range is `out_of_year`. */
  yearStart?: Date | string | null;
  yearEnd?: Date | string | null;
}

/** `yyyy-MM-dd` of a UTC-midnight date. */
export function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Most restrictive wins, so one closing event shuts a day other events share. */
const EFFECT_RANK: Record<SchoolDayEffect, number> = { closed: 2, no_classes: 1, open: 0 };

function effectOf(event: SchoolDayEvent): SchoolDayEffect {
  return event.dayEffect ?? DEFAULT_DAY_EFFECT[event.type] ?? 'open';
}

/**
 * The days an event covers, `yyyy-MM-dd`.
 *
 * `endDate` is inclusive: `17 Dec – 5 Jan` is twenty days shut, and an exclusive
 * end would quietly reopen the school on 5 January.
 */
function eventDays(event: SchoolDayEvent): string[] {
  const start = toUtcMidnight(event.startDate);
  const end = toUtcMidnight(event.endDate);
  if (end < start) return [dayKey(start)];

  const days: string[] = [];
  for (let cursor = start; cursor <= end; cursor = new Date(cursor.getTime() + MS_PER_DAY)) {
    days.push(dayKey(cursor));
  }
  return days;
}

/**
 * The calendar, indexed by day.
 *
 * Built once per request from one read of the events overlapping the range the
 * caller cares about, then asked about individual days — the alternative is a
 * query per day, and the reports ask about a term at a time.
 */
export class SchoolDayCalendar {
  private readonly byDay = new Map<string, SchoolDayEvent[]>();
  private readonly weekendDays: readonly number[];
  private readonly yearStart: Date | null;
  private readonly yearEnd: Date | null;

  constructor(events: SchoolDayEvent[], options: SchoolDayOptions = {}) {
    this.weekendDays = options.weekendDays ?? DEFAULT_WEEKEND_DAYS;
    this.yearStart = options.yearStart ? toUtcMidnight(options.yearStart) : null;
    this.yearEnd = options.yearEnd ? toUtcMidnight(options.yearEnd) : null;

    for (const event of events) {
      for (const key of eventDays(event)) {
        const existing = this.byDay.get(key);
        if (existing) existing.push(event);
        else this.byDay.set(key, [event]);
      }
    }

    for (const list of this.byDay.values()) {
      list.sort((a, b) => EFFECT_RANK[effectOf(b)] - EFFECT_RANK[effectOf(a)]);
    }
  }

  /** What the calendar says about one day. */
  classify(input: Date | string): SchoolDay {
    const date = toUtcMidnight(input);
    const key = dayKey(date);
    const events = this.byDay.get(key) ?? [];
    const isHalfDay = events.some((event) => event.isHalfDay === true);

    const outOfYear =
      (this.yearStart !== null && date < this.yearStart) ||
      (this.yearEnd !== null && date > this.yearEnd);

    // Order matters. A holiday listed on a Sunday is still reported as a weekend,
    // because "the school was shut on Sunday" is not a fact anybody needs told;
    // and the year's bounds come first because a date outside them is not a day
    // this calendar has an opinion about at all.
    let state: DayState;
    if (outOfYear) state = 'out_of_year';
    else if (this.weekendDays.includes(date.getUTCDay())) state = 'weekend';
    else {
      const worst = events.length > 0 ? effectOf(events[0]) : 'open';
      state = worst === 'closed' ? 'closed' : worst === 'no_classes' ? 'no_classes' : 'teaching';
    }

    return {
      date: key,
      state,
      isTeachingDay: state === 'teaching',
      isWorkingDay: state === 'teaching' || state === 'no_classes',
      isHalfDay,
      events,
    };
  }

  isTeachingDay(input: Date | string): boolean {
    return this.classify(input).isTeachingDay;
  }

  isWorkingDay(input: Date | string): boolean {
    return this.classify(input).isWorkingDay;
  }

  /** Every day of an inclusive range, classified. */
  range(from: Date | string, to: Date | string): SchoolDay[] {
    const start = toUtcMidnight(from);
    const end = toUtcMidnight(to);
    const days: SchoolDay[] = [];
    for (let cursor = start; cursor <= end; cursor = new Date(cursor.getTime() + MS_PER_DAY)) {
      days.push(this.classify(cursor));
    }
    return days;
  }

  /** The `yyyy-MM-dd` of every day in the range the timetable did not run on. */
  nonTeachingDays(from: Date | string, to: Date | string): Set<string> {
    const keys = new Set<string>();
    for (const day of this.range(from, to)) {
      if (!day.isTeachingDay) keys.add(day.date);
    }
    return keys;
  }

  /**
   * The next day staff are in, strictly after `input`.
   *
   * `null` rather than a guess when none is found inside `limitDays`: the summer
   * break is seven weeks, and a calendar that has not been filled in past it has
   * no next working day to give. A caller that gets `null` has to say so, which is
   * the honest answer — the alternative is a deadline invented out of an empty
   * calendar and a teacher marked late against it.
   */
  nextWorkingDay(input: Date | string, limitDays = 60): Date | null {
    let cursor = new Date(toUtcMidnight(input).getTime() + MS_PER_DAY);
    for (let step = 0; step < limitDays; step += 1) {
      const day = this.classify(cursor);
      if (day.isWorkingDay) return cursor;
      cursor = new Date(cursor.getTime() + MS_PER_DAY);
    }
    return null;
  }

  /** As `nextWorkingDay`, but the next day the timetable actually runs. */
  nextTeachingDay(input: Date | string, limitDays = 60): Date | null {
    let cursor = new Date(toUtcMidnight(input).getTime() + MS_PER_DAY);
    for (let step = 0; step < limitDays; step += 1) {
      if (this.isTeachingDay(cursor)) return cursor;
      cursor = new Date(cursor.getTime() + MS_PER_DAY);
    }
    return null;
  }

  /** How many days of an inclusive range the timetable ran on. */
  countTeachingDays(from: Date | string, to: Date | string): number {
    return this.range(from, to).filter((day) => day.isTeachingDay).length;
  }
}

/**
 * The instant a lesson's paperwork stops being on time.
 *
 * Noon, Vientiane time, of the next working day after the lesson — the rule the
 * school set, and the reason it is not "the same day" is that nobody marks a
 * register at the moment the bell goes. A Friday lesson is therefore due Monday
 * noon and not Saturday noon, and a lesson on the day before ບຸນປີໃໝ່ is due at
 * noon on the day the school comes back.
 *
 * The deadline lands on the next **working** day rather than the next teaching
 * one: on a PD day and in an exam week the staff are in the building and can write
 * up Friday's roll call, so those days count against the clock.
 *
 * Returns a UTC instant, directly comparable with a document's `createdAt`.
 * `null` when the calendar has no next working day — see `nextWorkingDay`.
 */
export function recordingDeadline(
  lessonDate: Date | string,
  calendar: SchoolDayCalendar,
  options: { hour?: number; offsetMinutes?: number; limitDays?: number } = {},
): Date | null {
  const hour = options.hour ?? 12;
  const offsetMinutes = options.offsetMinutes ?? LAO_UTC_OFFSET_MINUTES;

  const due = calendar.nextWorkingDay(lessonDate, options.limitDays);
  if (!due) return null;

  // `due` is UTC midnight standing for a local calendar day, so local noon is
  // `hour` hours into it less the zone's offset from UTC.
  return new Date(due.getTime() + hour * 3_600_000 - offsetMinutes * MS_PER_MINUTE);
}

/**
 * How late a write-up was, in hours past its deadline — `0` when it was on time.
 *
 * One decimal, because the number is read as "about a day and a half late" and
 * not to the minute.
 */
export function hoursLate(createdAt: Date | string, deadline: Date): number {
  const written = createdAt instanceof Date ? createdAt : new Date(createdAt);
  const diff = written.getTime() - deadline.getTime();
  if (diff <= 0) return 0;
  return Math.round((diff / 3_600_000) * 10) / 10;
}
