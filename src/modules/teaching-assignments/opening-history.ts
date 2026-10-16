import { LAO_UTC_OFFSET_MINUTES } from 'src/common/school-days/school-days';
import { toUtcMidnight } from '../lesson-plans/lesson-plan-weeks';

/** A schedule spell as stored — see `ScheduleSpell`. */
export interface OpeningSpell<P> {
  schedule: P[];
  from: Date;
  to: Date | null;
  changedBy: unknown;
  note: string | null;
}

/**
 * The history a lesson starts with when it begins after its term has opened.
 *
 * The reports owe a lesson on every day its schedule names, and a lesson with no
 * history has had its schedule since the start of term — which is right for the
 * timetable entered in the first week, and wrong for a lesson added in October:
 * every one of its weekdays since August came back as a roll call "never filed",
 * charged to a teacher who may not have been at the school. That is what the
 * 5 Oct 2026 revision did to nine lessons, and what every handover did to the
 * incoming teacher.
 *
 * So a lesson that starts later opens with an empty spell `[term start, start)`
 * — nothing owed — and its schedule from the day it starts. Starting on or before
 * the term opens returns no history at all, which reads exactly as before.
 *
 * Kept free of Mongoose and of the service so both writers — creating a lesson
 * and handing one over — build the same shape `slotsOn` reads.
 */
export function openingHistory<P>(args: {
  termStart: Date;
  startsOn: Date | string;
  schedule: P[];
  changedBy?: unknown;
  note?: string | null;
}): OpeningSpell<P>[] {
  const termStart = toUtcMidnight(args.termStart);
  const startsOn = toUtcMidnight(args.startsOn);
  if (startsOn <= termStart) return [];

  const changedBy = args.changedBy ?? null;
  const note = args.note?.trim() || null;
  return [
    { schedule: [], from: termStart, to: startsOn, changedBy, note },
    { schedule: args.schedule, from: startsOn, to: null, changedBy, note },
  ];
}

/**
 * The school's calendar day at `now`, as UTC midnight.
 *
 * `toUtcMidnight(new Date())` reads the day in UTC, which before 07:00 in
 * Vientiane is still yesterday — so a handover filed first thing on a Monday would
 * otherwise date the incoming teacher's lessons from the Sunday.
 */
export function schoolToday(now: Date = new Date()): Date {
  return toUtcMidnight(new Date(now.getTime() + LAO_UTC_OFFSET_MINUTES * 60_000));
}
