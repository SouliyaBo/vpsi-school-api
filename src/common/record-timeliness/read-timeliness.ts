import { Types } from 'mongoose';
import type { TimelinessQueryDto } from '../dto/timeliness-query.dto';
import { loadCoverageAssignments } from '../lesson-coverage/coverage-assignments';
import type { SchoolDayCalendar } from '../school-days/school-days';
import {
  buildTimeliness,
  type RecordTimeliness,
  type TimelinessRule,
  type TimelinessWindow,
} from './record-timeliness';
import { loadWrittenLessons } from './written-lessons';

/**
 * The reads behind a punctuality report, shared by both logs.
 *
 * Unlike the coverage report — where each service keeps its own copy because the
 * two windows and the two loaders differ — the punctuality read is the same
 * sequence for both, down to the argument order: resolve the term, take the
 * calendar over the window, cross the timetable with the log. The only thing that
 * differs is `rule`. So it is written once, and the two services are a call each.
 *
 * Typed structurally rather than against the services, so this file stays out of
 * the module graph and the two modules do not have to depend on one another.
 */

interface TermDates {
  _id: Types.ObjectId;
  nameLo: string;
  nameEn?: string | null;
  startDate: Date;
  endDate: Date;
}

export interface TimelinessDeps {
  semesters: {
    findOne(id: string): Promise<TermDates>;
    findActive(): Promise<TermDates | null>;
    findForRange(from: Date, to: Date): Promise<TermDates | null>;
  };
  assignments: Parameters<typeof loadCoverageAssignments>[0];
  log: Parameters<typeof loadWrittenLessons>[0];
  calendar: { calendarFor(from: Date, to: Date): Promise<SchoolDayCalendar> };
}

/** `yyyy-MM-dd` → the UTC midnight a stored `date` is normalized to. */
const toUtcMidnight = (value: string | Date): Date => {
  const date = value instanceof Date ? value : new Date(value);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
};

export async function readTimeliness(
  deps: TimelinessDeps,
  query: TimelinessQueryDto,
  rule: TimelinessRule,
): Promise<RecordTimeliness> {
  const now = new Date();
  const today = toUtcMidnight(now);

  // A named term is honoured even when it is not the active one, so a head can
  // look back at a term that has closed. Otherwise the term is read off the dates
  // asked for, and only then off the active one — the same order the coverage
  // report resolves in, so the two reports cannot disagree about which term a
  // window belongs to.
  const semester = query.semesterId
    ? await deps.semesters.findOne(query.semesterId)
    : ((query.from || query.to
        ? await deps.semesters.findForRange(
            toUtcMidnight(query.from ?? query.to!),
            toUtcMidnight(query.to ?? query.from!),
          )
        : null) ?? (await deps.semesters.findActive()));

  /**
   * The term to date, when no range is given.
   *
   * Not the whole term: its end is weeks away for most of it, and counting a
   * lesson that has not been taught as one nobody wrote up would put the entire
   * staff in the report on the first day of every term.
   */
  const start = query.from
    ? toUtcMidnight(query.from)
    : semester
      ? toUtcMidnight(semester.startDate)
      : today;
  const requestedEnd = query.to ? toUtcMidnight(query.to) : today;
  const end = requestedEnd < start ? start : requestedEnd;

  const window: TimelinessWindow = {
    start,
    end,
    asOf: today < end ? today : end,
    semesterStart: semester ? toUtcMidnight(semester.startDate) : null,
    semesterEnd: semester ? toUtcMidnight(semester.endDate) : null,
  };

  const calendar = await deps.calendar.calendarFor(window.start, window.end);

  const assignments = semester
    ? await loadCoverageAssignments(deps.assignments, semester._id, {
        teacherId: query.teacherId,
        classroomId: query.classroomId,
      })
    : [];

  const written = await loadWrittenLessons(
    deps.log,
    assignments.map((assignment) => assignment.teachingAssignmentId),
    window.start,
    window.end,
  );

  return buildTimeliness(window, assignments, written, calendar, {
    rule,
    now,
    semester: semester
      ? { id: semester._id.toString(), nameLo: semester.nameLo, nameEn: semester.nameEn ?? null }
      : null,
  });
}
