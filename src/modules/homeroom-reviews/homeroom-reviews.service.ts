import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';
import { PaginatedResponse } from 'src/common/dto/pagination.dto';
import { AppException } from 'src/common/exceptions/app.exception';
import {
  DEFAULT_REVIEW_THRESHOLDS,
  flagStudents,
  normalizeThresholds,
  REVIEW_START_DATE_SETTING,
  REVIEW_THRESHOLDS_SETTING,
  type AttendanceFacts,
  type BehaviorFacts,
  type ConductFacts,
  type FlaggedStudent,
  type ReviewThresholds,
  type RosterEntry,
} from 'src/common/homeroom-review/review-anomalies';
import {
  buildReviewCompliance,
  currentReviewDay,
  reviewDaysIn,
  statusFor,
  type FiledReview,
  type ReviewCompliance,
  type ReviewDay,
  type ReviewDayCell,
  type ReviewSubject,
} from 'src/common/homeroom-review/review-days';
import type { AuthenticatedUser } from 'src/common/interfaces/authenticated-user.interface';
import { RecordScopeService } from 'src/common/services/record-scope.service';
import { isOnCurrentRoll, ROSTER_STUDENT_SELECT } from 'src/common/utils/current-roll';
import { nicknameOf, populatedStudent, registerName } from 'src/common/utils/student-name';
import {
  Attendance,
  AttendanceDocument,
  BehaviorLog,
  BehaviorLogDocument,
  Classroom,
  ClassroomDocument,
  ConductDeduction,
  ConductDeductionDocument,
  Enrollment,
  EnrollmentDocument,
  HomeroomReview,
  HomeroomReviewDocument,
  SemesterDocument,
} from 'src/database/schemas';
import { AttendancesService } from '../attendances/attendances.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { BehaviorLogsService } from '../behavior-logs/behavior-logs.service';
import { CalendarService } from '../calendar/calendar.service';
import { ConductDeductionsService } from '../conduct-deductions/conduct-deductions.service';
import { SemestersService } from '../semesters/semesters.service';
import { SettingsService } from '../settings/settings.service';
import {
  CreateHomeroomReviewDto,
  HomeroomReviewStudentDto,
  QueryHomeroomReviewsDto,
  ReviewComplianceQueryDto,
  ReviewSheetQueryDto,
  UpdateHomeroomReviewDto,
} from './dto/homeroom-review.dto';

/**
 * How many rows of each kind a child's evidence carries.
 *
 * Enough to see the pattern — a fortnight of Mondays, three write-ups in one
 * subject — without turning a sheet meant for acting on into a term's export.
 * Anything beyond it is counted and reported as "and N more".
 */
const EVIDENCE_LIMIT = 12;

/** The two actions that claim a guardian was reached. */
const CONTACTING_ACTIONS = new Set(['contacted_guardian']);

/** A classroom carrying its grade and its homeroom teacher, which every read here needs. */
const CLASSROOM_POPULATE = [
  { path: 'gradeLevelId', select: 'code nameLo nameEn' },
  {
    path: 'homeroomTeacherId',
    select: 'teacherCode firstNameLo lastNameLo firstNameEn lastNameEn',
  },
] as const;

interface PopulatedTeacher {
  _id: Types.ObjectId;
  teacherCode?: string | null;
  firstNameLo: string;
  lastNameLo: string;
}

/** The class as the sheet's header names it. */
export interface SheetClassroom {
  id: string;
  name: string;
  gradeLevelCode: string | null;
  teacherId: string | null;
  teacherCode: string | null;
  teacherName: string | null;
  studentsOnRoll: number;
}

/** A review as it is read back — the filed act, plus what it is worth now. */
export interface FiledReviewView {
  id: string;
  classroomId: string;
  teacherId: string;
  dueDate: string;
  windowStart: string;
  windowEnd: string;
  reviewedAt: string;
  studentsOnRoll: number;
  studentsFlagged: number;
  students: {
    studentId: string;
    studentCode: string | null;
    studentNameLo: string | null;
    reasons: { kind: string; scope: string; value: number; threshold: number }[];
    action: string;
    contactChannel: string | null;
    note: string | null;
  }[];
  note: string | null;
  /** Derived, never stored — the deadline moves with the calendar. */
  status: ReviewDayCell['status'];
  hoursLate: number;
}

/**
 * What the teacher's screen opens on: one room, one review day, the children to look at.
 */
export interface HomeroomReviewSheet {
  classroom: SheetClassroom;
  semester: { id: string; nameLo: string; nameEn: string | null };
  /**
   * `null` when the term has not reached a review day yet.
   *
   * The deadline is serialized, unlike the engine's `Date` — this crosses the
   * wire, and every other date in an API response here is a string.
   */
  reviewDay: (Omit<ReviewDay, 'deadline'> & { deadline: string | null }) | null;
  /** Where this room stands on that day, derived exactly as the office sees it. */
  status: ReviewDayCell['status'];
  /**
   * Every review day the term has owed for this room, with where each stands.
   *
   * What lets the screen offer a day to file rather than only today's: a teacher
   * who was away on Wednesday has to be able to reach Wednesday's sheet, and
   * without this the days the office is counting as missing would be the one
   * thing the teacher could not open.
   */
  days: ReviewDayCell[];
  /** The thresholds the shortlist was built with, so the sheet can explain itself. */
  thresholds: ReviewThresholds;
  studentsOnRoll: number;
  flagged: SheetStudent[];
  /** The review already on file for this day, if any — what an amendment edits. */
  review: FiledReviewView | null;
  /** The previous day's review, so the teacher can see what they last said. */
  previousReview: FiledReviewView | null;
}

/**
 * What is actually behind a flag — the rows the counts were made of.
 *
 * A badge saying "ຂາດລວມ 9 ວັນ" tells a homeroom teacher that something is wrong
 * and nothing about what to say to the guardian: which days, in whose lesson,
 * and what the child was written up for. Without it the teacher has to leave this
 * screen for the roll call, then the register, then the ledger — which is the
 * four-screen errand this page exists to replace.
 *
 * Read from the same collections the three services read, and capped per child:
 * enough to explain a flag, never a term's worth of rows in one response.
 */
export interface StudentEvidence {
  /** Days the roll call has anything but `present`, newest first. */
  attendance: {
    date: string;
    status: string;
    subjectNameLo: string | null;
    period: number;
    /**
     * ເຫດຜົນ — what the teacher wrote when marking the roll, free text.
     *
     * The difference between "absent" and "absent, mother in hospital" is the
     * whole of what a homeroom teacher needs before ringing a guardian, and it
     * is already on the record — it was simply not being carried here.
     */
    reason: string | null;
    /** Minutes late; only meaningful when `status` is `late`. */
    minutesLate: number | null;
    /** Whether the day falls in the stretch since the last review. */
    inWindow: boolean;
  }[];
  /** Register entries naming this child, newest first. */
  behavior: {
    date: string;
    subjectNameLo: string | null;
    teacherName: string | null;
    behavior: string | null;
    action: string | null;
    inWindow: boolean;
  }[];
  /** Discipline ledger rows still standing, newest first. */
  conduct: {
    date: string;
    ruleCode: string;
    ruleNameLo: string;
    points: number;
    note: string | null;
  }[];
  /** How many rows were left out by the cap, per source. */
  more: { attendance: number; behavior: number; conduct: number };
}

/** A flagged child, with the rows behind the flag. */
export type SheetStudent = FlaggedStudent & { evidence: StudentEvidence };

/** One room of the teacher's own dashboard: what they owe right now. */
export interface MyHomeroomStatus {
  classroom: SheetClassroom;
  reviewDay: string | null;
  status: ReviewDayCell['status'];
  /** Review days in the term to date with nothing on file, most recent first. */
  missingDays: string[];
  lastReviewedAt: string | null;
  /** Children the sheet would flag right now — the reason to open it. */
  flagged: number;
}

/**
 * ການຕິດຕາມນັກຮຽນຂອງຄູປະຈຳຫ້ອງ — the homeroom teacher's twice-weekly review.
 *
 * The school already gives the instruction and the system already sends the
 * ວັນພຸດ/ວັນສຸກ reminder. What was missing was anything written back: a reminder
 * that is only ever sent cannot tell the office who read it, so a homeroom
 * teacher who checks their class every week and one who has not opened the room
 * since August looked identical. This module is the acknowledgement, and it is
 * built so that the acknowledgement is worth having on its own — the record of
 * which child was flagged and which guardian was rung is the thing a meeting is
 * later held over.
 *
 * Nothing here invents its own idea of what is wrong with a child. The three
 * facts it triages on are read from the services that already compute them — the
 * roll call's summary, the register's tally and the discipline ledger — so the
 * sheet in front of the teacher and the numbers on the office's screens cannot
 * disagree. The thresholds are settings, because which of them is worth a phone
 * call is the school's judgement and not this file's.
 */
@Injectable()
export class HomeroomReviewsService {
  constructor(
    @InjectModel(HomeroomReview.name) private readonly model: Model<HomeroomReviewDocument>,
    @InjectModel(Classroom.name) private readonly classrooms: Model<ClassroomDocument>,
    @InjectModel(Enrollment.name) private readonly enrollments: Model<EnrollmentDocument>,
    // Read directly, and only for the handful of children already flagged: the
    // three services answer "how many", and the sheet also has to show which.
    @InjectModel(Attendance.name) private readonly attendanceModel: Model<AttendanceDocument>,
    @InjectModel(BehaviorLog.name) private readonly behaviorModel: Model<BehaviorLogDocument>,
    @InjectModel(ConductDeduction.name)
    private readonly deductionModel: Model<ConductDeductionDocument>,
    private readonly semesters: SemestersService,
    private readonly calendar: CalendarService,
    private readonly attendances: AttendancesService,
    private readonly behaviorLogs: BehaviorLogsService,
    private readonly conduct: ConductDeductionsService,
    private readonly settings: SettingsService,
    private readonly scope: RecordScopeService,
    private readonly audit: AuditLogsService,
  ) {}

  // ── The teacher's side ────────────────────────────────────────────────────

  /**
   * The sheet: this room, this review day, and the handful of children to look at.
   *
   * The window is the days since the previous review day rather than a fixed
   * three: if Wednesday was a holiday, Friday's sheet has to account for the
   * whole week, and a teacher told "since Thursday" would never see Monday's
   * absence at all.
   */
  async getSheet(
    query: ReviewSheetQueryDto,
    actor: AuthenticatedUser,
  ): Promise<HomeroomReviewSheet> {
    const { classroom, semester, reviewDays } = await this.context(query.classroomId, actor);

    const day = query.dueDate
      ? (reviewDays.find((candidate) => candidate.date === query.dueDate) ??
        this.refuseDate(query.dueDate))
      : currentReviewDay(reviewDays, new Date());

    const roster = await this.roster(classroom.id);
    const shortlist = day ? await this.flagged(classroom.id, semester, day, roster) : [];
    const evidence = day
      ? await this.evidenceFor(
          shortlist.map((student) => student.studentId),
          semester,
          day,
        )
      : new Map<string, StudentEvidence>();
    const flagged: SheetStudent[] = shortlist.map((student) => ({
      ...student,
      evidence: evidence.get(student.studentId) ?? {
        attendance: [],
        behavior: [],
        conduct: [],
        more: { attendance: 0, behavior: 0, conduct: 0 },
      },
    }));

    const [review, previous, filed] = await Promise.all([
      day ? this.filedFor(classroom.id, day.date) : Promise.resolve(null),
      this.previousFiled(classroom.id, day?.date ?? null),
      this.filedForRoom(classroom.id, semester._id),
    ]);

    // The same read the office's grid makes, narrowed to one room — so the day a
    // teacher sees as missing here is the day that is red over there.
    const now = new Date();
    const byDay = new Map(filed.map((row) => [row.dueDate, row]));
    const days = reviewDays.map((candidate) =>
      statusFor(candidate, byDay.get(candidate.date), now),
    );

    return {
      classroom: { ...classroom, studentsOnRoll: roster.length },
      semester: {
        id: semester._id.toString(),
        nameLo: semester.nameLo,
        nameEn: semester.nameEn ?? null,
      },
      reviewDay: day ? { ...day, deadline: day.deadline?.toISOString() ?? null } : null,
      status: day
        ? statusFor(day, review ? this.toFiled(review) : undefined, now).status
        : 'pending',
      days,
      thresholds: await this.thresholds(),
      studentsOnRoll: roster.length,
      flagged,
      review: review ? this.toView(review, day) : null,
      previousReview: previous ? this.toView(previous, null) : null,
    };
  }

  /**
   * ຢືນຢັນການຕິດຕາມ — files the review.
   *
   * The sheet is rebuilt here rather than trusted from the client, and the reasons
   * are snapshotted off that rebuild: a review has to say what the teacher was
   * actually shown, and a client that could name its own reasons could file a
   * review claiming a child was flagged for an absence they never had.
   *
   * A child the teacher adds who was *not* flagged is kept, with no reasons — a
   * homeroom teacher noticing something the thresholds did not is the best
   * outcome this screen has, and refusing it would teach them to stop looking.
   */
  async create(
    dto: CreateHomeroomReviewDto,
    actor: AuthenticatedUser,
    ip: string | null,
  ): Promise<FiledReviewView> {
    const { classroom, semester, reviewDays } = await this.context(dto.classroomId, actor, {
      forWriting: true,
    });

    const day = dto.dueDate
      ? (reviewDays.find((candidate) => candidate.date === dto.dueDate) ??
        this.refuseDate(dto.dueDate))
      : currentReviewDay(reviewDays, new Date());
    if (!day) throw AppException.badRequest('homeroomReview.noReviewDayYet');

    if (!classroom.teacherId) throw AppException.badRequest('homeroomReview.noHomeroomTeacher');

    const roster = await this.roster(classroom.id);
    const flagged = await this.flagged(classroom.id, semester, day, roster);
    const students = this.buildStudents(dto.students ?? [], roster, flagged);

    const created = await this.model
      .create({
        classroomId: new Types.ObjectId(classroom.id),
        teacherId: new Types.ObjectId(classroom.teacherId),
        recordedById: actor.sub ? new Types.ObjectId(actor.sub) : null,
        schoolYearId: semester.schoolYearId,
        semesterId: semester._id,
        dueDate: new Date(`${day.date}T00:00:00.000Z`),
        windowStart: new Date(`${day.windowStart}T00:00:00.000Z`),
        windowEnd: new Date(`${day.windowEnd}T00:00:00.000Z`),
        studentsOnRoll: roster.length,
        studentsFlagged: flagged.length,
        students,
        note: dto.note?.trim() || null,
      })
      .catch((error: unknown) => {
        // The unique index on (classroomId, dueDate) is what says "one review per
        // room per day"; a second POST is an amendment the client should have
        // sent as a PUT.
        if (isDuplicateKey(error)) throw AppException.conflict('homeroomReview.alreadyFiled');
        throw error;
      });

    await this.audit.record({
      userId: actor.sub,
      username: actor.username,
      action: 'create',
      entityType: 'HomeroomReview',
      entityId: created._id.toString(),
      newValue: {
        classroomId: classroom.id,
        dueDate: day.date,
        studentsFlagged: flagged.length,
        studentsListed: students.length,
        guardiansContacted: students.filter((student) => CONTACTING_ACTIONS.has(student.action))
          .length,
      },
      ip,
    });

    return this.toView(created, day);
  }

  /** Amends a review already filed. The filing time is untouched — see the DTO. */
  async update(
    id: string,
    dto: UpdateHomeroomReviewDto,
    actor: AuthenticatedUser,
    ip: string | null,
  ): Promise<FiledReviewView> {
    const review = await this.getOrFail(id);
    const { classroom, semester, reviewDays } = await this.context(
      review.classroomId.toString(),
      actor,
      { forWriting: true },
    );

    const dueDate = review.dueDate.toISOString().slice(0, 10);
    const day = reviewDays.find((candidate) => candidate.date === dueDate) ?? null;

    if (dto.students) {
      const roster = await this.roster(classroom.id);
      const flagged = day ? await this.flagged(classroom.id, semester, day, roster) : [];
      review.students = this.buildStudents(dto.students, roster, flagged) as never;
    }
    if (dto.note !== undefined) review.note = dto.note?.trim() || null;

    await review.save();

    await this.audit.record({
      userId: actor.sub,
      username: actor.username,
      action: 'update',
      entityType: 'HomeroomReview',
      entityId: review._id.toString(),
      newValue: { dueDate, studentsListed: review.students.length },
      ip,
    });

    return this.toView(review, day);
  }

  /**
   * Withdraws a review.
   *
   * Soft, and the partial unique index lets the room file again — a withdrawn
   * sheet must not lock the day. Gated on `delete`, which the matrix gives the
   * office and not the teacher: a teacher who could delete their own review could
   * un-say what they told a guardian.
   */
  async remove(id: string, actor: AuthenticatedUser, ip: string | null): Promise<void> {
    const review = await this.getOrFail(id);
    review.deletedAt = new Date();
    await review.save();

    await this.audit.record({
      userId: actor.sub,
      username: actor.username,
      action: 'delete',
      entityType: 'HomeroomReview',
      entityId: review._id.toString(),
      oldValue: { dueDate: review.dueDate.toISOString().slice(0, 10) },
      ip,
    });
  }

  /**
   * The signed-in teacher's own rooms, and what each owes right now.
   *
   * Scoped to the session and never to a teacher named by the client, like the
   * register's own `weekly-coverage/mine`. An office account is nobody's homeroom
   * teacher and gets an empty list rather than the school's.
   */
  async getMine(actor: AuthenticatedUser): Promise<MyHomeroomStatus[]> {
    if (actor.personType !== 'teacher' || !actor.personId) return [];

    const semester = await this.semesters.findActive();
    if (!semester) return [];

    const rooms = await this.classrooms
      .find({
        homeroomTeacherId: new Types.ObjectId(actor.personId),
        schoolYearId: semester.schoolYearId,
        isActive: true,
        deletedAt: null,
      })
      .populate(CLASSROOM_POPULATE as never)
      .lean()
      .exec();
    if (rooms.length === 0) return [];

    const now = new Date();
    const reviewDays = await this.reviewDaysFor(semester, now);
    const today = currentReviewDay(reviewDays, now);

    const filed = await this.model
      .find({
        classroomId: { $in: rooms.map((room) => room._id) },
        semesterId: semester._id,
        deletedAt: null,
      })
      .select('classroomId dueDate createdAt')
      .lean()
      .exec();

    return Promise.all(
      rooms.map(async (room) => {
        const classroom = this.toSheetClassroom(room);
        const mine = filed.filter((review) => String(review.classroomId) === classroom.id);
        const byDay = new Map(
          mine.map((review) => [
            review.dueDate.toISOString().slice(0, 10),
            { reviewedAt: review.createdAt as Date },
          ]),
        );

        const cells = reviewDays.map((day) =>
          statusFor(
            day,
            byDay.has(day.date)
              ? {
                  classroomId: classroom.id,
                  dueDate: day.date,
                  reviewedAt: byDay.get(day.date)!.reviewedAt,
                  studentsFlagged: 0,
                  studentsActioned: 0,
                  guardiansContacted: 0,
                }
              : undefined,
            now,
          ),
        );

        const roster = await this.roster(classroom.id);
        const flagged = today ? await this.flagged(classroom.id, semester, today, roster) : [];
        const lastFiled = mine
          .map((review) => review.createdAt as Date)
          .sort((a, b) => a.getTime() - b.getTime())
          .pop();

        return {
          classroom: { ...classroom, studentsOnRoll: roster.length },
          reviewDay: today?.date ?? null,
          status: today
            ? (cells.find((cell) => cell.date === today.date)?.status ?? 'pending')
            : 'pending',
          missingDays: cells
            .filter((cell) => cell.status === 'missing')
            .map((cell) => cell.date)
            .reverse(),
          lastReviewedAt: lastFiled?.toISOString() ?? null,
          flagged: flagged.length,
        };
      }),
    );
  }

  /**
   * The rooms the ວັນພຸດ/ວັນສຸກ reminder still has something to say about.
   *
   * What makes the reminder worth reading: it used to go to every homeroom
   * teacher whether or not they had already looked, and a reminder that arrives
   * when you are up to date is the fastest way to teach somebody to ignore the
   * next one. So this returns only the rooms with nothing on file — for the
   * current review day, and for the earlier ones still outstanding.
   *
   * `flagged` is counted per room because it is the reason to open the sheet at
   * all: "3 ຄົນຄວນເບິ່ງ" is a different message from "go and check". It costs a
   * handful of reads per room, which is affordable twice a week in the worker and
   * would not be on a request path.
   */
  async outstandingForReminder(): Promise<{
    reviewDay: string | null;
    rooms: {
      classroomId: string;
      classroomName: string;
      teacherId: string | null;
      studentsOnRoll: number;
      flagged: number;
      /** Earlier review days with nothing on file — the ones already counted missing. */
      missingDays: string[];
      /** Whether the current review day itself is still unconfirmed. */
      currentOutstanding: boolean;
    }[];
  }> {
    const semester = await this.semesters.findActive();
    if (!semester) return { reviewDay: null, rooms: [] };

    const now = new Date();
    const reviewDays = await this.reviewDaysFor(semester, now);
    const current = currentReviewDay(reviewDays, now);

    const rooms = await this.classrooms
      .find({
        schoolYearId: semester.schoolYearId,
        homeroomTeacherId: { $ne: null },
        isActive: true,
        deletedAt: null,
      })
      .populate(CLASSROOM_POPULATE as never)
      .lean()
      .exec();
    if (rooms.length === 0) return { reviewDay: current?.date ?? null, rooms: [] };

    const filed = await this.model
      .find({
        classroomId: { $in: rooms.map((room) => room._id) },
        semesterId: semester._id,
        deletedAt: null,
      })
      .select('classroomId dueDate createdAt')
      .lean()
      .exec();

    const out: Awaited<ReturnType<HomeroomReviewsService['outstandingForReminder']>>['rooms'] = [];

    for (const room of rooms) {
      const classroom = this.toSheetClassroom(room);
      const byDay = new Map(
        filed
          .filter((review) => String(review.classroomId) === classroom.id)
          .map((review) => [review.dueDate.toISOString().slice(0, 10), review.createdAt as Date]),
      );

      const missingDays = reviewDays
        .filter((day) => {
          if (byDay.has(day.date)) return false;
          // Only the days already past their deadline: today's is chased by
          // `currentOutstanding`, not reported as a miss.
          return day.deadline !== null && now > day.deadline;
        })
        .map((day) => day.date);

      const currentOutstanding = Boolean(current && !byDay.has(current.date));
      if (!currentOutstanding && missingDays.length === 0) continue;

      const roster = await this.roster(classroom.id);
      const flagged = current ? await this.flagged(classroom.id, semester, current, roster) : [];

      out.push({
        classroomId: classroom.id,
        classroomName: classroom.name,
        teacherId: classroom.teacherId,
        studentsOnRoll: roster.length,
        flagged: flagged.length,
        missingDays,
        currentOutstanding,
      });
    }

    return { reviewDay: current?.date ?? null, rooms: out };
  }

  // ── The office's side ─────────────────────────────────────────────────────

  /**
   * ການຕິດຕາມຂອງຄູປະຈຳຫ້ອງ — who has checked their class, and who has not.
   *
   * Starts from the rooms and the calendar, so a room nobody has opened is a row
   * rather than an absence. Defaults to the active term to date for the same
   * reason the other two oversight reports do: the office's question is "who is
   * behind *now*".
   */
  async getCompliance(query: ReviewComplianceQueryDto): Promise<ReviewCompliance> {
    const now = new Date();
    const today = toUtcMidnight(now);

    const semester = query.semesterId
      ? await this.semesters.findOneOrFail(query.semesterId)
      : ((query.from || query.to
          ? await this.semesters.findForRange(
              toUtcMidnight(query.from ?? query.to!),
              toUtcMidnight(query.to ?? query.from!),
            )
          : null) ?? (await this.semesters.findActive()));

    if (!semester) {
      return buildReviewCompliance({
        window: { start: today, end: today, asOf: today },
        reviewDays: [],
        subjects: [],
        filed: [],
        now,
      });
    }

    // An explicit `from` is the office's own question and is honoured as asked;
    // the default start is the later of the term and the day this went live.
    const liveFrom = await this.startDate();
    const termStart = toUtcMidnight(semester.startDate);
    const start = query.from
      ? toUtcMidnight(query.from)
      : liveFrom && liveFrom > termStart
        ? liveFrom
        : termStart;
    const requestedEnd = query.to ? toUtcMidnight(query.to) : today;
    const end = requestedEnd < start ? start : requestedEnd;
    const asOf = today < end ? today : end;

    const calendar = await this.calendar.calendarFor(start, end);
    // The school's own review days — the report's columns, and the answer for
    // every room the office did not stand down on its own.
    const reviewDays = reviewDaysIn({ start, end }, calendar);

    const roomFilter: FilterQuery<ClassroomDocument> = {
      schoolYearId: semester.schoolYearId,
      isActive: true,
      deletedAt: null,
    };
    if (query.classroomId) roomFilter._id = new Types.ObjectId(query.classroomId);
    if (query.teacherId) roomFilter.homeroomTeacherId = new Types.ObjectId(query.teacherId);

    const rooms = await this.classrooms
      .find(roomFilter)
      .populate(CLASSROOM_POPULATE as never)
      .sort({ name: 1 })
      .lean()
      .exec();

    const subjects: ReviewSubject[] = rooms.map((room) => {
      const classroom = this.toSheetClassroom(room);
      return { ...classroom, classroomId: classroom.id, classroomName: classroom.name };
    });

    const filed = await this.model
      .find({
        classroomId: { $in: rooms.map((room) => room._id) },
        dueDate: { $gte: start, $lte: end },
        deletedAt: null,
      })
      .select('classroomId dueDate createdAt studentsFlagged students')
      .lean()
      .exec();

    // A room stood down on a ວັນພຸດ owes no sheet for it, while every other room
    // still owes theirs — so each room's days are worked out against its own
    // grade level. Built here, where the rooms and their grades are already in
    // hand, and cached by room so the window is walked once each.
    const ownDays = new Map<string, ReviewDay[]>();
    for (const room of rooms) {
      ownDays.set(
        String(room._id),
        reviewDaysIn({ start, end }, calendar, undefined, {
          classroomId: String(room._id),
          gradeLevelId: gradeLevelIdOf(room.gradeLevelId),
        }),
      );
    }

    const report = buildReviewCompliance({
      window: { start, end, asOf },
      reviewDays,
      reviewDaysFor: (classroomId) => ownDays.get(classroomId),
      subjects,
      filed: filed.map((review) => this.toFiled(review as never)),
      now,
      semester: {
        id: semester._id.toString(),
        nameLo: semester.nameLo,
        nameEn: semester.nameEn ?? null,
      },
    });

    if (!query.outstandingOnly) return report;
    return { ...report, rows: report.rows.filter((row) => row.missing > 0) };
  }

  /**
   * The reviews themselves, newest first.
   *
   * What a guardian meeting is prepared from: `studentId` narrows it to every
   * time one child was flagged and what was done, which is the history the office
   * has never had on paper.
   */
  async findAll(query: QueryHomeroomReviewsDto): Promise<PaginatedResponse<FiledReviewView>> {
    const { page = 1, limit = 20 } = query;
    const filter: FilterQuery<HomeroomReviewDocument> = { deletedAt: null };

    if (query.classroomId) filter.classroomId = new Types.ObjectId(query.classroomId);
    if (query.teacherId) filter.teacherId = new Types.ObjectId(query.teacherId);
    if (query.semesterId) filter.semesterId = new Types.ObjectId(query.semesterId);
    if (query.studentId) filter['students.studentId'] = new Types.ObjectId(query.studentId);
    if (query.from || query.to) {
      filter.dueDate = {
        ...(query.from ? { $gte: toUtcMidnight(query.from) } : {}),
        ...(query.to ? { $lte: toUtcMidnight(query.to) } : {}),
      };
    }

    const [rows, total] = await Promise.all([
      this.model
        .find(filter)
        .sort({ dueDate: -1, createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean()
        .exec(),
      this.model.countDocuments(filter).exec(),
    ]);

    return new PaginatedResponse(
      rows.map((row) => this.toView(row as never, null)),
      total,
      page,
      limit,
    );
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  /**
   * The room, the term and the review days — the three things every read needs.
   *
   * `forWriting` is where the homeroom rule is enforced: reading another room's
   * sheet is oversight the office holds, but confirming a review for a room that
   * is not yours would put your name on a class you never looked at.
   */
  private async context(
    classroomId: string,
    actor: AuthenticatedUser,
    options: { forWriting?: boolean } = {},
  ): Promise<{ classroom: SheetClassroom; semester: SemesterDocument; reviewDays: ReviewDay[] }> {
    const room = await this.classrooms
      .findOne({ _id: new Types.ObjectId(classroomId), deletedAt: null })
      .populate(CLASSROOM_POPULATE as never)
      .lean()
      .exec();
    if (!room) throw AppException.notFound();

    const classroom = this.toSheetClassroom(room);

    // `null` is "not narrowed to a room" — the office and the admin. A teacher
    // gets the list of their own rooms, and an empty list means they have none.
    const mine = await this.scope.homeroomClassroomIds(actor);
    if (mine !== null) {
      const permitted = mine.some((id) => id.toString() === classroom.id);
      if (!permitted) throw AppException.forbidden('homeroomReview.notHomeroomTeacher');
    } else if (options.forWriting && actor.personType === 'teacher' && actor.personId) {
      // A teacher who also holds a school-wide permission is still writing as the
      // homeroom teacher, so the room has to be theirs.
      if (classroom.teacherId !== actor.personId) {
        throw AppException.forbidden('homeroomReview.notHomeroomTeacher');
      }
    }

    const semester = await this.semesters.getActiveOrFail();
    const reviewDays = await this.reviewDaysFor(semester, new Date());

    return { classroom, semester, reviewDays };
  }

  /** Every review day the term has owed up to `now`, plus the one still running. */
  private async reviewDaysFor(semester: SemesterDocument, now: Date): Promise<ReviewDay[]> {
    const liveFrom = await this.startDate();
    const termStart = toUtcMidnight(semester.startDate);
    // The later of the two: a term that began before the school had the screen
    // owes nothing for the weeks it did not have it.
    const start = liveFrom && liveFrom > termStart ? liveFrom : termStart;
    const termEnd = toUtcMidnight(semester.endDate);
    const today = toUtcMidnight(now);
    const end = today < termEnd ? today : termEnd;

    const calendar = await this.calendar.calendarFor(start, end);
    return reviewDaysIn({ start, end }, calendar);
  }

  /** The class as it stands today — the current roll, not every enrollment row. */
  private async roster(classroomId: string): Promise<RosterEntry[]> {
    const rows = await this.enrollments
      .find({
        classroomId: new Types.ObjectId(classroomId),
        status: 'active',
        deletedAt: null,
      })
      .populate('studentId', ROSTER_STUDENT_SELECT)
      .sort({ rollNumber: 1 })
      .lean()
      .exec();

    return rows
      .filter((row) => isOnCurrentRoll(row.studentId))
      .map((row) => {
        const student = populatedStudent(row.studentId);
        return {
          studentId: student?._id.toString() ?? String(row.studentId),
          studentCode: row.studentCode ?? null,
          studentNameLo: row.studentNameLo ?? registerName(student),
          studentNickname: nicknameOf(student),
          rollNumber: row.rollNumber ?? null,
        };
      });
  }

  /**
   * The shortlist, from the three services that already compute the facts.
   *
   * Five reads rather than one aggregation, deliberately: each of them is the
   * same read the corresponding screen makes, so a teacher who follows a flag
   * through to the roll call finds the same number there.
   */
  private async flagged(
    classroomId: string,
    semester: SemesterDocument,
    day: ReviewDay,
    roster: RosterEntry[],
  ): Promise<FlaggedStudent[]> {
    if (roster.length === 0) return [];

    const semesterId = semester._id.toString();
    const window = { from: day.windowStart, to: day.windowEnd };

    const [windowAttendance, windowBehavior, termAttendance, termBehavior, termConduct] =
      await Promise.all([
        this.attendances.getClassroomSummary(classroomId, semesterId, window as never),
        this.behaviorLogs.getClassroomTally(classroomId, semesterId, window as never),
        this.attendances.getClassroomSummary(classroomId, semesterId, {} as never),
        this.behaviorLogs.getClassroomTally(classroomId, semesterId, {} as never),
        this.conduct.getClassroomYearSummary(classroomId, semester.schoolYearId.toString()),
      ]);

    const attendanceFacts = (
      rows: Awaited<ReturnType<AttendancesService['getClassroomSummary']>>,
    ) =>
      rows.map<AttendanceFacts>((row) => ({
        studentId: row.studentId,
        absentUnexcused: row.absentUnexcused,
        late: row.late,
        absentExcused: row.absentExcused,
        attendanceRate: row.attendanceRate,
        totalRecorded: row.totalRecorded,
      }));

    const behaviorFacts = (rows: Awaited<ReturnType<BehaviorLogsService['getClassroomTally']>>) =>
      rows.map<BehaviorFacts>((row) => ({
        studentId: row.studentId,
        entries: row.entries,
        withAction: row.withAction,
        lastDate: row.lastDate,
      }));

    const conductFacts = termConduct.map<ConductFacts>((row) => ({
      studentId: row.studentId,
      deducted: row.deducted,
      remaining: row.remaining,
    }));

    return flagStudents({
      roster,
      window: {
        attendance: attendanceFacts(windowAttendance),
        behavior: behaviorFacts(windowBehavior),
      },
      term: {
        attendance: attendanceFacts(termAttendance),
        behavior: behaviorFacts(termBehavior),
        conduct: conductFacts,
      },
      thresholds: await this.thresholds(),
    });
  }

  /**
   * The rows behind the flags, for the children already shortlisted.
   *
   * Three reads for the whole sheet rather than three per child, and only for the
   * children who were flagged — a class where nothing is wrong costs nothing.
   * Capped per child on the way out: a term's roll call for a child at 40
   * absences is not something to put on a screen a teacher is meant to act from.
   */
  private async evidenceFor(
    studentIds: string[],
    semester: SemesterDocument,
    day: ReviewDay,
  ): Promise<Map<string, StudentEvidence>> {
    const empty = (): StudentEvidence => ({
      attendance: [],
      behavior: [],
      conduct: [],
      more: { attendance: 0, behavior: 0, conduct: 0 },
    });

    const evidence = new Map<string, StudentEvidence>(studentIds.map((id) => [id, empty()]));
    if (studentIds.length === 0) return evidence;

    const ids = studentIds.map((id) => new Types.ObjectId(id));
    const inWindow = (date: Date) => {
      const key = date.toISOString().slice(0, 10);
      return key >= day.windowStart && key <= day.windowEnd;
    };

    const [attendance, behavior, conduct] = await Promise.all([
      // Anything but `present`: an excused day is not a flag, but it is exactly
      // what a teacher needs to see before ringing a guardian about absences.
      this.attendanceModel
        .find({
          studentId: { $in: ids },
          semesterId: semester._id,
          status: { $ne: 'present' },
          deletedAt: null,
        })
        .select('studentId date status period subjectId reason minutesLate')
        .populate('subjectId', 'nameLo')
        .sort({ date: -1 })
        .lean()
        .exec(),
      this.behaviorModel
        .find({
          studentId: { $in: ids },
          semesterId: semester._id,
          deletedAt: null,
        })
        .select('studentId date behavior action subjectId teacherId')
        .populate('subjectId', 'nameLo')
        .populate('teacherId', 'firstNameLo lastNameLo')
        .sort({ date: -1 })
        .lean()
        .exec(),
      // The year rather than the term: the 100 conduct points are a year's
      // budget, so a term-long ledger would not add up to the balance shown.
      this.deductionModel
        .find({
          studentId: { $in: ids },
          schoolYearId: semester.schoolYearId,
          deletedAt: null,
        })
        .select('studentId date ruleCode ruleNameLo points note')
        .sort({ date: -1 })
        .lean()
        .exec(),
    ]);

    const push = <T>(
      rows: { studentId?: Types.ObjectId | null }[],
      pick: (row: never) => T,
      into: (bucket: StudentEvidence) => T[],
      countMore: (bucket: StudentEvidence) => void,
    ) => {
      for (const row of rows) {
        const bucket = evidence.get(String(row.studentId));
        if (!bucket) continue;
        const list = into(bucket);
        if (list.length >= EVIDENCE_LIMIT) {
          countMore(bucket);
          continue;
        }
        list.push(pick(row as never));
      }
    };

    push(
      attendance,
      (row: {
        date: Date;
        status: string;
        period: number;
        subjectId?: { nameLo?: string } | null;
        reason?: string | null;
        minutesLate?: number | null;
      }) => ({
        date: row.date.toISOString().slice(0, 10),
        status: row.status,
        subjectNameLo: row.subjectId?.nameLo ?? null,
        period: row.period,
        reason: row.reason ?? null,
        minutesLate: row.minutesLate ?? null,
        inWindow: inWindow(row.date),
      }),
      (bucket) => bucket.attendance,
      (bucket) => {
        bucket.more.attendance += 1;
      },
    );

    push(
      behavior,
      (row: {
        date: Date;
        behavior?: string | null;
        action?: string | null;
        subjectId?: { nameLo?: string } | null;
        teacherId?: { firstNameLo?: string; lastNameLo?: string } | null;
      }) => ({
        date: row.date.toISOString().slice(0, 10),
        subjectNameLo: row.subjectId?.nameLo ?? null,
        teacherName: row.teacherId
          ? `${row.teacherId.firstNameLo ?? ''} ${row.teacherId.lastNameLo ?? ''}`.trim() || null
          : null,
        behavior: row.behavior ?? null,
        action: row.action ?? null,
        inWindow: inWindow(row.date),
      }),
      (bucket) => bucket.behavior,
      (bucket) => {
        bucket.more.behavior += 1;
      },
    );

    push(
      conduct,
      (row: {
        date: Date;
        ruleCode: string;
        ruleNameLo: string;
        points: number;
        note?: string | null;
      }) => ({
        date: row.date.toISOString().slice(0, 10),
        ruleCode: row.ruleCode,
        ruleNameLo: row.ruleNameLo,
        points: row.points,
        note: row.note ?? null,
      }),
      (bucket) => bucket.conduct,
      (bucket) => {
        bucket.more.conduct += 1;
      },
    );

    return evidence;
  }

  /**
   * The lines of the review, validated against the roster and the sheet.
   *
   * Two rules the client cannot be trusted with: a child who is not on this
   * room's roll is refused outright, and a contact channel is refused on any
   * action that did not reach a guardian — "ແຈ້ງແລ້ວ ທາງໂທລະສັບ" against an action
   * of `none` is a record that reads as a call that never happened.
   */
  private buildStudents(
    input: HomeroomReviewStudentDto[],
    roster: RosterEntry[],
    flagged: FlaggedStudent[],
  ) {
    const onRoll = new Map(roster.map((student) => [student.studentId, student]));
    const reasonsFor = new Map(flagged.map((student) => [student.studentId, student.reasons]));

    const seen = new Set<string>();
    return input.map((line) => {
      const student = onRoll.get(line.studentId);
      if (!student) throw AppException.badRequest('homeroomReview.studentNotOnRoll');
      if (seen.has(line.studentId)) {
        throw AppException.badRequest('homeroomReview.studentNotOnRoll');
      }
      seen.add(line.studentId);

      const contacts = CONTACTING_ACTIONS.has(line.action);
      if (contacts && !line.contactChannel) {
        throw AppException.badRequest('homeroomReview.channelRequired');
      }
      if (!contacts && line.contactChannel) {
        throw AppException.badRequest('homeroomReview.channelNotAllowed');
      }

      return {
        studentId: new Types.ObjectId(line.studentId),
        studentCode: student.studentCode,
        studentNameLo: student.studentNameLo,
        // Snapshotted from the sheet the teacher was actually shown; empty for a
        // child they added themselves.
        reasons: reasonsFor.get(line.studentId) ?? [],
        action: line.action,
        contactChannel: line.contactChannel ?? null,
        note: line.note?.trim() || null,
      };
    });
  }

  /**
   * The first day a review was owed at all — the day the school started using this.
   *
   * Without it, every ວັນພຸດ/ວັນສຸກ back to the start of term counts as missing,
   * because the report is built from the calendar and the calendar does not know
   * when the button appeared. That is not a cosmetic problem: it is twelve rooms
   * reported as months behind on their first day, and a Telegram reminder naming
   * days in August that nobody could ever have filed — which is how a reminder
   * gets muted for good.
   *
   * Held as a setting rather than a constant so the office can move it, and
   * `null` (an empty or unreadable value) means "no cutoff", which is the honest
   * reading of a school that wants its whole term counted.
   */
  private async startDate(): Promise<Date | null> {
    const stored = await this.settings.getValue(REVIEW_START_DATE_SETTING);
    if (typeof stored !== 'string' || stored.trim() === '') return null;

    const parsed = new Date(stored);
    return Number.isNaN(parsed.getTime()) ? null : toUtcMidnight(parsed);
  }

  private async thresholds(): Promise<ReviewThresholds> {
    const stored = await this.settings.getValue(REVIEW_THRESHOLDS_SETTING);
    return stored ? normalizeThresholds(stored) : DEFAULT_REVIEW_THRESHOLDS;
  }

  private async getOrFail(id: string): Promise<HomeroomReviewDocument> {
    const review = await this.model
      .findOne({ _id: new Types.ObjectId(id), deletedAt: null })
      .exec();
    if (!review) throw AppException.notFound();
    return review;
  }

  private async filedFor(classroomId: string, dueDate: string) {
    return this.model
      .findOne({
        classroomId: new Types.ObjectId(classroomId),
        dueDate: new Date(`${dueDate}T00:00:00.000Z`),
        deletedAt: null,
      })
      .lean()
      .exec();
  }

  /** Every review this room has filed this term, in the shape the engine judges. */
  private async filedForRoom(classroomId: string, semesterId: Types.ObjectId) {
    const rows = await this.model
      .find({
        classroomId: new Types.ObjectId(classroomId),
        semesterId,
        deletedAt: null,
      })
      .select('classroomId dueDate createdAt studentsFlagged students')
      .lean()
      .exec();

    return rows.map((row) => this.toFiled(row as never));
  }

  /** The last review filed before `dueDate` — what the teacher last said. */
  private async previousFiled(classroomId: string, dueDate: string | null) {
    return this.model
      .findOne({
        classroomId: new Types.ObjectId(classroomId),
        deletedAt: null,
        ...(dueDate ? { dueDate: { $lt: new Date(`${dueDate}T00:00:00.000Z`) } } : {}),
      })
      .sort({ dueDate: -1 })
      .lean()
      .exec();
  }

  private toSheetClassroom(room: Record<string, unknown>): SheetClassroom {
    const grade = room.gradeLevelId as { code?: string | null } | null;
    const teacher = room.homeroomTeacherId as PopulatedTeacher | null;

    return {
      id: String(room._id),
      name: String(room.name),
      gradeLevelCode: grade?.code ?? null,
      teacherId: teacher?._id ? teacher._id.toString() : null,
      teacherCode: teacher?.teacherCode ?? null,
      teacherName: teacher ? `${teacher.firstNameLo} ${teacher.lastNameLo}`.trim() : null,
      studentsOnRoll: typeof room.currentCount === 'number' ? room.currentCount : 0,
    };
  }

  /** The stored review, in the shape the compliance engine judges. */
  private toFiled(review: {
    classroomId: Types.ObjectId;
    dueDate: Date;
    createdAt?: Date;
    studentsFlagged?: number;
    students?: { action: string; contactChannel?: string | null }[];
  }): FiledReview {
    const students = review.students ?? [];
    return {
      classroomId: String(review.classroomId),
      dueDate: review.dueDate.toISOString().slice(0, 10),
      // `createdAt` is when it was filed, which is what the deadline judges. The
      // document's own timestamp rather than a field the client could set.
      reviewedAt: review.createdAt ?? new Date(0),
      studentsFlagged: review.studentsFlagged ?? 0,
      studentsActioned: students.filter((student) => student.action !== 'none').length,
      guardiansContacted: students.filter((student) => CONTACTING_ACTIONS.has(student.action))
        .length,
    };
  }

  private toView(
    review: HomeroomReviewDocument | Record<string, unknown>,
    day: ReviewDay | null,
  ): FiledReviewView {
    const row = review as unknown as {
      _id: Types.ObjectId;
      classroomId: Types.ObjectId;
      teacherId: Types.ObjectId;
      dueDate: Date;
      windowStart: Date;
      windowEnd: Date;
      createdAt: Date;
      studentsOnRoll: number;
      studentsFlagged: number;
      students: {
        studentId: Types.ObjectId;
        studentCode?: string | null;
        studentNameLo?: string | null;
        reasons: { kind: string; scope: string; value: number; threshold: number }[];
        action: string;
        contactChannel?: string | null;
        note?: string | null;
      }[];
      note?: string | null;
    };

    const cell = day ? statusFor(day, this.toFiled(row), new Date()) : null;

    return {
      id: row._id.toString(),
      classroomId: row.classroomId.toString(),
      teacherId: row.teacherId.toString(),
      dueDate: row.dueDate.toISOString().slice(0, 10),
      windowStart: row.windowStart.toISOString().slice(0, 10),
      windowEnd: row.windowEnd.toISOString().slice(0, 10),
      reviewedAt: row.createdAt.toISOString(),
      studentsOnRoll: row.studentsOnRoll,
      studentsFlagged: row.studentsFlagged,
      students: row.students.map((student) => ({
        studentId: student.studentId.toString(),
        studentCode: student.studentCode ?? null,
        studentNameLo: student.studentNameLo ?? null,
        reasons: student.reasons ?? [],
        action: student.action,
        contactChannel: student.contactChannel ?? null,
        note: student.note ?? null,
      })),
      note: row.note ?? null,
      status: cell?.status ?? 'confirmed',
      hoursLate: cell?.hoursLate ?? 0,
    };
  }

  private refuseDate(date: string): never {
    throw AppException.badRequest('homeroomReview.notReviewDay', { date });
  }
}

const toUtcMidnight = (value: Date | string): Date => {
  const date = value instanceof Date ? value : new Date(value);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
};

/** Mongo's duplicate-key error, however the driver wraps it. */
function isDuplicateKey(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && (error as { code?: number }).code === 11000);
}

/**
 * A classroom's grade level id, whichever shape the read left it in.
 *
 * The rooms are populated for their `code`, so this is a document here and a raw
 * id on an unpopulated read — and a grade-level closure has to match either.
 */
function gradeLevelIdOf(value: unknown): string | null {
  if (!value) return null;
  const populated = (value as { _id?: unknown })._id;
  return String(populated ?? value);
}
