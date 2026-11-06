import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { AppException } from 'src/common/exceptions/app.exception';
import type { AuthenticatedUser } from 'src/common/interfaces/authenticated-user.interface';
import { RecordScopeService } from 'src/common/services/record-scope.service';
import { isStudying } from 'src/common/utils/current-roll';
import { nicknameOf, populatedStudent, STUDENT_NAME_SELECT } from 'src/common/utils/student-name';
import {
  ConductDeduction,
  ConductDeductionDocument,
  Enrollment,
  EnrollmentDocument,
  Semester,
  SemesterDocument,
} from 'src/database/schemas';
import { AttendancesService } from '../attendances/attendances.service';
import { ClassroomsService } from '../classrooms/classrooms.service';
import { SettingsService } from '../settings/settings.service';
import { SubjectsService } from '../subjects/subjects.service';
import { monthFigures, sumFigures, type RegisterFigures, type RegisterInputs } from './class-year';
import { ClassYearQueryDto } from './dto/monthly-mark.dto';
import { annualScore, columnMaxFor, fullMarkOf, monthsForSemester } from './monthly-grading';
import { gradeLevelIdOf, MonthlyMarksService } from './monthly-marks.service';

/**
 * ໝົດປີ ທັງຫ້ອງ — one class's whole year, every subject, as the office's sheet
 * lays it out: each month of both terms, each term's exam, then ພາກ I, ພາກ II and
 * ໝົດປີ, with ຄະແນນຖືກຕັດ and ວັນຂາດ beside every stretch.
 *
 * Nothing here is stored. The marks are the term result's own derivation
 * (`getClassroomSubjectMarks`), so this sheet cannot disagree with the term
 * sheets or the report card; the registers are the roll and the discipline
 * ledger, read over the same months.
 *
 * Every room, for anyone who may read marks — the office's sheet is handed to
 * every teacher with all the rooms on it — but never to a student or guardian,
 * whose `scores:read` is for their own marks only.
 */
@Injectable()
export class ClassYearService {
  constructor(
    @InjectModel(Enrollment.name) private readonly enrollmentModel: Model<EnrollmentDocument>,
    @InjectModel(Semester.name) private readonly semesterModel: Model<SemesterDocument>,
    @InjectModel(ConductDeduction.name)
    private readonly deductionModel: Model<ConductDeductionDocument>,
    private readonly marks: MonthlyMarksService,
    private readonly classrooms: ClassroomsService,
    private readonly subjects: SubjectsService,
    private readonly attendances: AttendancesService,
    private readonly settings: SettingsService,
    private readonly scope: RecordScopeService,
  ) {}

  async getClassYear(query: ClassYearQueryDto, actor: AuthenticatedUser) {
    if (this.scope.isScoped(actor)) throw AppException.forbidden('auth.forbidden');

    const classroom = await this.classrooms.findOnePopulated(query.classroomId);
    // The room's own year, not the active one: a room belongs to one year.
    const schoolYearId = refIdOf(classroom.schoolYearId);
    const gradeLevelId = gradeLevelIdOf(classroom);

    const [subjects, terms, configured] = await Promise.all([
      gradeLevelId ? this.subjects.findMarkedForGradeLevel(gradeLevelId) : Promise.resolve([]),
      this.semesterModel.find({ schoolYearId, deletedAt: null }).sort({ number: 1 }).lean().exec(),
      this.settings.getValue<Record<string, number[]>>('grading.semesterMonths'),
    ]);
    const termMonths = terms.map((term) => monthsForSemester(term.number, configured));
    const subjectIds = subjects.map((subject) => subject._id.toString());

    const classroomId = classroom._id.toString();
    const [marks, roster] = await Promise.all([
      Promise.all(
        terms.map((term) => this.marks.getClassroomSubjectMarks(classroomId, term._id.toString())),
      ),
      this.loadRoster(classroom._id),
    ]);

    // Students with a mark but no placement here any more still belong on the
    // sheet if they sat the room this year — `loadRoster` keeps closed rows.
    const rows = roster.filter(
      (row) => row.isEnrolled || marks.some((term) => term.has(row.studentId)),
    );
    const studentIds = rows.map((row) => new Types.ObjectId(row.studentId));

    const [monthRegisters, termRegisters] = await this.loadRegisters(
      classroom._id,
      terms,
      termMonths,
      studentIds,
      schoolYearId,
    );

    return {
      classroom: this.marks.classroomView(classroom),
      schoolYear: schoolYearView(classroom.schoolYearId),
      subjects: subjects.map((subject) => ({
        id: subject._id.toString(),
        code: subject.code,
        nameLo: subject.nameLo,
        nameEn: subject.nameEn ?? null,
        // 10, or 9 — the pass line is half of it.
        fullMark: fullMarkOf(columnMaxFor(subject.monthlyColumnMax)),
      })),
      semesters: terms.map((term, index) => ({
        id: term._id.toString(),
        number: term.number,
        nameLo: term.nameLo,
        nameEn: term.nameEn ?? null,
        months: termMonths[index],
      })),
      classSize: {
        students: rows.filter((row) => row.isEnrolled).length,
        female: rows.filter((row) => row.isEnrolled && row.gender === 'female').length,
      },
      rows: rows.map((row) => {
        const termLines = terms.map((_, index) => {
          const bySubject = new Map(
            (marks[index].get(row.studentId) ?? []).map((mark) => [mark.subjectId, mark]),
          );
          const ofSubject = (subjectId: string) => bySubject.get(subjectId);
          return {
            months: termMonths[index].map((month, position) => ({
              month,
              scores: subjectIds.map(
                (id) =>
                  ofSubject(id)?.monthScores.find((entry) => entry.month === month)?.score ?? null,
              ),
              ...monthFigures(row.studentId, monthRegisters[index][position]),
            })),
            exam: subjectIds.map((id) => ofSubject(id)?.examScore ?? null),
            // ພາກຮຽນ, which is `null` until the months and the exam are both in.
            marks: subjectIds.map((id) => ofSubject(id)?.mark ?? null),
            ...monthFigures(row.studentId, termRegisters[index]),
          };
        });

        const year: RegisterFigures = sumFigures(
          termLines.map(({ deducted, absences }) => ({ deducted, absences })),
        );
        return {
          studentId: row.studentId,
          studentCode: row.studentCode,
          rollNumber: row.rollNumber,
          isEnrolled: row.isEnrolled,
          gender: row.gender,
          firstNameLo: row.firstNameLo,
          lastNameLo: row.lastNameLo,
          nickname: row.nickname,
          terms: termLines,
          annual: subjectIds.map(
            (_, position) =>
              annualScore(
                termLines[0]?.marks[position] ?? null,
                termLines[1]?.marks[position] ?? null,
              ).value,
          ),
          ...year,
        };
      }),
    };
  }

  /**
   * The class list, one row per child, with the name split the way the sheet
   * prints it — ຊື່ and ນາມສະກຸນ in their own columns, ເພດ beside them.
   */
  private async loadRoster(classroomId: Types.ObjectId) {
    const enrollments = await this.enrollmentModel
      .find({ classroomId, deletedAt: null })
      .populate('studentId', `${STUDENT_NAME_SELECT} status gender`)
      .sort({ rollNumber: 1 })
      .lean()
      .exec();

    const rows = enrollments
      .filter((enrollment) => isStudying(enrollment.studentId))
      .map((enrollment) => {
        const student = populatedStudent(enrollment.studentId) as
          (ReturnType<typeof populatedStudent> & { gender?: string }) | null;
        return {
          studentId: student?._id.toString() ?? String(enrollment.studentId),
          studentCode: enrollment.studentCode,
          rollNumber: enrollment.rollNumber ?? null,
          isEnrolled: enrollment.status === 'active',
          gender: student?.gender ?? null,
          firstNameLo: student?.firstNameLo ?? null,
          lastNameLo: student?.lastNameLo ?? null,
          nickname: nicknameOf(student),
        };
      });

    // A child who left and came back holds two rows here; the open one is theirs.
    return rows.filter((row) => {
      const own = rows.filter((other) => other.studentId === row.studentId);
      return row === (own.find((other) => other.isEnrolled) ?? own[own.length - 1]);
    });
  }

  /**
   * ວັນຂາດ off the roll, as the class summary counts them (three lates are a day),
   * and the points taken off the ledger — per month the term collects, and over
   * the whole term.
   *
   * The term is read whole rather than added up from its months: ທັນວາ and
   * ມັງກອນ are exam months nobody is marked in, but a child absent in them was
   * absent, and a point taken in them is gone from the year's 100.
   */
  private async loadRegisters(
    classroomId: Types.ObjectId,
    terms: { _id: Types.ObjectId }[],
    termMonths: number[][],
    studentIds: Types.ObjectId[],
    schoolYearId: Types.ObjectId,
  ): Promise<[RegisterInputs[][], RegisterInputs[]]> {
    const roll = async (termId: Types.ObjectId, month?: number) => {
      const summary = await this.attendances.getClassroomSummary(
        classroomId.toString(),
        termId.toString(),
        month ? { month } : {},
      );
      return summary.length === 0
        ? null
        : new Map(summary.map((row) => [row.studentId, row.absentTotal]));
    };

    const points =
      studentIds.length === 0
        ? []
        : await this.deductionModel
            .aggregate<{
              _id: { studentId: Types.ObjectId; semesterId: Types.ObjectId; month: number };
              points: number;
            }>([
              { $match: { studentId: { $in: studentIds }, schoolYearId, deletedAt: null } },
              {
                $group: {
                  // Dates are stored as UTC midnight of the school's calendar day.
                  _id: {
                    studentId: '$studentId',
                    semesterId: '$semesterId',
                    month: { $month: '$date' },
                  },
                  points: { $sum: '$points' },
                },
              },
            ])
            .exec();

    const deductedOver = (termId: Types.ObjectId, month?: number) => {
      const totals = new Map<string, number>();
      for (const row of points) {
        if (!row._id.semesterId?.equals(termId)) continue;
        if (month !== undefined && row._id.month !== month) continue;
        const key = row._id.studentId.toString();
        totals.set(key, (totals.get(key) ?? 0) + row.points);
      }
      return totals;
    };

    const months = await Promise.all(
      terms.map((term, index) =>
        Promise.all(
          termMonths[index].map(async (month) => ({
            absences: await roll(term._id, month),
            deducted: deductedOver(term._id, month),
          })),
        ),
      ),
    );
    const whole = await Promise.all(
      terms.map(async (term) => ({
        absences: await roll(term._id),
        deducted: deductedOver(term._id),
      })),
    );
    return [months, whole];
  }
}

function refIdOf(ref: unknown): Types.ObjectId {
  const value = ref as { _id?: Types.ObjectId } | Types.ObjectId;
  return (value as { _id?: Types.ObjectId })._id ?? (value as Types.ObjectId);
}

function schoolYearView(ref: unknown) {
  const year = ref as { _id?: Types.ObjectId; code?: string; nameLo?: string } | null;
  return year?._id
    ? { id: year._id.toString(), code: year.code ?? null, nameLo: year.nameLo ?? null }
    : null;
}
