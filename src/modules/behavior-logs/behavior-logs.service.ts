import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import { CoverageQueryDto } from 'src/common/dto/coverage-query.dto';
import { PaginatedResponse } from 'src/common/dto/pagination.dto';
import { AppException } from 'src/common/exceptions/app.exception';
import type { AuthenticatedUser } from 'src/common/interfaces/authenticated-user.interface';
import { LessonAccessService } from 'src/common/lesson-access/lesson-access.service';
import { periodsOnDate } from 'src/common/lesson-access/lesson-write-access';
import { loadCoverageAssignments } from 'src/common/lesson-coverage/coverage-assignments';
import { TimelinessQueryDto } from 'src/common/dto/timeliness-query.dto';
import { readTimeliness } from 'src/common/record-timeliness/read-timeliness';
import type { RecordTimeliness } from 'src/common/record-timeliness/record-timeliness';
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
import { RecordScopeService } from 'src/common/services/record-scope.service';
import {
  isOnCurrentRoll,
  ROSTER_STUDENT_PROJECTION,
  ROSTER_STUDENT_SELECT,
} from 'src/common/utils/current-roll';
import {
  nicknameOf,
  populatedStudent,
  registerName,
  STUDENT_NAME_PROJECTION,
  STUDENT_NAME_SELECT,
} from 'src/common/utils/student-name';
import { TransactionHelper } from 'src/database/transaction.helper';
import {
  BehaviorLog,
  BehaviorLogDocument,
  Enrollment,
  EnrollmentDocument,
  SemesterDocument,
  TeachingAssignment,
  TeachingAssignmentDocument,
} from 'src/database/schemas';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CalendarService } from '../calendar/calendar.service';
// The two lesson helpers are shared with attendance rather than copied: both
// logs are observations anchored to a timetabled period, and a second
// implementation of "which periods fall on this date" is a second thing to get
// wrong.
import { toUtcMidnight } from '../attendances/attendances.service';
import { ClassroomsService } from '../classrooms/classrooms.service';
import { SemestersService } from '../semesters/semesters.service';
import {
  BehaviorEntryDto,
  BehaviorTallyQueryDto,
  CreateBehaviorLogDto,
  MonthlySheetQueryDto,
  QueryBehaviorLogsDto,
  UpdateBehaviorLogDto,
} from './dto/behavior-log.dto';

/** A classroom carrying its grade, so `ມ.1/ກ` can be rendered without a lookup. */
const CLASSROOM_WITH_GRADE = {
  path: 'classroomId',
  select: 'name gradeLevelId',
  populate: { path: 'gradeLevelId', select: 'code nameLo nameEn' },
} as const;

const TEACHER_NAME = 'teacherCode firstNameLo lastNameLo firstNameEn lastNameEn';

/** One student's line within a sheet row. */
export interface SheetRowStudent {
  id: string;
  studentId: string;
  studentCode: string | null;
  studentNameLo: string | null;
  /** What the class calls them — how a teacher recognises the row. */
  studentNickname: string | null;
  behavior: string | null;
  action: string | null;
}

/** One row of the printed register, reassembled from its records. */
export interface SheetRow {
  groupId: string;
  date: string;
  period: number;
  subject: unknown;
  teacher: unknown;
  /**
   * ຄູສອນແທນ — the colleague who took the lesson, when one did.
   *
   * On the printed sheet as well as on screen: the office signs these off, and a
   * row whose teacher was not in the building that day is a question somebody will
   * ask of the paper rather than of the app. `null` on an ordinary row.
   */
  substituteTeacher: unknown;
  classNote: string | null;
  remark: string | null;
  teachingAssignmentId: string;
  students: SheetRowStudent[];
}

@Injectable()
export class BehaviorLogsService {
  constructor(
    @InjectModel(BehaviorLog.name) private readonly model: Model<BehaviorLogDocument>,
    @InjectModel(Enrollment.name) private readonly enrollmentModel: Model<EnrollmentDocument>,
    @InjectModel(TeachingAssignment.name)
    private readonly assignmentModel: Model<TeachingAssignmentDocument>,
    private readonly classrooms: ClassroomsService,
    private readonly semesters: SemestersService,
    private readonly audit: AuditLogsService,
    private readonly scope: RecordScopeService,
    private readonly tx: TransactionHelper,
    private readonly calendar: CalendarService,
    private readonly lessons: LessonAccessService,
  ) {}

  /**
   * The register as a flat log, newest first — one record per student.
   *
   * This is the read for "what has this student done this term", which is why it
   * is not grouped: a grouped page would count rows rather than incidents, and a
   * student filtered out of a row would still pull the row into the page.
   *
   * Class-level records (`studentId: null`) are kept, since a filter-free log is
   * also the audit view of the whole register.
   */
  async findAll(
    query: QueryBehaviorLogsDto,
    actor: AuthenticatedUser,
  ): Promise<PaginatedResponse<BehaviorLogDocument>> {
    const filter: Record<string, unknown> = { deletedAt: null };
    if (query.studentId) filter.studentId = new Types.ObjectId(query.studentId);
    if (query.classroomId) filter.classroomId = new Types.ObjectId(query.classroomId);
    if (query.semesterId) filter.semesterId = new Types.ObjectId(query.semesterId);
    if (query.subjectId) filter.subjectId = new Types.ObjectId(query.subjectId);
    if (query.teacherId) filter.teacherId = new Types.ObjectId(query.teacherId);
    if (query.teachingAssignmentId) {
      filter.teachingAssignmentId = new Types.ObjectId(query.teachingAssignmentId);
    }
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
        .populate('studentId', STUDENT_NAME_SELECT)
        .populate(CLASSROOM_WITH_GRADE)
        .populate('subjectId', 'code nameLo nameEn')
        .populate('teacherId', TEACHER_NAME)
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
   * The monthly sheet for one class, as the paper form lays it out.
   *
   * Rows are reassembled from `groupId` rather than inferred from matching
   * dates and notes — two separate incidents in the same lesson are two rows,
   * and no amount of comparing free text can tell them apart reliably.
   *
   * Chronological, unlike the log: this view is read as a month's diary and is
   * what gets printed.
   */
  async getMonthlySheet(query: MonthlySheetQueryDto) {
    const start = new Date(Date.UTC(query.year, query.month - 1, 1));
    // First instant of the next month, so the last day of a 31-day month is in
    // range without special-casing month length.
    const end = new Date(Date.UTC(query.year, query.month, 1));

    const [classroom, records] = await Promise.all([
      this.classrooms.findOnePopulated(query.classroomId),
      this.model
        .find({
          classroomId: new Types.ObjectId(query.classroomId),
          date: { $gte: start, $lt: end },
          deletedAt: null,
        })
        .populate('studentId', STUDENT_NAME_SELECT)
        .populate('subjectId', 'code nameLo nameEn')
        .populate('teacherId', TEACHER_NAME)
        .populate('substituteTeacherId', TEACHER_NAME)
        .sort({ date: 1, period: 1 })
        .lean()
        .exec(),
    ]);

    const rows = new Map<string, SheetRow>();
    for (const record of records) {
      const key = record.groupId.toString();
      const row = rows.get(key) ?? {
        groupId: key,
        date: record.date.toISOString().slice(0, 10),
        period: record.period,
        subject: record.subjectId,
        teacher: record.teacherId,
        substituteTeacher: record.substituteTeacherId ?? null,
        classNote: record.classNote ?? null,
        remark: record.remark ?? null,
        teachingAssignmentId: record.teachingAssignmentId.toString(),
        students: [],
      };

      const student = populatedStudent(record.studentId);
      if (student) {
        row.students.push({
          id: record._id.toString(),
          studentId: student._id.toString(),
          studentCode: student.studentCode ?? null,
          studentNameLo: registerName(student),
          studentNickname: nicknameOf(student),
          behavior: record.behavior ?? null,
          action: record.action ?? null,
        });
      }

      rows.set(key, row);
    }

    return {
      classroom,
      year: query.year,
      month: query.month,
      rows: [...rows.values()],
    };
  }

  /**
   * What the entry form needs to offer: the class's lessons on that date, and
   * its roster.
   *
   * The roster is returned once rather than per lesson — unlike roll call, where
   * every lesson carries its own marks, a behaviour row names a few students out
   * of the class and the same list serves whichever lesson is picked.
   */
  async getEntryContext(classroomId: string, date: string) {
    const normalized = toUtcMidnight(date);

    const [roster, assignments] = await Promise.all([
      this.enrollmentModel
        .find({
          classroomId: new Types.ObjectId(classroomId),
          status: 'active',
          deletedAt: null,
        })
        // The nickname is not on the enrollment snapshot, and the picker this
        // roster fills is where a teacher looks for the child they mean. The
        // join also carries the status the roster is filtered by.
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
    ]);

    const lessons = assignments
      .filter((assignment) => periodsOnDate(assignment.schedule, normalized).length > 0)
      .map((assignment) => {
        const slot = periodsOnDate(assignment.schedule, normalized).sort((a, b) =>
          a.startTime.localeCompare(b.startTime),
        )[0];
        return {
          teachingAssignmentId: assignment._id.toString(),
          period: slot.periodNumber ?? 1,
          startTime: slot.startTime,
          endTime: slot.endTime,
          room: slot.room ?? null,
          subject: assignment.subjectId,
          teacher: assignment.teacherId,
        };
      })
      .sort((a, b) => a.startTime.localeCompare(b.startTime));

    return {
      date: normalized.toISOString().slice(0, 10),
      lessons,
      // The picker offers the class as it stands today, so a student the office
      // has marked as gone is left off it — their `active` enrollment outlives
      // them leaving until someone closes it.
      roster: roster
        .filter((enrollment) => isOnCurrentRoll(enrollment.studentId))
        .map((enrollment) => {
          const student = populatedStudent(enrollment.studentId);
          return {
            studentId: student?._id.toString() ?? String(enrollment.studentId),
            studentCode: enrollment.studentCode,
            studentNameLo: enrollment.studentNameLo,
            studentNickname: nicknameOf(student),
            rollNumber: enrollment.rollNumber ?? null,
          };
        }),
    };
  }

  /**
   * Files one row of the register.
   *
   * The lesson is resolved and authorized first, and every denormalized field is
   * copied off it, so a row cannot claim a subject, teacher or class the
   * timetable does not agree with.
   */
  async create(
    dto: CreateBehaviorLogDto,
    actor: AuthenticatedUser,
    ip: string | null,
  ): Promise<{ groupId: string; recorded: number }> {
    const date = toUtcMidnight(dto.date);
    const { assignment, substitution } = await this.lessons.resolveWritableLesson(
      dto.teachingAssignmentId,
      date,
      actor,
    );
    const semester = await this.semesters.getWritableOrFail(assignment.semesterId.toString());

    // The register records what happened, so it cannot be about the future.
    if (date > toUtcMidnight(new Date())) {
      throw AppException.badRequest('behaviorLog.futureDate', { date: dto.date });
    }
    if (date < toUtcMidnight(semester.startDate) || date > toUtcMidnight(semester.endDate)) {
      throw AppException.badRequest('attendance.outsideSemester', {
        date: dto.date,
        semesterRange: [semester.startDate, semester.endDate],
      });
    }

    const entries = this.normalizeEntries(dto.entries, dto.classNote);
    await this.assertEnrolled(assignment.classroomId, entries);

    const groupId = new Types.ObjectId();
    const period = this.periodNumberFor(assignment, date);
    const shared = {
      groupId,
      teachingAssignmentId: assignment._id,
      classroomId: assignment.classroomId,
      semesterId: assignment.semesterId,
      schoolYearId: assignment.schoolYearId,
      subjectId: assignment.subjectId,
      teacherId: assignment.teacherId,
      // Who was in the room, when the timetable's teacher was not — see
      // `LessonSubstitution`. Carried on the row rather than looked up later,
      // because the row is what the printed sheet and the edit gate both read.
      substituteTeacherId: substitution?.substituteTeacherId ?? null,
      date,
      period,
      classNote: dto.classNote?.trim() || null,
      remark: dto.remark?.trim() || null,
      recordedBy: new Types.ObjectId(actor.sub),
    };

    const docs = this.buildDocuments(shared, entries);
    await this.model.insertMany(docs);

    await this.audit.record({
      action: 'create',
      entityType: 'behavior-logs',
      entityId: groupId.toString(),
      userId: actor.sub,
      username: actor.username,
      newValue: {
        teachingAssignmentId: dto.teachingAssignmentId,
        classroomId: assignment.classroomId.toString(),
        subjectId: assignment.subjectId.toString(),
        teacherId: assignment.teacherId.toString(),
        substituteTeacherId: substitution?.substituteTeacherId.toString() ?? null,
        date: dto.date,
        period,
        studentCount: entries.length,
      },
      ip,
    });

    return { groupId: groupId.toString(), recorded: docs.length };
  }

  /**
   * Replaces a row in place, keeping its `groupId`.
   *
   * The old records are soft-deleted rather than mutated, and new ones written
   * alongside: a student dropped from a row on review should leave the original
   * entry recoverable, which an in-place edit of a shrinking list cannot do. Both
   * halves run in one transaction so the row is never briefly empty or doubled.
   *
   * The lesson and the date are not editable — changing either invalidates every
   * denormalized field, and is a delete plus a re-entry.
   */
  async replaceGroup(
    groupId: string,
    dto: UpdateBehaviorLogDto,
    actor: AuthenticatedUser,
    ip: string | null,
  ): Promise<{ groupId: string; recorded: number }> {
    const existing = await this.getGroupOrFail(groupId, actor);
    const first = existing[0];

    await this.semesters.getWritableOrFail(first.semesterId.toString());

    // Omitted keys keep what the row already says, so a client editing only the
    // student list does not silently blank the class note.
    const classNote = dto.classNote === undefined ? first.classNote : dto.classNote.trim() || null;
    const remark = dto.remark === undefined ? first.remark : dto.remark.trim() || null;
    const entries =
      dto.entries === undefined
        ? existing
            .filter((record) => record.studentId)
            .map<BehaviorEntryDto>((record) => ({
              studentId: record.studentId!.toString(),
              behavior: record.behavior ?? undefined,
              action: record.action ?? undefined,
            }))
        : this.normalizeEntries(dto.entries, classNote);

    if (entries.length === 0 && !classNote) throw AppException.badRequest('behaviorLog.emptyRow');
    await this.assertEnrolled(first.classroomId, entries);

    const shared = {
      groupId: first.groupId,
      teachingAssignmentId: first.teachingAssignmentId,
      classroomId: first.classroomId,
      semesterId: first.semesterId,
      schoolYearId: first.schoolYearId,
      subjectId: first.subjectId,
      teacherId: first.teacherId,
      // Carried across the rewrite: the row is re-filed under whoever actually
      // taught it, not under whoever is correcting it.
      substituteTeacherId: first.substituteTeacherId ?? null,
      date: first.date,
      period: first.period,
      classNote,
      remark,
      recordedBy: new Types.ObjectId(actor.sub),
    };
    const docs = this.buildDocuments(shared, entries);

    await this.tx.run(async (session) => {
      await this.softDeleteGroup(first.groupId, actor, session);
      await this.model.insertMany(docs, { session });
    });

    await this.audit.record({
      action: 'update',
      entityType: 'behavior-logs',
      entityId: groupId,
      userId: actor.sub,
      username: actor.username,
      oldValue: {
        classNote: first.classNote,
        remark: first.remark,
        studentCount: existing.filter((record) => record.studentId).length,
      },
      newValue: { classNote, remark, studentCount: entries.length },
      ip,
    });

    return { groupId, recorded: docs.length };
  }

  /** Soft-deletes a whole row. */
  async removeGroup(groupId: string, actor: AuthenticatedUser, ip: string | null): Promise<void> {
    const existing = await this.getGroupOrFail(groupId, actor);

    await this.softDeleteGroup(existing[0].groupId, actor);

    await this.audit.record({
      action: 'delete',
      entityType: 'behavior-logs',
      entityId: groupId,
      userId: actor.sub,
      username: actor.username,
      oldValue: {
        date: existing[0].date.toISOString().slice(0, 10),
        classroomId: existing[0].classroomId.toString(),
        studentCount: existing.filter((record) => record.studentId).length,
      },
      ip,
    });
  }

  /**
   * Counts per student for one classroom over a semester, worst first.
   *
   * The homeroom teacher's actual question is "who is this month about", and the
   * flat log cannot answer it without paging through every row. Class-level
   * records are excluded, having no student to count against.
   */
  async getClassroomTally(
    classroomId: string,
    semesterId: string,
    scope: BehaviorTallyQueryDto = {},
  ) {
    // The window and the subject narrow what is counted, never who is listed:
    // a student with nothing inside it simply does not appear, which is this
    // tally's whole convention.
    const window: Record<string, Date> = {};
    if (scope.from) window.$gte = toUtcMidnight(scope.from);
    if (scope.to) window.$lte = toUtcMidnight(scope.to);

    const rows = await this.model
      .aggregate<{
        _id: Types.ObjectId;
        entries: number;
        withAction: number;
        lastDate: Date;
        student: {
          studentCode: string;
          firstNameLo: string;
          lastNameLo: string;
          status: string;
        }[];
      }>([
        {
          $match: {
            classroomId: new Types.ObjectId(classroomId),
            semesterId: new Types.ObjectId(semesterId),
            studentId: { $ne: null },
            deletedAt: null,
            ...(Object.keys(window).length > 0 ? { date: window } : {}),
            ...(scope.subjectId ? { subjectId: new Types.ObjectId(scope.subjectId) } : {}),
          },
        },
        {
          $group: {
            _id: '$studentId',
            entries: { $sum: 1 },
            // "Warned or had points taken" — the count a teacher escalates on,
            // as opposed to a bare observation with the action column left empty.
            withAction: {
              $sum: {
                $cond: [{ $in: ['$action', [null, '']] }, 0, 1],
              },
            },
            lastDate: { $max: '$date' },
          },
        },
        {
          $lookup: {
            from: 'students',
            localField: '_id',
            foreignField: '_id',
            as: 'student',
            pipeline: [{ $project: { ...STUDENT_NAME_PROJECTION, ...ROSTER_STUDENT_PROJECTION } }],
          },
        },
        { $sort: { withAction: -1, entries: -1 } },
      ])
      .exec();

    // A tally is read as "who to speak to", so it lists the class as it stands
    // today: a student the office has marked as gone drops off it, while the
    // rows they earned stay in the register they were written into.
    return rows
      .filter((row) => isOnCurrentRoll(row.student[0]))
      .map((row) => ({
        studentId: row._id.toString(),
        studentCode: row.student[0]?.studentCode ?? null,
        studentNameLo: registerName(row.student[0]),
        studentNickname: nicknameOf(row.student[0]),
        entries: row.entries,
        withAction: row.withAction,
        lastDate: row.lastDate.toISOString().slice(0, 10),
      }));
  }

  /**
   * Who has written nothing this week — the register read the other way round.
   *
   * The other three reads all start from rows that exist, so none of them can
   * report the class nobody wrote about; this one starts from the timetable and
   * matches the register into it. Two callers, one shape: the academic office
   * asks about the whole school, and a teacher asks about themselves, which is
   * `teacherId` pinned to their own record rather than a separate report.
   *
   * The summary is computed before `outstandingOnly` narrows the rows, so the
   * headline numbers say what the window looks like rather than how long the list
   * on screen is.
   */
  async getWeeklyCoverage(
    query: CoverageQueryDto,
    options: { teacherId?: string | null; noLessons?: boolean } = {},
  ): Promise<LessonCoverage> {
    const teacherId = options.teacherId ?? query.teacherId ?? null;

    const now = new Date();
    // One day or one week, the same report — see `CoverageQueryDto`. Built
    // twice because the term is read off the window and the window carries the
    // term's bounds; the first pass only needs the dates, which the term cannot
    // move.
    const windowFor = (semester?: SemesterDocument | null) =>
      query.date
        ? dayWindow(query.date, now, semester)
        : weekWindow(query.weekOf ?? now, now, semester);

    // A named semester is honoured even when it is not the active one, so a head
    // can look back at a closed term; otherwise the term is read off the window
    // that was asked for rather than assumed to be the active one.
    const semester = query.semesterId
      ? await this.semesters.findOne(query.semesterId)
      : await resolveCoverageSemester(this.semesters, windowFor());

    // See the same read in `AttendancesService`: the register is not owed on a
    // day the school did not teach, and the calendar is the only thing that
    // knows which days those were.
    const bounds = windowFor(semester);
    // Per classroom as well as school-wide: a year or a room the office stood
    // down on its own owes nothing that day, while the rest of the school does.
    const schoolDays = await this.calendar.nonTeachingDaysFor(bounds.start, bounds.end);
    const window: CoverageWindow = {
      ...bounds,
      nonTeachingDays: schoolDays.schoolWide,
      nonTeachingDaysFor: schoolDays.forClassroom,
    };

    // The same widening the roll call makes: a teacher's own week has to include
    // the lessons they stood in on, which the timetable files under the teacher who
    // was away.
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
    const written = await this.loadWrittenRows(
      assignments.map((assignment) => assignment.teachingAssignmentId),
      window.start,
      window.end,
    );

    // Cover claimed in this window, so a day somebody stood in on is owed by them
    // rather than by the teacher whose lesson it is on the timetable.
    const substitutions = await this.lessons.substitutionIndex({
      semesterId: semester?._id ?? null,
      from: window.start,
      to: window.end,
      classroomId: query.classroomId,
    });

    const coverage = buildCoverage(window, assignments, written, {
      // A behaviour note is written when there is something to note, so one row
      // anywhere in the window is the whole of what the register is owed.
      covered: 'anyEntry',
      substitutions,
      semester: semester
        ? { id: semester._id.toString(), nameLo: semester.nameLo, nameEn: semester.nameEn ?? null }
        : null,
    });

    // Widening the timetable also brought in the absent teacher's share of the
    // covered lessons, which belongs on their row. Narrowed before the summary, so
    // the headline describes the same teacher the rows do.
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
   * ຄວາມຕົງເວລາໃນການບັນທຶກ — who writes the register up late.
   *
   * The same report as the roll call's, with the one rule that has to differ:
   * the register is written when there is something to note, so there is no such
   * thing as a missing entry and nothing is owed. What is judged is only the
   * entries that exist — of those, how many were filed after noon of the next
   * working day. Counting gaps here would contradict `getWeeklyCoverage`, which
   * holds the register to one entry per window.
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
      'entriesOnly',
    );
  }

  /**
   * The signed-in teacher's own week.
   *
   * An office account holds the permission but is nobody on the timetable, so it
   * gets an empty week rather than the school's — the screen this feeds is the
   * teacher's own reminder, and showing them everyone else's gaps there would be
   * a different report in the same place. `teacherId` is read off the session,
   * never the query, so the route cannot be pointed at a colleague.
   */
  async getMyWeeklyCoverage(
    query: CoverageQueryDto,
    actor: AuthenticatedUser,
  ): Promise<LessonCoverage & { teacherId: string | null }> {
    const teacherId = actor.personType === 'teacher' ? actor.personId : null;

    const coverage = await this.getWeeklyCoverage(
      // `teacherId` and `classroomId` are dropped from the query on purpose: this
      // route answers for the session's own teacher and nobody else, so there is
      // nothing here a client could widen. `date` is dropped too: this one is the
      // teacher's *week*, which is the span they are chased over — a day of it
      // says nothing about what is still owed by Friday.
      { weekOf: query.weekOf, semesterId: query.semesterId },
      // No teacher on the session means no lessons of their own — an unfiltered
      // read would hand a teacher-shaped screen the whole school's gaps.
      { teacherId, noLessons: !teacherId },
    );
    return { ...coverage, teacherId };
  }

  // ── internals ─────────────────────────────────────────────────────────────

  /**
   * What the register holds for those lessons inside the window.
   *
   * Counted as rows, not records: `groupId` is what a teacher writes, and a row
   * naming six students is one entry in the register rather than six.
   */
  private async loadWrittenRows(
    teachingAssignmentIds: string[],
    from: Date,
    to: Date,
  ): Promise<CoverageWritten[]> {
    if (teachingAssignmentIds.length === 0) return [];

    const rows = await this.model
      .aggregate<{
        _id: { assignment: Types.ObjectId; date: Date };
        groupIds: Types.ObjectId[];
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
          // Per day, and folded up below. A lesson somebody covered part of has to
          // be divided between two teachers, and the window's totals cannot be
          // divided after the fact — see `CoverageWritten.perDay`. Rows are still
          // counted as `groupId`s: a row naming six students is one entry in the
          // register rather than six.
          $group: {
            _id: { assignment: '$teachingAssignmentId', date: '$date' },
            groupIds: { $addToSet: '$groupId' },
            studentsNoted: { $sum: { $cond: [{ $eq: ['$studentId', null] }, 0, 1] } },
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
      found.entries += row.groupIds.length;
      found.studentsNoted += row.studentsNoted;
      found.dates.push(date);
      found.perDay!.push({ date, entries: row.groupIds.length, studentsNoted: row.studentsNoted });
      byAssignment.set(id, found);
    }

    return [...byAssignment.values()];
  }

  /** Trims the entries, refuses duplicates, and refuses a row that says nothing. */
  private normalizeEntries(
    entries: BehaviorEntryDto[] | undefined,
    classNote: string | undefined | null,
  ): BehaviorEntryDto[] {
    const list = (entries ?? []).map((entry) => ({
      studentId: entry.studentId,
      behavior: entry.behavior?.trim() || undefined,
      action: entry.action?.trim() || undefined,
    }));

    const ids = new Set(list.map((entry) => entry.studentId));
    if (ids.size !== list.length) throw AppException.badRequest('behaviorLog.duplicateStudent');

    // A row with neither a class note nor a student is a blank line in the
    // register, which is worse than no row at all.
    if (list.length === 0 && !classNote?.trim()) {
      throw AppException.badRequest('behaviorLog.emptyRow');
    }

    return list;
  }

  /**
   * One record per named student, or a single class-level record when no student
   * is named — which is how the paper's "the class as a whole" rows are stored.
   */
  private buildDocuments(
    shared: Record<string, unknown>,
    entries: BehaviorEntryDto[],
  ): Record<string, unknown>[] {
    if (entries.length === 0) {
      return [{ ...shared, studentId: null, behavior: null, action: null }];
    }
    return entries.map((entry) => ({
      ...shared,
      studentId: new Types.ObjectId(entry.studentId),
      behavior: entry.behavior ?? null,
      action: entry.action ?? null,
    }));
  }

  /** Refuses any student who is not on the class's active roster. */
  private async assertEnrolled(
    classroomId: Types.ObjectId,
    entries: BehaviorEntryDto[],
  ): Promise<void> {
    if (entries.length === 0) return;

    const roster = await this.enrollmentModel
      .find({ classroomId, status: 'active', deletedAt: null })
      .select('studentId')
      .lean()
      .exec();
    const enrolled = new Set(roster.map((row) => row.studentId.toString()));

    const unknown = entries.filter((entry) => !enrolled.has(entry.studentId));
    if (unknown.length > 0) {
      throw AppException.badRequest('score.studentNotInClassroom', {
        studentIds: unknown.map((entry) => entry.studentId),
      });
    }
  }

  /**
   * Every live record of a row, or 404. Teachers are held to their own lessons.
   *
   * Judged against the stored row rather than against the timetable, which is the
   * difference that matters once a lesson can be covered: the row names both the
   * timetabled teacher and the stand-in who filed it, so the person who wrote it
   * can still correct a typo in it — and can still do so after their claim has
   * been withdrawn, which is the state a mistaken row is most likely to be found
   * in.
   */
  private async getGroupOrFail(
    groupId: string,
    actor: AuthenticatedUser,
  ): Promise<BehaviorLogDocument[]> {
    if (!Types.ObjectId.isValid(groupId)) throw AppException.notFound();

    const records = await this.model
      .find({ groupId: new Types.ObjectId(groupId), deletedAt: null })
      .exec();
    if (records.length === 0) throw AppException.notFound();

    if (!this.lessons.canWriteRecord(records[0], actor)) {
      throw AppException.forbidden('attendance.notAssignedTeacher', { groupId });
    }

    return records;
  }

  private async softDeleteGroup(
    groupId: Types.ObjectId,
    actor: AuthenticatedUser,
    session?: ClientSession,
  ): Promise<void> {
    await this.model
      .updateMany(
        { groupId, deletedAt: null },
        { $set: { deletedAt: new Date(), deletedBy: new Types.ObjectId(actor.sub) } },
      )
      .session(session ?? null)
      .exec();
  }

  /** The period to stamp on the row, falling back to the day's first slot. */
  private periodNumberFor(assignment: TeachingAssignmentDocument, date: Date): number {
    const today = periodsOnDate(assignment.schedule, date).sort((a, b) =>
      a.startTime.localeCompare(b.startTime),
    );
    return today[0]?.periodNumber ?? 1;
  }
}
