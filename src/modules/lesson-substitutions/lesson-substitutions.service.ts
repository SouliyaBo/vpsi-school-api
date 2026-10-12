import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { PaginatedResponse } from 'src/common/dto/pagination.dto';
import { AppException } from 'src/common/exceptions/app.exception';
import type { AuthenticatedUser } from 'src/common/interfaces/authenticated-user.interface';
import { LessonAccessService } from 'src/common/lesson-access/lesson-access.service';
import { canWriteLesson } from 'src/common/lesson-access/lesson-write-access';
import { recordingDeadline } from 'src/common/school-days/school-days';
import {
  LessonSubstitution,
  LessonSubstitutionDocument,
  Teacher,
  TeacherDocument,
  TeachingAssignmentDocument,
} from 'src/database/schemas';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CalendarService } from '../calendar/calendar.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SemestersService } from '../semesters/semesters.service';
import {
  CreateLessonSubstitutionDto,
  LessonClaimabilityDto,
  QueryLessonSubstitutionsDto,
} from './dto/lesson-substitution.dto';

/** A school day is a calendar date, so it is stored as one exact value. */
const toUtcMidnight = (value: Date | string): Date => {
  const date = value instanceof Date ? value : new Date(value);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
};

/** Mongo's duplicate-key error, however the driver wraps it. */
function isDuplicateKey(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && (error as { code?: number }).code === 11000);
}

const TEACHER_NAME = 'teacherCode firstNameLo lastNameLo firstNameEn lastNameEn';

/**
 * ການມອບໝາຍສອນແທນ — who took a lesson its timetabled teacher could not.
 *
 * Self-service by design. The situation this exists for is a teacher who is off
 * sick at seven in the morning and a colleague who walks into the room at eight;
 * a claim the office has to approve first would still be unapproved when the
 * register fell due, which is exactly how the school ended up with the office
 * keying in registers from paper notes. So a teacher claims their own cover, and
 * the guards are placed to make a wrongful claim visible rather than impossible:
 *
 * - the lesson has to be on the timetable for that weekday, and its term open;
 * - the claim has to be made before the lesson's own paperwork deadline, so
 *   nobody reaches back into a closed month to move a gap off their own row;
 * - one live claim per lesson-day, enforced by a unique index, so two teachers
 *   who both think they covered a period are told about each other;
 * - the timetabled teacher is notified the moment cover is claimed against one of
 *   their lessons, which is the real check: the one person certain to know
 *   whether they were there finds out within the minute.
 *
 * What a claim grants is narrow and stays narrow — the roll call and the
 * behaviour register for that day, and nothing about marking. See
 * `canWriteLesson`.
 */
@Injectable()
export class LessonSubstitutionsService {
  constructor(
    @InjectModel(LessonSubstitution.name)
    private readonly model: Model<LessonSubstitutionDocument>,
    @InjectModel(Teacher.name) private readonly teacherModel: Model<TeacherDocument>,
    private readonly lessons: LessonAccessService,
    private readonly semesters: SemestersService,
    private readonly calendar: CalendarService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditLogsService,
  ) {}

  async findAll(
    query: QueryLessonSubstitutionsDto,
    actor: AuthenticatedUser,
  ): Promise<PaginatedResponse<LessonSubstitutionDocument>> {
    const filter: Record<string, unknown> = { deletedAt: null };
    if (query.teachingAssignmentId) {
      filter.teachingAssignmentId = new Types.ObjectId(query.teachingAssignmentId);
    }
    if (query.classroomId) filter.classroomId = new Types.ObjectId(query.classroomId);
    if (query.semesterId) filter.semesterId = new Types.ObjectId(query.semesterId);
    if (query.from || query.to) {
      filter.date = {
        ...(query.from ? { $gte: toUtcMidnight(query.from) } : {}),
        ...(query.to ? { $lte: toUtcMidnight(query.to) } : {}),
      };
    }

    if (query.substituteTeacherId) {
      filter.substituteTeacherId = new Types.ObjectId(query.substituteTeacherId);
    }
    if (query.ownerTeacherId) filter.ownerTeacherId = new Types.ObjectId(query.ownerTeacherId);

    /**
     * A teacher sees only the claims they are a party to.
     *
     * Either side of one: the cover they took, and the cover somebody took of
     * their own lessons. Both are their business and neither is anybody else's —
     * who is off sick this week is not a staff-wide list, and the oversight read
     * belongs to `manage`.
     */
    if (!this.oversees(actor) && actor.personType === 'teacher') {
      if (!actor.personId) return new PaginatedResponse([], 0, query.page, query.limit);
      const mine = new Types.ObjectId(actor.personId);
      // `$and` rather than merged into the filter, so an explicit
      // `substituteTeacherId=<a colleague>` narrows within the caller's own claims
      // instead of replacing the restriction.
      filter.$and = [{ $or: [{ substituteTeacherId: mine }, { ownerTeacherId: mine }] }];
    }

    const [data, total] = await Promise.all([
      this.model
        .find(filter)
        .populate('substituteTeacherId', TEACHER_NAME)
        .populate('ownerTeacherId', TEACHER_NAME)
        .populate('subjectId', 'code nameLo nameEn')
        .populate({
          path: 'classroomId',
          select: 'name gradeLevelId',
          populate: { path: 'gradeLevelId', select: 'code nameLo nameEn' },
        })
        .sort(query.toSort(['date', 'createdAt'], { date: -1 }))
        .skip(query.skip)
        .limit(query.limit)
        .exec(),
      this.model.countDocuments(filter).exec(),
    ]);

    return new PaginatedResponse(data, total, query.page, query.limit);
  }

  /**
   * ຮັບສອນແທນ — claims one day of one lesson.
   *
   * The claim is written before anything is recorded against it, so the roll call
   * that follows goes through the ordinary authorization path with nothing special
   * about it. That ordering is deliberate: it means the register cannot end up
   * holding a lesson whose cover nobody declared, and the trail reads in the order
   * the day happened.
   */
  async create(
    dto: CreateLessonSubstitutionDto,
    actor: AuthenticatedUser,
    ip: string | null,
  ): Promise<LessonSubstitutionDocument> {
    const date = toUtcMidnight(dto.date);
    const oversees = this.oversees(actor);

    const substituteTeacherId = dto.substituteTeacherId ?? actor.personId ?? null;
    if (!substituteTeacherId) throw AppException.forbidden('substitution.notATeacher');
    // Filing cover under a colleague's name is oversight, not self-service: it is
    // how the office records an arrangement made by phone, and it is the one way a
    // claim can be made that its subject did not make.
    if (!oversees && (actor.personType !== 'teacher' || substituteTeacherId !== actor.personId)) {
      throw AppException.forbidden('substitution.notATeacher');
    }

    const assignment = await this.lessons.resolveLesson(dto.teachingAssignmentId, date);

    if (String(assignment.teacherId) === substituteTeacherId) {
      throw AppException.badRequest('substitution.ownLesson', {
        teachingAssignmentId: dto.teachingAssignmentId,
      });
    }

    const substitute = await this.teacherModel
      .findOne({ _id: new Types.ObjectId(substituteTeacherId), deletedAt: null })
      .select(TEACHER_NAME)
      .lean()
      .exec();
    if (!substitute) throw AppException.notFound();

    const semester = await this.semesters.getWritableOrFail(assignment.semesterId.toString());
    if (date < toUtcMidnight(semester.startDate) || date > toUtcMidnight(semester.endDate)) {
      throw AppException.badRequest('attendance.outsideSemester', {
        date: dto.date,
        semesterRange: [semester.startDate, semester.endDate],
      });
    }

    await this.assertClaimWindowOpen(date, assignment, oversees);

    const created = await this.insert(dto, date, assignment, substituteTeacherId, actor);

    await this.audit.record({
      action: 'create',
      entityType: 'lesson-substitutions',
      entityId: created._id.toString(),
      userId: actor.sub,
      username: actor.username,
      newValue: {
        teachingAssignmentId: dto.teachingAssignmentId,
        date: dto.date,
        classroomId: assignment.classroomId.toString(),
        subjectId: assignment.subjectId.toString(),
        // Both sides on the row, so the trail answers "who covered for whom"
        // without re-reading a timetable that may since have changed.
        substituteTeacherId,
        ownerTeacherId: assignment.teacherId.toString(),
        reason: dto.reason ?? null,
      },
      ip,
    });

    await this.tellTimetabledTeacher(created, assignment, substitute, 'claimed');

    return created;
  }

  /**
   * ຖອນການສອນແທນ — withdraws a claim.
   *
   * Open to the stand-in as well as to the office, because the commonest reason to
   * withdraw one is the commonest reason to file one by mistake: the cover was
   * rearranged before the bell, and the teacher who claimed it knows first.
   *
   * Withdrawing hands the day back to the timetabled teacher, in the reports as
   * well as in the permission — which is why the timetabled teacher is told about
   * it, exactly as they were told about the claim. A claim taken and dropped after
   * the deadline would otherwise put a gap back on the row of somebody who was
   * never there to fill it, quietly.
   */
  async remove(id: string, actor: AuthenticatedUser, ip: string | null): Promise<void> {
    if (!Types.ObjectId.isValid(id)) throw AppException.notFound();

    const claim = await this.model.findOne({ _id: new Types.ObjectId(id), deletedAt: null }).exec();
    if (!claim) throw AppException.notFound();

    if (!this.oversees(actor) && String(claim.substituteTeacherId) !== actor.personId) {
      throw AppException.forbidden('substitution.notYours');
    }

    claim.deletedAt = new Date();
    claim.deletedBy = new Types.ObjectId(actor.sub);
    await claim.save();

    await this.audit.record({
      action: 'delete',
      entityType: 'lesson-substitutions',
      entityId: claim._id.toString(),
      userId: actor.sub,
      username: actor.username,
      oldValue: {
        teachingAssignmentId: claim.teachingAssignmentId.toString(),
        date: claim.date.toISOString().slice(0, 10),
        substituteTeacherId: claim.substituteTeacherId.toString(),
        ownerTeacherId: claim.ownerTeacherId.toString(),
      },
      ip,
    });

    const substitute = await this.teacherModel
      .findById(claim.substituteTeacherId)
      .select(TEACHER_NAME)
      .lean()
      .exec();
    if (substitute) await this.tellTimetabledTeacher(claim, null, substitute, 'withdrawn');
  }

  /**
   * What the roll-call screen needs to decide which button to show.
   *
   * Answered by the server because every part of it is a server-side fact: the
   * timetable, the live claim, and a deadline that depends on the school calendar.
   * A client that worked any of the three out for itself would be wrong on exactly
   * the days the school is closed.
   */
  async claimability(
    teachingAssignmentId: string,
    dateInput: string,
    actor: AuthenticatedUser,
  ): Promise<LessonClaimabilityDto> {
    const date = toUtcMidnight(dateInput);
    const assignment = await this.lessons.resolveLesson(teachingAssignmentId, date);
    const existing = await this.lessons.liveSubstitution(assignment._id, date);

    const canRecord = canWriteLesson(
      { teacherId: assignment.teacherId.toString() },
      actor,
      existing,
    );
    const deadline = await this.claimDeadline(date, assignment);

    const blockedBy = ((): string | null => {
      if (canRecord) return null;
      if (actor.personType !== 'teacher' || !actor.personId) return 'substitution.notATeacher';
      if (existing) return 'substitution.alreadyClaimed';
      if (deadline && deadline <= new Date() && !this.oversees(actor)) {
        return 'substitution.claimWindowClosed';
      }
      return null;
    })();

    return {
      canRecord,
      canClaim: !canRecord && blockedBy === null,
      blockedBy,
      claimableUntil: deadline?.toISOString() ?? null,
      claimedByTeacherId: existing ? existing.substituteTeacherId.toString() : null,
    };
  }

  /** Inserting the claim, with the unique index doing the arbitration. */
  private async insert(
    dto: CreateLessonSubstitutionDto,
    date: Date,
    assignment: TeachingAssignmentDocument,
    substituteTeacherId: string,
    actor: AuthenticatedUser,
  ): Promise<LessonSubstitutionDocument> {
    try {
      return await this.model.create({
        teachingAssignmentId: assignment._id,
        date,
        substituteTeacherId: new Types.ObjectId(substituteTeacherId),
        ownerTeacherId: assignment.teacherId,
        classroomId: assignment.classroomId,
        subjectId: assignment.subjectId,
        semesterId: assignment.semesterId,
        schoolYearId: assignment.schoolYearId,
        reason: dto.reason?.trim() || null,
        claimedBy: new Types.ObjectId(actor.sub),
      });
    } catch (error) {
      // Two teachers claiming the same period at the same moment. Told as a
      // conflict rather than swallowed: the second one has to know somebody else
      // already has it, because one of the two did not take that class.
      if (isDuplicateKey(error)) {
        throw AppException.conflict('substitution.alreadyClaimed', {
          teachingAssignmentId: dto.teachingAssignmentId,
          date: dto.date,
        });
      }
      throw error;
    }
  }

  /**
   * The claim window: open until the lesson's own paperwork falls due.
   *
   * The school's deadline for writing a lesson up is noon of the next working day
   * — so that is exactly how long there is to declare who is writing it. Tying the
   * two together means there is no second rule to keep in step, and it closes the
   * move the office was right to worry about: reaching back into last month to
   * shift a gap off your own row and onto a colleague's.
   *
   * A lesson still ahead is always claimable, which is what makes planned absence
   * — ໄປຮາຊະການ next Wednesday — something the office can file in advance.
   *
   * `manage` is exempt. The office is the fallback for the case this rule creates:
   * cover that nobody claimed in time still has to be recorded as what it was.
   */
  private async assertClaimWindowOpen(
    date: Date,
    assignment: TeachingAssignmentDocument,
    oversees: boolean,
  ): Promise<void> {
    if (oversees) return;

    const deadline = await this.claimDeadline(date, assignment);
    // `null` means the calendar has no next working day on file — past the end of
    // the filled-in year. Left open rather than closed: the school's own missing
    // calendar is not a reason to refuse a teacher the register.
    if (deadline && deadline <= new Date()) {
      throw AppException.badRequest('substitution.claimWindowClosed', {
        date: date.toISOString().slice(0, 10),
        deadline: deadline.toISOString(),
      });
    }
  }

  /** The lesson's paperwork deadline, on that class's own calendar. */
  private async claimDeadline(
    date: Date,
    assignment: TeachingAssignmentDocument,
  ): Promise<Date | null> {
    // A week either side, which is all `nextWorkingDay` can need and keeps the
    // calendar read to a handful of documents.
    const from = new Date(date.getTime() - 7 * 86_400_000);
    const to = new Date(date.getTime() + 21 * 86_400_000);
    const [calendar, forClass] = await Promise.all([
      this.calendar.calendarFor(from, to),
      this.calendar.classRefFor(assignment.classroomId.toString()),
    ]);

    return recordingDeadline(date, calendar, { forClass });
  }

  /**
   * Tells the timetabled teacher that somebody has claimed — or dropped — one of
   * their lessons.
   *
   * The whole of what makes self-service claiming safe. Nobody can vet a claim at
   * the moment it is made, but the one person who knows for certain whether they
   * taught that period is the person it is made against, and they find out
   * immediately. A failure to notify must not fail the claim, so it is logged and
   * swallowed by `NotificationsService`.
   */
  private async tellTimetabledTeacher(
    claim: LessonSubstitutionDocument,
    assignment: TeachingAssignmentDocument | null,
    substitute: { firstNameLo: string; lastNameLo: string },
    event: 'claimed' | 'withdrawn',
  ): Promise<void> {
    const ownerTeacherId = assignment
      ? assignment.teacherId.toString()
      : claim.ownerTeacherId.toString();
    const userId = await this.notifications.findUserIdForPerson('teacher', ownerTeacherId);
    if (!userId) return;

    const name = `${substitute.firstNameLo} ${substitute.lastNameLo}`.trim();
    const day = claim.date.toISOString().slice(0, 10);

    await this.notifications.notify({
      userId,
      type: 'general',
      titleLo: event === 'claimed' ? 'ມີຄູຮັບສອນແທນຊົ່ວໂມງຂອງທ່ານ' : 'ມີການຖອນການສອນແທນ',
      titleEn: event === 'claimed' ? 'A colleague has claimed cover' : 'Cover has been withdrawn',
      bodyLo:
        event === 'claimed'
          ? `${name} ຮັບສອນແທນຊົ່ວໂມງຂອງທ່ານ ວັນທີ ${day}` +
            (claim.reason ? ` (${claim.reason})` : '') +
            ' — ຖ້າບໍ່ຖືກຕ້ອງ ກະລຸນາແຈ້ງຫ້ອງການວິຊາການ'
          : `ການສອນແທນຂອງ ${name} ວັນທີ ${day} ຖືກຖອນແລ້ວ — ການບັນທຶກຂອງຊົ່ວໂມງນີ້ກັບມາເປັນຂອງທ່ານ`,
      bodyEn:
        event === 'claimed'
          ? `${name} has claimed cover for your lesson on ${day}. Tell the academic office if that is wrong.`
          : `${name}'s cover on ${day} has been withdrawn; this lesson's register is yours again.`,
      data: { substitutionId: claim._id.toString(), date: day, event },
    });
  }

  private oversees(actor: AuthenticatedUser): boolean {
    return actor.permissions.some(
      (permission) =>
        permission.resource === 'lesson-substitutions' && permission.actions.includes('manage'),
    );
  }
}
