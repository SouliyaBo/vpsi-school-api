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
import { loadCoverageAssignments } from 'src/common/lesson-coverage/coverage-assignments';
import {
  buildCoverage,
  dayWindow,
  resolveCoverageSemester,
  weekWindow,
  type CoverageWindow,
  type CoverageWritten,
  type LessonCoverage,
} from 'src/common/lesson-coverage/lesson-coverage';
import {
  Attendance,
  AttendanceDocument,
  Enrollment,
  EnrollmentDocument,
  SchedulePeriod,
  TeachingAssignment,
  TeachingAssignmentDocument,
} from 'src/database/schemas';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CalendarService } from '../calendar/calendar.service';
import { RecordScopeService } from 'src/common/services/record-scope.service';
import { isOnCurrentRoll, ROSTER_STUDENT_SELECT } from 'src/common/utils/current-roll';
import { nicknameOf, populatedStudent, STUDENT_NAME_SELECT } from 'src/common/utils/student-name';
import { SemestersService } from '../semesters/semesters.service';
import { round2 } from '../term-results/grading';
import {
  AttendanceSubjectSummaryDto,
  AttendanceSummaryDto,
  QueryAttendancesDto,
  RecordAttendanceDto,
} from './dto/attendance.dto';

/** Statuses that count as "accounted for" when computing an attendance rate. */
const NON_ABSENT: AttendanceStatus[] = ['present', 'late', 'excused', 'sick'];

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
 * The periods of an assignment that fall on the same weekday as `date`.
 *
 * `getUTCDay()` rather than `getDay()`: the date has already been collapsed to
 * UTC midnight, so the local-time accessor would read the previous day for any
 * server west of UTC.
 */
export function periodsOnDate(schedule: SchedulePeriod[], date: Date): SchedulePeriod[] {
  return schedule.filter((period) => period.dayOfWeek === date.getUTCDay());
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
    if (query.status) filter.status = query.status;
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
    const schoolDays = await this.calendar.calendarFor(bounds.start, bounds.end);
    const window: CoverageWindow = {
      ...bounds,
      nonTeachingDays: schoolDays.nonTeachingDays(bounds.start, bounds.end),
    };

    const assignments =
      semester && !options.noLessons
        ? await loadCoverageAssignments(this.assignmentModel, semester._id, {
            teacherId,
            classroomId: query.classroomId,
          })
        : [];
    const marked = await this.loadMarkedDays(
      assignments.map((assignment) => assignment.teachingAssignmentId),
      window.start,
      window.end,
    );

    const coverage = buildCoverage(window, assignments, marked, {
      covered: 'everyLessonDay',
      semester: semester
        ? { id: semester._id.toString(), nameLo: semester.nameLo, nameEn: semester.nameEn ?? null }
        : null,
    });

    if (!query.outstandingOnly) return coverage;
    return { ...coverage, rows: coverage.rows.filter((row) => row.status === 'missing') };
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
      .aggregate<{ _id: Types.ObjectId; dates: Date[]; studentsNoted: number }>([
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
          $group: {
            _id: '$teachingAssignmentId',
            dates: { $addToSet: '$date' },
            studentsNoted: { $sum: 1 },
          },
        },
      ])
      .exec();

    return rows.map((row) => ({
      teachingAssignmentId: row._id.toString(),
      // One roll call, however many students it named — which is what makes this
      // comparable with the register's rows.
      entries: row.dates.length,
      studentsNoted: row.studentsNoted,
      dates: row.dates.map((date) => date.toISOString().slice(0, 10)),
    }));
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
    const assignment = await this.getLessonOrFail(dto.teachingAssignmentId, date, actor);
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
   * Loads the lesson being registered and refuses it unless the actor may.
   *
   * Three separate refusals, deliberately not collapsed: an inactive assignment,
   * a date the lesson is not taught on, and an actor who does not teach it. A
   * teacher is bound to their own lessons; office roles holding
   * `attendances:create` may record for anyone, which is what makes recording on
   * a teacher's behalf possible at all.
   */
  private async getLessonOrFail(
    teachingAssignmentId: string,
    date: Date,
    actor: AuthenticatedUser,
  ): Promise<TeachingAssignmentDocument> {
    const assignment = await this.assignmentModel
      .findOne({ _id: new Types.ObjectId(teachingAssignmentId), deletedAt: null })
      .exec();
    if (!assignment) throw AppException.notFound();

    if (!assignment.isActive) {
      throw AppException.badRequest('attendance.assignmentInactive', { teachingAssignmentId });
    }

    if (periodsOnDate(assignment.schedule, date).length === 0) {
      throw AppException.badRequest('attendance.lessonNotScheduled', {
        teachingAssignmentId,
        dayOfWeek: date.getUTCDay(),
        scheduledDays: [...new Set(assignment.schedule.map((p) => p.dayOfWeek))].sort(),
      });
    }

    if (actor.personType === 'teacher' && actor.personId !== assignment.teacherId.toString()) {
      throw AppException.forbidden('attendance.notAssignedTeacher');
    }

    return assignment;
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
    /** One calendar month of the term, as `getClassroomSummary` takes it; the whole term without. */
    month?: number,
  ): Promise<AttendanceSummaryDto> {
    const rows = await this.model
      .aggregate<{ _id: AttendanceStatus; count: number }>([
        {
          $match: {
            studentId: new Types.ObjectId(studentId),
            semesterId: new Types.ObjectId(semesterId),
            deletedAt: null,
            ...(month ? { $expr: { $eq: [{ $month: '$date' }, month] } } : {}),
          },
        },
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ])
      .session(session ?? null)
      .exec();

    return this.buildSummary(studentId, rows);
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
          ...this.buildSummary(studentId, statuses),
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
   * monthly mark sheet's ວັນຂາດ column is counted over; without it the whole
   * term is counted, as exam eligibility and the guardian meeting read it.
   *
   * Only students the roll has something recorded against come back — the
   * callers hold the roster and read a missing student as a clean one.
   */
  async getClassroomSummary(
    classroomId: string,
    semesterId: string,
    month?: number,
  ): Promise<AttendanceSummaryDto[]> {
    const rows = await this.model
      .aggregate<{ _id: { studentId: Types.ObjectId; status: AttendanceStatus }; count: number }>([
        {
          $match: {
            classroomId: new Types.ObjectId(classroomId),
            semesterId: new Types.ObjectId(semesterId),
            deletedAt: null,
            // Matched on the month of the date rather than on a date range: the
            // term is already the outer filter, and a calendar month falls
            // inside exactly one term, so there is no year arithmetic to get
            // wrong at the ທັນວາ/ມັງກອນ boundary. Dates are stored at UTC
            // midnight, which is the timezone `$month` reads them in.
            ...(month ? { $expr: { $eq: [{ $month: '$date' }, month] } } : {}),
          },
        },
        { $group: { _id: { studentId: '$studentId', status: '$status' }, count: { $sum: 1 } } },
      ])
      .exec();

    const byStudent = new Map<string, { _id: AttendanceStatus; count: number }[]>();
    for (const row of rows) {
      const key = row._id.studentId.toString();
      const list = byStudent.get(key) ?? [];
      list.push({ _id: row._id.status, count: row.count });
      byStudent.set(key, list);
    }

    return [...byStudent.entries()].map(([studentId, statuses]) =>
      this.buildSummary(studentId, statuses),
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

  private buildSummary(
    studentId: string,
    statuses: { _id: AttendanceStatus; count: number }[],
  ): AttendanceSummaryDto {
    const countOf = (status: AttendanceStatus) =>
      statuses.find((s) => s._id === status)?.count ?? 0;

    const present = countOf('present');
    const absent = countOf('absent');
    const late = countOf('late');
    const excused = countOf('excused');
    const sick = countOf('sick');
    const totalRecorded = present + absent + late + excused + sick;

    const accountedFor = statuses
      .filter((s) => NON_ABSENT.includes(s._id))
      .reduce((sum, s) => sum + s.count, 0);

    return {
      studentId,
      present,
      absent,
      late,
      excused,
      sick,
      totalRecorded,
      attendanceRate: totalRecorded > 0 ? round2((accountedFor / totalRecorded) * 100) : 0,
    };
  }
}
