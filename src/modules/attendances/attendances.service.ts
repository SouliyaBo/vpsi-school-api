import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import { AttendanceStatus } from 'src/common/constants/enums';
import { CoverageQueryDto } from 'src/common/dto/coverage-query.dto';
import { TimelinessQueryDto } from 'src/common/dto/timeliness-query.dto';
import { readTimeliness } from 'src/common/record-timeliness/read-timeliness';
import type { RecordTimeliness } from 'src/common/record-timeliness/record-timeliness';
import { PaginatedResponse } from 'src/common/dto/pagination.dto';
import { AppException } from 'src/common/exceptions/app.exception';
import type { AuthenticatedUser } from 'src/common/interfaces/authenticated-user.interface';
import { LessonAccessService } from 'src/common/lesson-access/lesson-access.service';
import { periodsOnDate, substitutionKey } from 'src/common/lesson-access/lesson-write-access';
import { loadCoverageAssignments } from 'src/common/lesson-coverage/coverage-assignments';
import {
  buildCoverage,
  dayWindow,
  resolveCoverageSemester,
  weekWindow,
  withRows,
  type CoverageWindow,
  type CoverageWritten,
  type LessonCoverage,
} from 'src/common/lesson-coverage/lesson-coverage';
import {
  Attendance,
  AttendanceDocument,
  Enrollment,
  EnrollmentDocument,
  TeachingAssignment,
  TeachingAssignmentDocument,
} from 'src/database/schemas';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CalendarService } from '../calendar/calendar.service';
import { RecordScopeService } from 'src/common/services/record-scope.service';
import { isOnCurrentRoll, ROSTER_STUDENT_SELECT } from 'src/common/utils/current-roll';
import {
  nicknameOf,
  populatedStudent,
  registerName,
  STUDENT_NAME_PROJECTION,
  STUDENT_NAME_SELECT,
  type NamedStudent,
} from 'src/common/utils/student-name';
import { SemestersService } from '../semesters/semesters.service';
import { SettingsService } from '../settings/settings.service';
import { absenceDays, LATES_PER_ABSENCE_SETTING, normalizeLatesPerAbsence } from './absence-days';
import {
  AttendanceAbsenceRowDto,
  AttendanceSubjectSummaryDto,
  AttendanceSummaryDto,
  ClassAttendanceSummaryQueryDto,
  QueryAttendancesDto,
  RecordAttendanceDto,
  SemesterAbsencesQueryDto,
} from './dto/attendance.dto';

/**
 * A classroom, carrying its grade code.
 *
 * A section name is only unique within its grade, so an absence log filtered
 * across classes would otherwise show three identical "A" rows.
 */
const CLASSROOM_WITH_GRADE = {
  path: 'classroomId',
  select: 'name gradeLevelId',
  populate: { path: 'gradeLevelId', select: 'code nameLo nameEn' },
} as const;

/** Just enough of a teacher to name them in the log. */
const TEACHER_NAME = 'teacherCode firstNameLo lastNameLo firstNameEn lastNameEn';

/**
 * Collapses a timestamp to UTC midnight.
 *
 * A school day is a calendar date, not an instant. Normalizing means the unique
 * index on (studentId, date, period) actually prevents duplicates — otherwise
 * two records for the same day at different clock times would both be accepted.
 */
export function toUtcMidnight(input: string | Date): Date {
  const date = new Date(input);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/**
 * What narrows a summary below the term: a window, and optionally one subject.
 *
 * `month` is matched on the month of the date rather than on a date range: the
 * term is already the outer filter, and a calendar month falls inside exactly
 * one term, so there is no year arithmetic to get wrong at the ທັນວາ/ມັງກອນ
 * boundary. Dates are stored at UTC midnight, which is the timezone `$month`
 * reads them in. `from`/`to` are inclusive calendar dates; both may be given
 * with `month`, in which case they simply intersect.
 */
export function summaryMatch(
  scope: Pick<ClassAttendanceSummaryQueryDto, 'month' | 'from' | 'to' | 'subjectId'> = {},
): Record<string, unknown> {
  return {
    ...(scope.month ? { $expr: { $eq: [{ $month: '$date' }, scope.month] } } : {}),
    ...(scope.from || scope.to
      ? {
          date: {
            ...(scope.from ? { $gte: toUtcMidnight(scope.from) } : {}),
            ...(scope.to ? { $lte: toUtcMidnight(scope.to) } : {}),
          },
        }
      : {}),
    ...(scope.subjectId ? { subjectId: new Types.ObjectId(scope.subjectId) } : {}),
  };
}

@Injectable()
export class AttendancesService {
  constructor(
    @InjectModel(Attendance.name) private readonly model: Model<AttendanceDocument>,
    @InjectModel(Enrollment.name) private readonly enrollmentModel: Model<EnrollmentDocument>,
    @InjectModel(TeachingAssignment.name)
    private readonly assignmentModel: Model<TeachingAssignmentDocument>,
    private readonly semesters: SemestersService,
    private readonly audit: AuditLogsService,
    private readonly scope: RecordScopeService,
    private readonly calendar: CalendarService,
    private readonly settings: SettingsService,
    private readonly lessons: LessonAccessService,
  ) {}

  async findAll(
    query: QueryAttendancesDto,
    actor: AuthenticatedUser,
  ): Promise<PaginatedResponse<AttendanceDocument>> {
    const filter: Record<string, unknown> = { deletedAt: null };
    if (query.studentId) filter.studentId = new Types.ObjectId(query.studentId);
    if (query.classroomId) filter.classroomId = new Types.ObjectId(query.classroomId);
    if (query.semesterId) filter.semesterId = new Types.ObjectId(query.semesterId);
    if (query.subjectId) filter.subjectId = new Types.ObjectId(query.subjectId);
    if (query.teacherId) filter.teacherId = new Types.ObjectId(query.teacherId);
    if (query.teachingAssignmentId) {
      filter.teachingAssignmentId = new Types.ObjectId(query.teachingAssignmentId);
    }
    // The summary's counts, opened up: a reader asking "which lessons did this
    // student miss" wants absent, late, excused and sick together, and the
    // `present` rows — the bulk of the collection — left out.
    if (query.status) filter.status = query.status;
    else if (query.notPresent) filter.status = { $ne: 'present' };
    if (query.from || query.to) {
      filter.date = {
        ...(query.from ? { $gte: toUtcMidnight(query.from) } : {}),
        ...(query.to ? { $lte: toUtcMidnight(query.to) } : {}),
      };
    }

    await this.scope.applyStudentScope(filter, actor);

    const [data, total] = await Promise.all([
      this.model
        .find(filter)
        // An absence log is read as "who, on what day" — the ids alone are
        // unreadable, and joining them client-side would be one request per row.
        .populate('studentId', STUDENT_NAME_SELECT)
        .populate(CLASSROOM_WITH_GRADE)
        .populate('subjectId', 'code nameLo nameEn')
        // Both sides of "who checked": the teacher whose lesson it was, and the
        // account that actually submitted it. They differ whenever the office
        // records on a teacher's behalf, which is exactly when it matters.
        .populate('teacherId', TEACHER_NAME)
        // ຄູສອນແທນ, when the lesson was covered. Named rather than left as an id,
        // because this is the answer to "why is this row not in their handwriting"
        // and the log is read precisely when a row looks odd.
        .populate('substituteTeacherId', TEACHER_NAME)
        // `personId` so the client can tell a teacher filing their own roll call
        // from someone filing it for them, without a second lookup per row.
        .populate('recordedBy', 'username personType personId')
        .sort({ date: -1, period: 1 })
        .skip(query.skip)
        .limit(query.limit)
        .exec(),
      this.model.countDocuments(filter).exec(),
    ]);

    return new PaginatedResponse(data, total, query.page, query.limit);
  }

  /**
   * Which teacher has not marked the roll — the register read the other way round.
   *
   * Every other read here starts from records that exist, so none of them can show
   * the lesson nobody marked: an unmarked class is not an absent student, it is the
   * absence of a roll call, and that is what the academic office is chasing. So the
   * expected set comes from the timetable and the marked days are matched into it.
   *
   * The same report as the behaviour register's, and deliberately the same code —
   * with one rule changed. Attendance is owed once for *every* lesson day, not once
   * per window: a teacher who marked Monday and skipped Wednesday is behind, and
   * the register's "one entry is enough" rule would clear them.
   *
   * The summary is computed before `outstandingOnly` narrows the rows, so the
   * headline numbers say what the window looks like rather than how long the list
   * on screen is.
   */
  async getCoverage(
    query: CoverageQueryDto,
    options: { teacherId?: string | null; noLessons?: boolean } = {},
  ): Promise<LessonCoverage> {
    const teacherId = options.teacherId ?? query.teacherId ?? null;
    const now = new Date();
    // One day or one week, the same report — see `CoverageQueryDto`. Built twice
    // because the term is read off the window and the window carries the term's
    // bounds; the first pass only needs the dates, which the term cannot move.
    const windowFor = (semester?: { startDate: Date; endDate: Date } | null) =>
      query.date
        ? dayWindow(query.date, now, semester)
        : weekWindow(query.weekOf ?? now, now, semester);

    // A named semester is honoured even when it is not the active one, so a head
    // can look back at a closed term; otherwise the term is read off the window
    // that was asked for rather than assumed to be the active one.
    const semester = query.semesterId
      ? await this.semesters.findOne(query.semesterId)
      : await resolveCoverageSemester(this.semesters, windowFor());

    // The school calendar, so a holiday is not reported as a roll call nobody
    // made: `nonTeachingDays` is what stops the count expecting a lesson on a
    // day the office closed. Read off the window's own bounds, so a report about
    // a past week reads the calendar that week was taught under.
    const bounds = windowFor(semester);
    // Per classroom as well as school-wide: a year or a room the office stood
    // down on its own owes nothing that day, while the rest of the school does.
    const schoolDays = await this.calendar.nonTeachingDaysFor(bounds.start, bounds.end);
    const window: CoverageWindow = {
      ...bounds,
      nonTeachingDays: schoolDays.schoolWide,
      nonTeachingDaysFor: schoolDays.forClassroom,
    };

    // A teacher's own week has to include the lessons they stood in on, which the
    // timetable files under the teacher who was away — see `alsoAssignmentIds`.
    const covered =
      teacherId && !options.noLessons
        ? await this.lessons.coveredAssignmentIds(teacherId, window.start, window.end)
        : [];

    const assignments =
      semester && !options.noLessons
        ? await loadCoverageAssignments(this.assignmentModel, semester._id, {
            teacherId,
            classroomId: query.classroomId,
            alsoAssignmentIds: covered,
          })
        : [];
    const marked = await this.loadMarkedDays(
      assignments.map((assignment) => assignment.teachingAssignmentId),
      window.start,
      window.end,
    );

    // Cover claimed in this window, so a day somebody stood in on is owed by them
    // and not by the teacher who was away. Read for the window rather than per
    // row: on an ordinary week it comes back empty and costs one indexed query.
    const substitutions = await this.lessons.substitutionIndex({
      semesterId: semester?._id ?? null,
      from: window.start,
      to: window.end,
      classroomId: query.classroomId,
    });

    const coverage = buildCoverage(window, assignments, marked, {
      covered: 'everyLessonDay',
      substitutions,
      semester: semester
        ? { id: semester._id.toString(), nameLo: semester.nameLo, nameEn: semester.nameEn ?? null }
        : null,
    });

    // Widening the timetable above also brought in the absent teacher's share of
    // the lessons that were covered, which belongs on their row and not here.
    // Narrowed before the summary, so the headline numbers describe the same
    // teacher the rows do.
    const scoped =
      teacherId && covered.length > 0
        ? withRows(
            coverage,
            coverage.rows.filter((row) => row.teacherId === teacherId),
          )
        : coverage;

    if (!query.outstandingOnly) return scoped;
    return withRows(
      scoped,
      scoped.rows.filter((row) => row.status === 'missing'),
      scoped.summary,
    );
  }

  /**
   * ຄວາມຕົງເວລາໃນການບັນທຶກ — who marks the roll late.
   *
   * The question `getCoverage` cannot answer. Coverage asks whether a lesson was
   * marked, and a teacher who marks a fortnight of lessons on the last Friday of
   * the month satisfies it completely — which, once the school had been running
   * this for a few weeks, turned out to be most of what was happening.
   *
   * So this one asks *when*, against the deadline the school set: noon of the next
   * working day after the lesson. The rules are in
   * `common/record-timeliness`, and the same code answers the behaviour
   * register with one rule changed — see `BehaviorLogsService.getTimeliness`.
   */
  async getTimeliness(query: TimelinessQueryDto): Promise<RecordTimeliness> {
    return readTimeliness(
      {
        semesters: this.semesters,
        assignments: this.assignmentModel,
        log: this.model,
        calendar: this.calendar,
        // Cover claimed in the window, so a day somebody stood in on is judged
        // against them and the teacher who was away is not reported late for it.
        substitutions: this.lessons,
      },
      query,
      // The roll call is owed every lesson day, so a day with nothing on file is
      // a gap and is counted as one.
      'everyLessonDay',
    );
  }

  /**
   * Which days each lesson was marked on, inside the window.
   *
   * Grouped by day rather than by record: one roll call writes a record per
   * student, and `record()` keys its upsert on (student, date, assignment) — so a
   * day is the unit that was either marked or not, whatever the period.
   */
  private async loadMarkedDays(
    teachingAssignmentIds: string[],
    from: Date,
    to: Date,
  ): Promise<CoverageWritten[]> {
    if (teachingAssignmentIds.length === 0) return [];

    const rows = await this.model
      .aggregate<{
        _id: { assignment: Types.ObjectId; date: Date };
        studentsNoted: number;
      }>([
        {
          $match: {
            teachingAssignmentId: {
              $in: teachingAssignmentIds.map((id) => new Types.ObjectId(id)),
            },
            date: { $gte: from, $lte: to },
            deletedAt: null,
          },
        },
        {
          // Grouped per day rather than per lesson, and folded up below. The
          // per-lesson totals are still what the ordinary row reads, but a lesson
          // that was covered has to be divided between two teachers, and a total
          // cannot be divided after the fact — see `CoverageWritten.perDay`.
          $group: {
            _id: { assignment: '$teachingAssignmentId', date: '$date' },
            studentsNoted: { $sum: 1 },
          },
        },
      ])
      .exec();

    const byAssignment = new Map<string, CoverageWritten>();
    for (const row of rows) {
      const id = row._id.assignment.toString();
      const date = row._id.date.toISOString().slice(0, 10);
      const found = byAssignment.get(id) ?? {
        teachingAssignmentId: id,
        entries: 0,
        studentsNoted: 0,
        dates: [],
        perDay: [],
      };
      // One roll call, however many students it named — which is what makes this
      // comparable with the register's rows.
      found.entries += 1;
      found.studentsNoted += row.studentsNoted;
      found.dates.push(date);
      found.perDay!.push({ date, entries: 1, studentsNoted: row.studentsNoted });
      byAssignment.set(id, found);
    }

    return [...byAssignment.values()];
  }

  /**
   * Records attendance for one timetabled lesson on one date.
   *
   * Everything describing the lesson — classroom, subject, teacher, semester,
   * period — comes off the assignment rather than the request body, so the
   * request cannot claim a lesson that is not on the timetable.
   *
   * Uses a single `bulkWrite` of upserts rather than a loop: roll call is a
   * high-frequency operation (every class, every day) and one round trip for
   * 40 students matters. Upsert also makes re-submitting a corrected roll call
   * idempotent.
   */
  async record(
    dto: RecordAttendanceDto,
    actor: AuthenticatedUser,
    ip: string | null,
  ): Promise<{ recorded: number }> {
    const date = toUtcMidnight(dto.date);
    const { assignment, substitution } = await this.lessons.resolveWritableLesson(
      dto.teachingAssignmentId,
      date,
      actor,
    );
    const semester = await this.semesters.getWritableOrFail(assignment.semesterId.toString());

    // Attendance is an observation, so it cannot be about the future.
    if (date > toUtcMidnight(new Date())) {
      throw AppException.badRequest('attendance.futureDate', { date: dto.date });
    }
    if (date < toUtcMidnight(semester.startDate) || date > toUtcMidnight(semester.endDate)) {
      throw AppException.badRequest('attendance.outsideSemester', {
        date: dto.date,
        semesterRange: [semester.startDate, semester.endDate],
      });
    }

    const roster = await this.enrollmentModel
      .find({
        classroomId: assignment.classroomId,
        status: 'active',
        deletedAt: null,
      })
      .select('studentId')
      .lean()
      .exec();
    const enrolled = new Set(roster.map((e) => e.studentId.toString()));

    const unknown = dto.entries.filter((e) => !enrolled.has(e.studentId));
    if (unknown.length > 0) {
      throw AppException.badRequest('score.studentNotInClassroom', {
        studentIds: unknown.map((e) => e.studentId),
      });
    }

    const period = this.periodNumberFor(assignment, date);

    const operations = dto.entries.map((entry) => ({
      updateOne: {
        filter: {
          studentId: new Types.ObjectId(entry.studentId),
          date,
          teachingAssignmentId: assignment._id,
          deletedAt: null,
        },
        update: {
          $set: {
            classroomId: assignment.classroomId,
            semesterId: assignment.semesterId,
            schoolYearId: assignment.schoolYearId,
            subjectId: assignment.subjectId,
            teacherId: assignment.teacherId,
            // Who was actually in the room, when it was not the timetabled
            // teacher. Set from the live claim rather than from the caller, so an
            // office user keying a covered lesson in produces the same row the
            // stand-in would have, and re-submitting a corrected sheet after the
            // claim was withdrawn clears it.
            substituteTeacherId: substitution?.substituteTeacherId ?? null,
            period,
            status: entry.status,
            // Only carry `minutesLate` for a late arrival; otherwise it is noise.
            minutesLate: entry.status === 'late' ? (entry.minutesLate ?? null) : null,
            reason: entry.reason ?? null,
            // Whoever pressed the button, which need not be `teacherId`.
            recordedBy: new Types.ObjectId(actor.sub),
          },
          $setOnInsert: {
            studentId: new Types.ObjectId(entry.studentId),
            date,
            teachingAssignmentId: assignment._id,
          },
        },
        upsert: true,
      },
    }));

    const outcome = await this.model.bulkWrite(operations);
    const recorded = outcome.upsertedCount + outcome.modifiedCount;

    // One audit row for the roll call, not forty — the individual statuses are
    // the record itself, and per-student rows would swamp the trail.
    await this.audit.record({
      action: 'create',
      entityType: 'attendances',
      userId: actor.sub,
      username: actor.username,
      newValue: {
        teachingAssignmentId: dto.teachingAssignmentId,
        classroomId: assignment.classroomId.toString(),
        subjectId: assignment.subjectId.toString(),
        // Recorded explicitly so the trail shows a stand-in submission for what
        // it is, without having to re-read the timetable as it was that day.
        teacherId: assignment.teacherId.toString(),
        substituteTeacherId: substitution?.substituteTeacherId.toString() ?? null,
        date: dto.date,
        period,
        entryCount: dto.entries.length,
        absentCount: dto.entries.filter((e) => e.status === 'absent').length,
      },
      ip,
    });

    return { recorded };
  }

  /**
   * The period number to stamp on the record.
   *
   * Falls back to the lesson's position in the day's schedule when the timetable
   * leaves `periodNumber` unset, so the field is always usable for ordering.
   */
  private periodNumberFor(assignment: TeachingAssignmentDocument, date: Date): number {
    const today = periodsOnDate(assignment.schedule, date).sort((a, b) =>
      a.startTime.localeCompare(b.startTime),
    );
    return today[0]?.periodNumber ?? 1;
  }

  /** Attendance counts per status for one student over a semester. */
  async getStudentSummary(
    studentId: string,
    semesterId: string,
    session?: ClientSession,
    /** A window and/or subject, as `getClassroomSummary` takes them; the whole term without. */
    scope?: ClassAttendanceSummaryQueryDto,
  ): Promise<AttendanceSummaryDto> {
    const rows = await this.model
      .aggregate<{ _id: AttendanceStatus; count: number }>([
        {
          $match: {
            studentId: new Types.ObjectId(studentId),
            semesterId: new Types.ObjectId(semesterId),
            deletedAt: null,
            ...summaryMatch(scope),
          },
        },
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ])
      .session(session ?? null)
      .exec();

    return this.buildSummary(studentId, rows, await this.latesPerAbsence());
  }

  /**
   * The same counts for one student, split by subject.
   *
   * The overall summary cannot stand in for this. With one lesson per school
   * day, each weekday belongs to a different subject, so a student who misses
   * every Monday has missed an entire subject while their overall rate — the
   * number that gates exam eligibility — barely moves.
   */
  async getStudentSubjectSummary(
    studentId: string,
    semesterId: string,
  ): Promise<AttendanceSubjectSummaryDto[]> {
    const rows = await this.model
      .aggregate<{
        _id: { subjectId: Types.ObjectId; status: AttendanceStatus };
        count: number;
        subject: { code: string; nameLo: string; nameEn: string | null }[];
      }>([
        {
          $match: {
            studentId: new Types.ObjectId(studentId),
            semesterId: new Types.ObjectId(semesterId),
            deletedAt: null,
          },
        },
        { $group: { _id: { subjectId: '$subjectId', status: '$status' }, count: { $sum: 1 } } },
        {
          $lookup: {
            from: 'subjects',
            localField: '_id.subjectId',
            foreignField: '_id',
            as: 'subject',
            pipeline: [{ $project: { code: 1, nameLo: 1, nameEn: 1 } }],
          },
        },
      ])
      .exec();

    const latesPerAbsence = await this.latesPerAbsence();
    const bySubject = new Map<
      string,
      {
        subject: { code: string; nameLo: string; nameEn: string | null } | undefined;
        statuses: { _id: AttendanceStatus; count: number }[];
      }
    >();

    for (const row of rows) {
      const key = row._id.subjectId.toString();
      const entry = bySubject.get(key) ?? { subject: row.subject[0], statuses: [] };
      entry.statuses.push({ _id: row._id.status, count: row.count });
      bySubject.set(key, entry);
    }

    return (
      [...bySubject.entries()]
        .map(([subjectId, { subject, statuses }]) => ({
          ...this.buildSummary(studentId, statuses, latesPerAbsence),
          subjectId,
          subjectCode: subject?.code ?? null,
          subjectNameLo: subject?.nameLo ?? null,
          subjectNameEn: subject?.nameEn ?? null,
        }))
        // Worst attendance first: this list exists to surface the subject a
        // student is falling out of, and that should not need scrolling for.
        .sort((a, b) => a.attendanceRate - b.attendanceRate)
    );
  }

  /**
   * The same summary for every student in a classroom, in one aggregation.
   *
   * `month` narrows it to one calendar month of the term, which is what the
   * monthly mark sheet's ວັນຂາດ column is counted over; `from`/`to` to any
   * stretch of it and `subjectId` to one subject's lessons — see `summaryMatch`.
   * Without any of them the whole term is counted, as exam eligibility and the
   * guardian meeting read it.
   *
   * Only students the roll has something recorded against come back — the
   * callers hold the roster and read a missing student as a clean one.
   */
  async getClassroomSummary(
    classroomId: string,
    semesterId: string,
    scope?: ClassAttendanceSummaryQueryDto,
  ): Promise<AttendanceSummaryDto[]> {
    const rows = await this.model
      .aggregate<{ _id: { studentId: Types.ObjectId; status: AttendanceStatus }; count: number }>([
        {
          $match: {
            classroomId: new Types.ObjectId(classroomId),
            semesterId: new Types.ObjectId(semesterId),
            deletedAt: null,
            ...summaryMatch(scope),
          },
        },
        { $group: { _id: { studentId: '$studentId', status: '$status' }, count: { $sum: 1 } } },
      ])
      .exec();

    const latesPerAbsence = await this.latesPerAbsence();
    const byStudent = new Map<string, { _id: AttendanceStatus; count: number }[]>();
    for (const row of rows) {
      const key = row._id.studentId.toString();
      const list = byStudent.get(key) ?? [];
      list.push({ _id: row._id.status, count: row.count });
      byStudent.set(key, list);
    }

    return [...byStudent.entries()].map(([studentId, statuses]) =>
      this.buildSummary(studentId, statuses, latesPerAbsence),
    );
  }

  /**
   * Who has been absent `minAbsentDays` days or more, anywhere in the school.
   *
   * The class summary is read one room at a time, which is the wrong shape for
   * the office's question — "who is at 15 days, and 30" is asked of the term,
   * and answered with a name and a room. So this aggregates the whole term (or
   * the window asked for) at once, applies the same absence rule as every other
   * summary, and keeps only the students over the line, worst first.
   *
   * The room is the one the student was most recently marked in, read off the
   * records rather than the enrollment: a transferred child's absences belong
   * to the term, and the office wants to know where to find them now.
   */
  async getSemesterAbsences(
    semesterId: string,
    query: SemesterAbsencesQueryDto,
    actor: AuthenticatedUser,
  ): Promise<AttendanceAbsenceRowDto[]> {
    const match: Record<string, unknown> = {
      semesterId: new Types.ObjectId(semesterId),
      deletedAt: null,
      ...summaryMatch(query),
      ...(query.classroomId ? { classroomId: new Types.ObjectId(query.classroomId) } : {}),
    };
    // A student or guardian holding `attendances:read` sees their own child on
    // the list or nobody — never the school.
    await this.scope.applyStudentScope(match, actor);

    const rows = await this.model
      .aggregate<{
        _id: Types.ObjectId;
        statuses: { status: AttendanceStatus; count: number }[];
        rooms: { classroomId: Types.ObjectId; lastDate: Date }[];
        student: NamedStudent[];
        classrooms: { _id: Types.ObjectId; name: string; gradeLevel: { code: string }[] }[];
      }>([
        { $match: match },
        // Per student and room first, so the room they were last marked in can
        // be told apart from one they left mid-term.
        {
          $group: {
            _id: { studentId: '$studentId', classroomId: '$classroomId', status: '$status' },
            count: { $sum: 1 },
            lastDate: { $max: '$date' },
          },
        },
        {
          $group: {
            _id: '$_id.studentId',
            statuses: { $push: { status: '$_id.status', count: '$count' } },
            rooms: { $push: { classroomId: '$_id.classroomId', lastDate: '$lastDate' } },
          },
        },
        {
          $lookup: {
            from: 'students',
            localField: '_id',
            foreignField: '_id',
            as: 'student',
            pipeline: [{ $project: STUDENT_NAME_PROJECTION }],
          },
        },
        {
          $lookup: {
            from: 'classrooms',
            let: { roomIds: '$rooms.classroomId' },
            as: 'classrooms',
            pipeline: [
              { $match: { $expr: { $in: ['$_id', '$$roomIds'] } } },
              {
                $lookup: {
                  from: 'gradeLevels',
                  localField: 'gradeLevelId',
                  foreignField: '_id',
                  as: 'gradeLevel',
                  pipeline: [{ $project: { code: 1 } }],
                },
              },
              { $project: { name: 1, gradeLevel: 1 } },
            ],
          },
        },
      ])
      .exec();

    const latesPerAbsence = await this.latesPerAbsence();

    return rows
      .map((row) => {
        // The same student may appear under two rooms; the statuses are summed
        // and the room is whichever they were marked in last.
        const byStatus = new Map<AttendanceStatus, number>();
        for (const entry of row.statuses) {
          byStatus.set(entry.status, (byStatus.get(entry.status) ?? 0) + entry.count);
        }
        const summary = this.buildSummary(
          row._id.toString(),
          [...byStatus.entries()].map(([status, count]) => ({ _id: status, count })),
          latesPerAbsence,
        );

        const latest = row.rooms.reduce<{ classroomId: Types.ObjectId; lastDate: Date } | null>(
          (best, room) => (!best || room.lastDate > best.lastDate ? room : best),
          null,
        );
        const classroom = latest
          ? row.classrooms.find((candidate) => candidate._id.equals(latest.classroomId))
          : undefined;
        const student = row.student[0];

        return {
          ...summary,
          studentCode: student?.studentCode ?? null,
          studentNameLo: registerName(student),
          studentNickname: nicknameOf(student),
          classroomId: latest ? latest.classroomId.toString() : null,
          classroomName: classroom?.name ?? null,
          gradeLevelCode: classroom?.gradeLevel[0]?.code ?? null,
        };
      })
      .filter((row) => row.absentTotal >= query.minAbsentDays)
      .sort(
        (a, b) =>
          b.absentTotal - a.absentTotal ||
          b.absentUnexcused - a.absentUnexcused ||
          (a.studentNameLo ?? '').localeCompare(b.studentNameLo ?? ''),
      );
  }

  /**
   * Daily roll-call sheet: every lesson a class has that day, each with the
   * roster and whatever has already been recorded for it.
   *
   * Returns all of the day's lessons at once rather than one per request. A
   * teacher opens this screen when the class starts and works through it in one
   * sitting; making them re-fetch per period would be a round trip for nothing.
   */
  async getDailySheet(classroomId: string, date: string) {
    const normalized = toUtcMidnight(date);

    const [roster, assignments, records] = await Promise.all([
      this.enrollmentModel
        .find({
          classroomId: new Types.ObjectId(classroomId),
          status: 'active',
          deletedAt: null,
        })
        // The enrollment carries a snapshot of the register name but no nickname,
        // and the nickname is what the teacher calling the roll recognises — so
        // the student is joined for it rather than read off the snapshot. The
        // join also carries the status the roll is filtered by.
        .populate('studentId', ROSTER_STUDENT_SELECT)
        .sort({ rollNumber: 1 })
        .lean()
        .exec(),
      this.assignmentModel
        .find({
          classroomId: new Types.ObjectId(classroomId),
          isActive: true,
          deletedAt: null,
        })
        .populate('subjectId', 'code nameLo nameEn')
        .populate('teacherId', TEACHER_NAME)
        .lean()
        .exec(),
      this.model
        .find({
          classroomId: new Types.ObjectId(classroomId),
          date: normalized,
          deletedAt: null,
        })
        .lean()
        .exec(),
    ]);

    // Cover claimed for this class on this day, so the sheet can say who is meant
    // to be calling each roll — and so the screen knows which of its two buttons
    // to offer, save or ຮັບສອນແທນ. One indexed query, empty on an ordinary day.
    const substitutions = await this.lessons.substitutionIndex({
      from: normalized,
      to: normalized,
      classroomId,
    });

    // The sheet is a roll to call, not a list of enrollments: a student the
    // office has marked as gone still holds an `active` enrollment until someone
    // closes it, and their name should not be read out.
    const onRoll = roster.filter((enrollment) => isOnCurrentRoll(enrollment.studentId));

    // Keyed by lesson, not by student: the same student appears once per lesson,
    // so a student-keyed map would silently drop all but one of them.
    const byLessonAndStudent = new Map(
      records.map((r) => [`${r.teachingAssignmentId.toString()}:${r.studentId.toString()}`, r]),
    );

    const lessons = assignments
      .filter((assignment) => periodsOnDate(assignment.schedule, normalized).length > 0)
      .map((assignment) => {
        const slot = periodsOnDate(assignment.schedule, normalized).sort((a, b) =>
          a.startTime.localeCompare(b.startTime),
        )[0];
        const assignmentId = assignment._id.toString();

        return {
          teachingAssignmentId: assignmentId,
          period: slot.periodNumber ?? 1,
          startTime: slot.startTime,
          endTime: slot.endTime,
          room: slot.room ?? null,
          subject: assignment.subjectId,
          teacher: assignment.teacherId,
          // ຄູສອນແທນ — who is answerable for this lesson today, when it is not the
          // teacher beside it. Named on screen and on the printed sheet, because a
          // register signed off by somebody who was not in the building is the
          // first thing the office asks about.
          substituteTeacher: substitutions.get(substitutionKey(assignmentId, normalized)) ?? null,
          entries: onRoll.map((enrollment) => {
            const student = populatedStudent(enrollment.studentId);
            const studentId = student?._id.toString() ?? String(enrollment.studentId);
            const record = byLessonAndStudent.get(`${assignmentId}:${studentId}`);
            return {
              studentId,
              studentCode: enrollment.studentCode,
              studentNameLo: enrollment.studentNameLo,
              studentNickname: nicknameOf(student),
              rollNumber: enrollment.rollNumber,
              status: record?.status ?? null,
              minutesLate: record?.minutesLate ?? null,
              reason: record?.reason ?? null,
            };
          }),
        };
      })
      .sort((a, b) => a.startTime.localeCompare(b.startTime));

    return { date: normalized.toISOString().slice(0, 10), lessons };
  }

  /**
   * How many late arrivals the office counts as a day absent — policy, so it
   * lives in settings; three without one, or with one that would not divide.
   */
  private async latesPerAbsence(): Promise<number> {
    return normalizeLatesPerAbsence(await this.settings.getValue(LATES_PER_ABSENCE_SETTING));
  }

  /** The raw counts, and the office's reading of them — see `absenceDays`. */
  private buildSummary(
    studentId: string,
    statuses: { _id: AttendanceStatus; count: number }[],
    latesPerAbsence: number,
  ): AttendanceSummaryDto {
    const countOf = (status: AttendanceStatus) =>
      statuses.find((s) => s._id === status)?.count ?? 0;

    const counts = {
      present: countOf('present'),
      absent: countOf('absent'),
      late: countOf('late'),
      excused: countOf('excused'),
      sick: countOf('sick'),
    };
    const totalRecorded =
      counts.present + counts.absent + counts.late + counts.excused + counts.sick;

    return { studentId, ...counts, totalRecorded, ...absenceDays(counts, latesPerAbsence) };
  }
}
