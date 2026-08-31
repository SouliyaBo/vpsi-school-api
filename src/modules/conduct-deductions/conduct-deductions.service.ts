import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { PaginatedResponse } from 'src/common/dto/pagination.dto';
import { AppException } from 'src/common/exceptions/app.exception';
import type { AuthenticatedUser } from 'src/common/interfaces/authenticated-user.interface';
import { RecordScopeService } from 'src/common/services/record-scope.service';
import { isOnCurrentRoll, ROSTER_STUDENT_SELECT } from 'src/common/utils/current-roll';
import { nicknameOf, populatedStudent } from 'src/common/utils/student-name';
import {
  ConductDeduction,
  ConductDeductionDocument,
  ConductRule,
  ConductRuleDocument,
  Enrollment,
  EnrollmentDocument,
} from 'src/database/schemas';
import { toUtcMidnight } from '../attendances/attendances.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { ClassroomsService } from '../classrooms/classrooms.service';
import { ConductScoresService } from '../conduct-scores/conduct-scores.service';
import { SemestersService } from '../semesters/semesters.service';
import { conductGradeFor } from '../term-results/grading';
import {
  byMostDeducted,
  CONDUCT_BASE_SCORE,
  escalationFor,
  ladderAscending,
  remainingFrom,
} from './conduct-escalation';
import {
  QueryConductDeductionsDto,
  RecordConductDeductionDto,
  RevokeConductDeductionDto,
} from './dto/conduct-deduction.dto';

/**
 * ການຕັດຄະແນນກົດລະບຽບ — the discipline ledger.
 *
 * Every child starts a term on 100 conduct points and loses them against a
 * numbered rule on the school's published sheet. Three things follow from that,
 * and they are what this service is:
 *
 * 1. The act is recorded, never the balance. A balance that is stored is a
 *    balance that can be wrong; one that is summed cannot.
 * 2. The term's conduct score is published from the sum, so the report card and
 *    the discipline record cannot disagree — see `ConductScoresService`.
 * 3. The sheet's ໝາຍເຫດ says who has to be told at each total, so every read
 *    that shows a balance shows the rung it has reached with it. A screen that
 *    made the reader do that arithmetic would be a screen nobody acts on.
 */
@Injectable()
export class ConductDeductionsService {
  constructor(
    @InjectModel(ConductDeduction.name)
    private readonly model: Model<ConductDeductionDocument>,
    @InjectModel(ConductRule.name) private readonly ruleModel: Model<ConductRuleDocument>,
    @InjectModel(Enrollment.name) private readonly enrollmentModel: Model<EnrollmentDocument>,
    private readonly semesters: SemestersService,
    private readonly classrooms: ClassroomsService,
    private readonly conductScores: ConductScoresService,
    private readonly audit: AuditLogsService,
    private readonly scope: RecordScopeService,
  ) {}

  /** The ledger as a flat log, newest first. */
  async findAll(
    query: QueryConductDeductionsDto,
    actor: AuthenticatedUser,
  ): Promise<PaginatedResponse<ConductDeductionDocument>> {
    const filter: Record<string, unknown> = { deletedAt: null };
    if (query.studentId) filter.studentId = new Types.ObjectId(query.studentId);
    if (query.classroomId) filter.classroomId = new Types.ObjectId(query.classroomId);
    if (query.semesterId) filter.semesterId = new Types.ObjectId(query.semesterId);
    if (query.ruleId) filter.ruleId = new Types.ObjectId(query.ruleId);
    if (query.from || query.to) {
      filter.date = {
        ...(query.from ? { $gte: toUtcMidnight(query.from) } : {}),
        ...(query.to ? { $lte: toUtcMidnight(query.to) } : {}),
      };
    }

    // A student sees their own record and a guardian their children's; for
    // everyone else the permission matrix is the whole of the policy.
    await this.scope.applyStudentScope(filter, actor);

    const [data, total] = await Promise.all([
      this.model
        .find(filter)
        .populate('studentId', ROSTER_STUDENT_SELECT)
        .populate('classroomId', 'name')
        .sort({ date: -1, createdAt: -1 })
        .skip(query.skip)
        .limit(query.limit)
        .exec(),
      this.model.countDocuments(filter).exec(),
    ]);

    return new PaginatedResponse(data, total, query.page, query.limit);
  }

  /**
   * Applies one rule to one or more children on one day.
   *
   * The rule decides the points and the term is read off the date, so the client
   * chooses only who and what — a deduction cannot be filed for a different
   * number than the sheet says, nor into a term it did not happen in.
   */
  async record(
    dto: RecordConductDeductionDto,
    actor: AuthenticatedUser,
    ip: string | null,
  ): Promise<{ recorded: number; students: DeductionOutcome[] }> {
    const date = toUtcMidnight(dto.date);
    if (date > toUtcMidnight(new Date())) {
      throw AppException.badRequest('conductDeduction.futureDate', { date: dto.date });
    }

    const unique = new Set(dto.studentIds);
    if (unique.size !== dto.studentIds.length) {
      throw AppException.badRequest('conductDeduction.duplicateStudent');
    }

    const rule = await this.ruleModel.findOne({ _id: dto.ruleId, deletedAt: null }).exec();
    if (!rule) throw AppException.notFound();
    if (!rule.isActive) throw AppException.badRequest('conductRule.withdrawn', { code: rule.code });

    const classroom = await this.classrooms.findOneOrFail(dto.classroomId);

    // The term is a property of the day the rule was broken, not of whichever
    // term happens to be active when the teacher gets round to filing it.
    const term = await this.semesters.findForRange(date, date);
    if (!term)
      throw AppException.badRequest('conductDeduction.outsideSemester', { date: dto.date });
    const semester = await this.semesters.getWritableOrFail(term._id.toString());

    await this.assertOnRoll(classroom._id, dto.studentIds);

    const rows = dto.studentIds.map((studentId) => ({
      studentId: new Types.ObjectId(studentId),
      classroomId: classroom._id,
      semesterId: semester._id,
      schoolYearId: semester.schoolYearId,
      date,
      ruleId: rule._id,
      // Snapshotted: next year's sheet renumbers and rewords, and this row has
      // to keep saying what the child was actually told.
      ruleCode: rule.code,
      ruleNameLo: rule.nameLo,
      points: rule.points,
      note: dto.note ?? null,
      recordedBy: new Types.ObjectId(actor.sub),
    }));

    const created = await this.model.insertMany(rows);

    await Promise.all(
      created.map((row) =>
        this.audit.record({
          action: 'create',
          entityType: 'conductDeductions',
          entityId: row._id,
          userId: actor.sub,
          username: actor.username,
          newValue: {
            studentId: row.studentId.toString(),
            ruleCode: row.ruleCode,
            points: row.points,
            date: dto.date,
          },
          ip,
        }),
      ),
    );

    // Each child's term mark is republished from their own new total, and the
    // rung they have reached comes back with it — the teacher who just filed the
    // row is the one who has to act on it.
    const students = await this.publishAll(
      dto.studentIds.map((id) => new Types.ObjectId(id)),
      semester._id,
      semester.schoolYearId,
      classroom._id,
      actor,
      ip,
    );

    return { recorded: created.length, students };
  }

  /**
   * Withdraws one deduction, with a reason.
   *
   * Soft-deleted rather than removed, and the reason is kept on the row: a child
   * was told they had lost these points, so taking them back is a decision the
   * record should still show, not an erasure. The balance and the term mark
   * follow immediately.
   */
  async revoke(
    id: string,
    dto: RevokeConductDeductionDto,
    actor: AuthenticatedUser,
    ip: string | null,
  ): Promise<DeductionOutcome> {
    const row = await this.model.findOne({ _id: id, deletedAt: null }).exec();
    if (!row) throw AppException.notFound();

    await this.semesters.getWritableOrFail(row.semesterId.toString());

    row.deletedAt = new Date();
    row.deletedBy = new Types.ObjectId(actor.sub);
    // Beside the note, not over it: the note is what the child was told they
    // did, and an appeal is read by comparing the two.
    row.revokeReason = dto.reason;
    await row.save();

    await this.audit.record({
      action: 'delete',
      entityType: 'conductDeductions',
      entityId: row._id,
      userId: actor.sub,
      username: actor.username,
      oldValue: { ruleCode: row.ruleCode, points: row.points, note: row.note ?? null },
      newValue: { revokeReason: dto.reason },
      ip,
    });

    const [outcome] = await this.publishAll(
      [row.studentId],
      row.semesterId,
      row.schoolYearId,
      row.classroomId,
      actor,
      ip,
    );
    return outcome;
  }

  /**
   * One class's standing for a term: the sheet the discipline committee reads.
   *
   * Built from the roll rather than from the ledger, so a child nobody has had to
   * deduct from is listed on their full 100 instead of being absent from the
   * page — "no entry" and "clean record" are the same thing here only if the
   * clean records are visible.
   */
  async getClassroomSummary(classroomId: string, semesterId: string): Promise<ClassSummaryRow[]> {
    const classroomOid = new Types.ObjectId(classroomId);
    const semesterOid = new Types.ObjectId(semesterId);

    const [roster, totals] = await Promise.all([
      this.enrollmentModel
        .find({ classroomId: classroomOid, status: 'active', deletedAt: null })
        .populate('studentId', ROSTER_STUDENT_SELECT)
        .sort({ rollNumber: 1 })
        .lean()
        .exec(),
      this.model
        .aggregate<{ _id: Types.ObjectId; deducted: number; entries: number; lastDate: Date }>([
          { $match: { classroomId: classroomOid, semesterId: semesterOid, deletedAt: null } },
          {
            $group: {
              _id: '$studentId',
              deducted: { $sum: '$points' },
              entries: { $sum: 1 },
              lastDate: { $max: '$date' },
            },
          },
        ])
        .exec(),
    ]);

    const byStudent = new Map(totals.map((row) => [row._id.toString(), row]));

    return roster
      .filter((enrollment) => isOnCurrentRoll(enrollment.studentId))
      .map((enrollment) => {
        const student = populatedStudent(enrollment.studentId);
        const studentId = student?._id.toString() ?? String(enrollment.studentId);
        const total = byStudent.get(studentId);
        return this.buildRow({
          studentId,
          studentCode: enrollment.studentCode,
          studentNameLo: enrollment.studentNameLo,
          studentNickname: nicknameOf(student),
          rollNumber: enrollment.rollNumber ?? null,
          deducted: total?.deducted ?? 0,
          entries: total?.entries ?? 0,
          lastDate: total?.lastDate ?? null,
        });
      })
      .sort(byMostDeducted);
  }

  /**
   * One child's term: every row against them, and where that leaves them.
   *
   * This is what a guardian meeting is held over, so the rows come back in the
   * order they happened rather than newest first — the account is read forwards.
   */
  async getStudentLedger(studentId: string, semesterId: string, actor: AuthenticatedUser) {
    const filter: Record<string, unknown> = {
      studentId: new Types.ObjectId(studentId),
      semesterId: new Types.ObjectId(semesterId),
      deletedAt: null,
    };
    await this.scope.applyStudentScope(filter, actor);

    const rows = await this.model.find(filter).sort({ date: 1, createdAt: 1 }).lean().exec();
    const deducted = rows.reduce((sum, row) => sum + row.points, 0);

    return {
      studentId,
      semesterId,
      baseScore: CONDUCT_BASE_SCORE,
      deducted,
      remaining: remainingFrom(deducted),
      grade: conductGradeFor(remainingFrom(deducted)),
      ...this.rungOf(deducted),
      entries: rows.map((row) => ({
        id: row._id.toString(),
        date: row.date.toISOString().slice(0, 10),
        ruleId: row.ruleId.toString(),
        ruleCode: row.ruleCode,
        ruleNameLo: row.ruleNameLo,
        points: row.points,
        note: row.note ?? null,
      })),
    };
  }

  /** The school's ໝາຍເຫດ ladder, so a screen can show it without restating it. */
  getLadder() {
    return {
      baseScore: CONDUCT_BASE_SCORE,
      rungs: ladderAscending().map((rung) => ({
        level: rung.level,
        minDeducted: rung.minDeducted,
        notify: [...rung.notify],
      })),
    };
  }

  /**
   * Refuses a deduction against a child who is not in the room.
   *
   * Checked against the current roll, not merely against an open enrollment: a
   * child the office has marked as transferred or dropped keeps their placement
   * until someone closes it, and points taken off a child who has left the
   * school are points nobody can act on.
   */
  private async assertOnRoll(classroomId: Types.ObjectId, studentIds: string[]): Promise<void> {
    const roster = await this.enrollmentModel
      .find({ classroomId, status: 'active', deletedAt: null })
      .populate('studentId', ROSTER_STUDENT_SELECT)
      .lean()
      .exec();

    const onRoll = new Set(
      roster
        .filter((enrollment) => isOnCurrentRoll(enrollment.studentId))
        .map((enrollment) => {
          const student = populatedStudent(enrollment.studentId);
          return student?._id.toString() ?? String(enrollment.studentId);
        }),
    );

    const unknown = studentIds.filter((id) => !onRoll.has(id));
    if (unknown.length > 0) {
      throw AppException.badRequest('score.studentNotInClassroom', { studentIds: unknown });
    }
  }

  /** Republishes the term mark for each child touched, and reports where they stand. */
  private async publishAll(
    studentIds: Types.ObjectId[],
    semesterId: Types.ObjectId,
    schoolYearId: Types.ObjectId,
    classroomId: Types.ObjectId,
    actor: AuthenticatedUser,
    ip: string | null,
  ): Promise<DeductionOutcome[]> {
    const totals = await this.model
      .aggregate<{ _id: Types.ObjectId; deducted: number }>([
        {
          $match: { studentId: { $in: studentIds }, semesterId, deletedAt: null },
        },
        { $group: { _id: '$studentId', deducted: { $sum: '$points' } } },
      ])
      .exec();

    const byStudent = new Map(totals.map((row) => [row._id.toString(), row.deducted]));

    return Promise.all(
      studentIds.map(async (studentId) => {
        const deducted = byStudent.get(studentId.toString()) ?? 0;
        const remaining = remainingFrom(deducted);
        const published = await this.conductScores.applyFromDeductions({
          studentId,
          semesterId,
          schoolYearId,
          classroomId,
          score: remaining,
          actor,
          ip,
        });

        return {
          studentId: studentId.toString(),
          deducted,
          remaining,
          grade: conductGradeFor(remaining),
          // False when the office has set this term's mark by hand: the ledger
          // still counts, but it is no longer what the report card prints, and
          // the screen has to be able to say so.
          publishedToConductScore: published.written,
          ...this.rungOf(deducted),
        };
      }),
    );
  }

  private buildRow(row: Omit<ClassSummaryRow, 'remaining' | 'grade' | 'level' | 'notify'>) {
    return {
      ...row,
      remaining: remainingFrom(row.deducted),
      grade: conductGradeFor(remainingFrom(row.deducted)),
      ...this.rungOf(row.deducted),
    };
  }

  private rungOf(deducted: number) {
    const rung = escalationFor(deducted);
    return { level: rung.level, notify: [...rung.notify] };
  }
}

/** Where one child stands after a write — returned so the screen can act on it. */
export interface DeductionOutcome {
  studentId: string;
  deducted: number;
  remaining: number;
  grade: ReturnType<typeof conductGradeFor>;
  publishedToConductScore: boolean;
  level: ReturnType<typeof escalationFor>['level'];
  notify: ReturnType<typeof escalationFor>['notify'][number][];
}

export interface ClassSummaryRow {
  studentId: string;
  studentCode: string;
  studentNameLo: string;
  studentNickname: string | null;
  rollNumber: number | null;
  deducted: number;
  entries: number;
  lastDate: Date | null;
  remaining: number;
  grade: ReturnType<typeof conductGradeFor>;
  level: ReturnType<typeof escalationFor>['level'];
  notify: ReturnType<typeof escalationFor>['notify'][number][];
}
