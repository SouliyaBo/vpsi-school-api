import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  Classroom,
  ClassroomDocument,
  Role,
  RoleDocument,
  User,
  UserDocument,
} from 'src/database/schemas';
import { AttendancesService } from '../attendances/attendances.service';
import { BehaviorLogsService } from '../behavior-logs/behavior-logs.service';
import { NotificationsService } from '../notifications/notifications.service';
import { HomeroomReviewsService } from '../homeroom-reviews/homeroom-reviews.service';
import {
  attendanceGapMessage,
  behaviorGapMessage,
  homeroomFollowUpMessage,
  homeroomReviewDigestMessage,
  homeroomReviewOverdueMessage,
  type GapLesson,
  type HomeroomClass,
  type ReminderText,
} from './reminder-messages';

/** What one run of a reminder did, for the log and for the manual trigger. */
export interface ReminderRun {
  kind: ReminderKind;
  /** Teachers the reminder applied to — behind, or responsible for a room. */
  matched: number;
  /** Of those, the ones an account could be found for and a row written. */
  notified: number;
}

export type ReminderKind =
  | 'attendance-gap'
  | 'behavior-gap'
  | 'homeroom-followup'
  | 'homeroom-review-overdue'
  | 'homeroom-review-digest';

/**
 * The reminders the school sends its teachers.
 *
 * Every one is delivered through `NotificationsService`, never through Telegram
 * directly: that writes the in-app row and fans out to whoever has linked a
 * chat, so the bell and the phone can never disagree, and a teacher who has not
 * linked still has the reminder waiting when they open the system.
 *
 * None of them invents its own idea of who is behind. Attendance and behaviour
 * both read the coverage reports the oversight screens already show, so the
 * message on a teacher's phone and the row the head of academic affairs is
 * looking at come from the same computation.
 */
@Injectable()
export class RemindersService {
  private readonly logger = new Logger(RemindersService.name);

  constructor(
    @InjectModel(Classroom.name) private readonly classrooms: Model<ClassroomDocument>,
    @InjectModel(User.name) private readonly users: Model<UserDocument>,
    @InjectModel(Role.name) private readonly roles: Model<RoleDocument>,
    private readonly attendances: AttendancesService,
    private readonly behaviorLogs: BehaviorLogsService,
    private readonly homeroomReviews: HomeroomReviewsService,
    private readonly notifications: NotificationsService,
  ) {}

  async run(kind: ReminderKind): Promise<ReminderRun> {
    switch (kind) {
      case 'attendance-gap':
        return this.attendanceGaps();
      case 'behavior-gap':
        return this.behaviorGaps();
      case 'homeroom-followup':
        return this.homeroomFollowUp();
      case 'homeroom-review-overdue':
        return this.homeroomReviewOverdue();
      case 'homeroom-review-digest':
        return this.homeroomReviewDigest();
    }
  }

  /**
   * Today's unmarked rolls, to the teacher who owes each one.
   *
   * Scoped to the day rather than the week: attendance is owed per lesson, the
   * office's rule gives a teacher until noon of the next working day, and a
   * reminder about last Tuesday is no longer a reminder.
   */
  private async attendanceGaps(): Promise<ReminderRun> {
    const coverage = await this.attendances.getCoverage({
      date: isoToday(),
      outstandingOnly: true,
    } as never);

    return this.sendPerTeacher(
      'attendance-gap',
      groupByTeacher(coverage.rows),
      attendanceGapMessage,
    );
  }

  /**
   * This week's unwritten register, to the teacher who owes it.
   *
   * The week to date, not the whole week: `buildCoverage` measures up to today,
   * so a Friday lesson is not owed on Wednesday.
   */
  private async behaviorGaps(): Promise<ReminderRun> {
    const coverage = await this.behaviorLogs.getWeeklyCoverage({
      outstandingOnly: true,
    } as never);

    return this.sendPerTeacher('behavior-gap', groupByTeacher(coverage.rows), behaviorGapMessage);
  }

  /**
   * ວັນພຸດ/ວັນສຸກ — the standing instruction, to the teachers it still applies to.
   *
   * It used to go to every homeroom teacher in the school whether or not they had
   * already looked at their room, which is the fastest way to have a reminder
   * muted. `outstandingForReminder` is what narrows it: a teacher who has already
   * confirmed today's review hears nothing at all.
   *
   * The rooms come from `classrooms.homeroomTeacherId`, which is only answerable
   * because those ids are ObjectIds — they were strings until
   * `migrate:homeroom-teacher-ids`, and this query returned one room in twelve.
   */
  private async homeroomFollowUp(): Promise<ReminderRun> {
    const { rooms } = await this.homeroomReviews.outstandingForReminder();
    const byTeacher = this.groupRooms(rooms.filter((room) => room.currentOutstanding));

    return this.sendPerTeacher('homeroom-followup', byTeacher, homeroomFollowUpMessage);
  }

  /**
   * The morning after: who has still not confirmed, while it can still be on time.
   *
   * Sent before the noon deadline rather than after it, because a nag that
   * arrives once the day has already been counted missing is a reproach and not a
   * reminder. Only rooms with a review day already past its deadline — the ones
   * the office's report is about to name.
   */
  private async homeroomReviewOverdue(): Promise<ReminderRun> {
    const { rooms } = await this.homeroomReviews.outstandingForReminder();
    const byTeacher = this.groupRooms(rooms.filter((room) => room.missingDays.length > 0));

    return this.sendPerTeacher('homeroom-review-overdue', byTeacher, homeroomReviewOverdueMessage);
  }

  /**
   * The week's compliance, to whoever holds the report.
   *
   * Addressed by permission rather than by role code: `homeroom-reviews:manage` is
   * exactly "may read who has not reviewed", so the digest reaches the same people
   * the screen does — and an office that is given the permission later starts
   * receiving it without anybody remembering to edit this file.
   */
  private async homeroomReviewDigest(): Promise<ReminderRun> {
    const report = await this.homeroomReviews.getCompliance({});
    const text = homeroomReviewDigestMessage({
      rooms: report.rows.map((row) => ({
        classroomName: row.gradeLevelCode
          ? `${row.gradeLevelCode}/${row.classroomName}`
          : row.classroomName,
        teacherName: row.teacherName,
        missing: row.missing,
      })),
      due: report.summary.due,
      confirmed: report.summary.confirmed,
      late: report.summary.late,
    });

    // A week nobody was behind sends nothing: a digest that arrives every Friday
    // saying "all well" is the next thing to be filtered out.
    if (!text) {
      this.logger.log('homeroom-review-digest: nothing outstanding, nothing sent');
      return { kind: 'homeroom-review-digest', matched: 0, notified: 0 };
    }

    const recipients = await this.reviewOverseers();
    if (recipients.length === 0) {
      this.logger.warn('homeroom-review-digest: nobody holds homeroom-reviews:manage');
      return { kind: 'homeroom-review-digest', matched: 0, notified: 0 };
    }

    const notified = await this.notifications.notifyMany(recipients, {
      type: 'general',
      titleLo: text.titleLo,
      bodyLo: text.bodyLo,
      data: { reminder: 'homeroom-review-digest' },
    });

    this.logger.log(`homeroom-review-digest: ${recipients.length} matched, ${notified} notified`);
    return { kind: 'homeroom-review-digest', matched: recipients.length, notified };
  }

  /** Accounts holding `homeroom-reviews:manage`, `manage` included implicitly. */
  private async reviewOverseers(): Promise<Types.ObjectId[]> {
    const roles = await this.roles
      .find({
        deletedAt: null,
        permissions: {
          $elemMatch: { resource: 'homeroom-reviews', actions: 'manage' },
        },
      })
      .select('_id')
      .lean()
      .exec();
    if (roles.length === 0) return [];

    const accounts = await this.users
      .find({ roleId: { $in: roles.map((role) => role._id) }, status: 'active', deletedAt: null })
      .select('_id')
      .lean()
      .exec();

    return accounts.map((account) => account._id);
  }

  /** The reminder feed regrouped under the teacher responsible for each room. */
  private groupRooms(
    rooms: {
      classroomName: string;
      teacherId: string | null;
      studentsOnRoll: number;
      flagged: number;
      missingDays: string[];
    }[],
  ): Map<string, HomeroomClass[]> {
    const byTeacher = new Map<string, HomeroomClass[]>();
    for (const room of rooms) {
      // A room with no homeroom teacher has nobody to remind; it is the office's
      // report that has to surface those, not a message to nobody.
      if (!room.teacherId) continue;
      const list = byTeacher.get(room.teacherId) ?? [];
      list.push({
        classroomName: room.classroomName,
        studentCount: room.studentsOnRoll,
        flagged: room.flagged,
        missingDays: room.missingDays,
      });
      byTeacher.set(room.teacherId, list);
    }
    return byTeacher;
  }

  /**
   * Turns "these teachers, this much each" into one notification apiece.
   *
   * A teacher with no user account is counted as matched and not as notified,
   * which is the honest reading: the school has somebody to chase and no way to
   * reach them, and a run that reported them as sent would hide that.
   */
  private async sendPerTeacher<T>(
    kind: ReminderKind,
    byTeacher: Map<string, T[]>,
    build: (items: T[]) => ReminderText | null,
  ): Promise<ReminderRun> {
    if (byTeacher.size === 0) return { kind, matched: 0, notified: 0 };

    const accounts = await this.users
      .find({
        personType: 'teacher',
        personId: { $in: [...byTeacher.keys()].map((id) => new Types.ObjectId(id)) },
        status: 'active',
        deletedAt: null,
      })
      .select('personId')
      .lean()
      .exec();

    const userByTeacher = new Map(accounts.map((user) => [String(user.personId), user._id]));

    let notified = 0;
    for (const [teacherId, items] of byTeacher) {
      const text = build(items);
      if (!text) continue;

      const userId = userByTeacher.get(teacherId);
      if (!userId) {
        this.logger.warn(`${kind}: teacher ${teacherId} has no account to notify`);
        continue;
      }

      await this.notifications.notify({
        userId,
        type: 'general',
        titleLo: text.titleLo,
        bodyLo: text.bodyLo,
        data: { reminder: kind },
      });
      notified += 1;
    }

    this.logger.log(`${kind}: ${byTeacher.size} matched, ${notified} notified`);
    return { kind, matched: byTeacher.size, notified };
  }
}

/** Today at the school, `yyyy-MM-dd`. */
function isoToday(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Coverage rows regrouped under the teacher who owes them.
 *
 * The report is one row per timetabled assignment, because that is how the
 * oversight screen reads it; a reminder is one message per person, however many
 * of their lessons are behind.
 */
function groupByTeacher(
  rows: {
    teacherId: string;
    subjectNameLo: string;
    classroomName: string;
    missingDates: string[];
    isSubstitute?: boolean;
  }[],
): Map<string, GapLesson[]> {
  const byTeacher = new Map<string, GapLesson[]>();
  for (const row of rows) {
    const list = byTeacher.get(row.teacherId) ?? [];
    list.push({
      subjectNameLo: row.subjectNameLo,
      classroomName: row.classroomName,
      missingDates: row.missingDates,
      isSubstitute: row.isSubstitute,
    });
    byTeacher.set(row.teacherId, list);
  }
  return byTeacher;
}
