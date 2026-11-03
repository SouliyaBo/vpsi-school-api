import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { AppException } from 'src/common/exceptions/app.exception';
import type { AuthenticatedUser } from 'src/common/interfaces/authenticated-user.interface';
import { RecordScopeService } from 'src/common/services/record-scope.service';
import { Classroom, ClassroomDocument } from 'src/database/schemas';
import { SemestersService } from '../semesters/semesters.service';
import { SettingsService } from '../settings/settings.service';
import { StandingQueryDto } from './dto/monthly-mark.dto';
import { monthsForSemester } from './monthly-grading';
import { MonthlyMarksService } from './monthly-marks.service';
import {
  standingOf,
  sumSubjectTallies,
  tallyBands,
  tallySubject,
  TOP_MARK,
  failsSubject,
  type StandingBand,
  type SubjectTally,
} from './monthly-standing';

/** One month the school collects marks for, in the term it belongs to. */
export interface StandingPeriod {
  semesterId: string;
  semesterNumber: number;
  semesterNameLo: string;
  semesterNameEn: string | null;
  month: number;
}

type ClassMonth = Awaited<ReturnType<MonthlyMarksService['getClassMonth']>>;

/**
 * ສະຫຼຸບຜົນການຮຽນປະຈຳເດືອນ — the whole school's month, banded and compared.
 *
 * Read off ສະຫຼຸບປະຈຳເດືອນ for every class rather than from the marks directly,
 * so a subject's ລວມ, the columns a grade is marked in and who is on the roll are
 * worked out in one place and this report cannot disagree with the class sheet.
 * The bands themselves are in `monthly-standing.ts`.
 *
 * Both months are read against today's class list: a student who has moved to
 * another room is counted in that room for both months, and one who has left
 * the school is counted nowhere. The shares then compare the same children,
 * which is the question the office is asking.
 */
@Injectable()
export class MonthlyStandingService {
  constructor(
    @InjectModel(Classroom.name) private readonly classroomModel: Model<ClassroomDocument>,
    private readonly marks: MonthlyMarksService,
    private readonly semesters: SemestersService,
    private readonly settings: SettingsService,
    private readonly scope: RecordScopeService,
  ) {}

  async getStanding(query: StandingQueryDto, actor: AuthenticatedUser) {
    // A student or guardian holds `scores:read` for their own marks; a page of
    // every class is not theirs.
    if (this.scope.isScoped(actor)) throw AppException.forbidden('auth.forbidden');

    const semester = query.semesterId
      ? await this.semesters.findOneOrFail(query.semesterId)
      : await this.semesters.getActiveOrFail();
    const schoolYearId = semester.schoolYearId.toString();
    const periods = await this.periodsOf(schoolYearId);

    const current = this.currentPeriod(periods, semester._id.toString(), query.month);
    const previous = this.previousPeriod(periods, current, query);

    // A homeroom teacher sees their own room; a teacher with none sees nothing.
    const own = await this.scope.homeroomClassroomIds(actor, schoolYearId);
    const rooms = await this.classroomModel
      .find({
        schoolYearId: new Types.ObjectId(schoolYearId),
        deletedAt: null,
        isActive: { $ne: false },
        ...(own === null ? {} : { _id: { $in: own } }),
      })
      .populate('gradeLevelId', 'level')
      .select('_id name gradeLevelId')
      .lean()
      .exec();
    rooms.sort(
      (a, b) =>
        levelOf(a.gradeLevelId) - levelOf(b.gradeLevelId) || a.name.localeCompare(b.name, 'lo'),
    );

    const sheets = await Promise.all(
      rooms.map(async (room) => {
        const classroomId = room._id.toString();
        const [now, before] = await Promise.all([
          this.marks.getClassMonth({
            classroomId,
            semesterId: current.semesterId,
            month: current.month,
          }),
          previous
            ? this.marks.getClassMonth({
                classroomId,
                semesterId: previous.semesterId,
                month: previous.month,
              })
            : Promise.resolve(null),
        ]);
        return { now: standingsOf(now), before: before ? standingsOf(before) : null };
      }),
    );

    /** Last month's band, by student — whichever room's sheet they were on. */
    const previousBand = new Map<string, StandingBand>();
    for (const sheet of sheets) {
      for (const row of sheet.before?.rows ?? []) previousBand.set(row.studentId, row.band);
    }

    const classrooms = sheets.map(({ now, before }) => {
      const beforeSubjects = new Map(before?.subjects.map((subject) => [subject.id, subject]));
      return {
        ...now.classroom,
        current: now.tally,
        previous: before?.tally ?? null,
        subjects: now.subjects.map((subject) => ({
          id: subject.id,
          nameLo: subject.nameLo,
          nameEn: subject.nameEn,
          fullMark: subject.fullMark,
          current: subject.tally,
          previous: beforeSubjects.get(subject.id)?.tally ?? null,
        })),
      };
    });

    return {
      schoolYearId,
      periods,
      current,
      previous,
      topMark: TOP_MARK,
      total: {
        current: tallyBands(sheets.flatMap((sheet) => sheet.now.rows.map((row) => row.band))),
        previous: previous
          ? tallyBands(sheets.flatMap((sheet) => sheet.before?.rows.map((row) => row.band) ?? []))
          : null,
      },
      classrooms,
      subjects: schoolSubjects(sheets),
      students: sheets.flatMap((sheet) =>
        sheet.now.rows.map((row) => ({
          ...row,
          previousBand: previous ? (previousBand.get(row.studentId) ?? null) : null,
        })),
      ),
    };
  }

  /** Every month of the year the school collects, in order: term I's, then term II's. */
  private async periodsOf(schoolYearId: string): Promise<StandingPeriod[]> {
    const [semesters, configured] = await Promise.all([
      this.semesters.findForYear(schoolYearId),
      this.settings.getValue<Record<string, number[]>>('grading.semesterMonths'),
    ]);
    return semesters.flatMap((semester) =>
      monthsForSemester(semester.number, configured).map((month) => ({
        semesterId: semester._id.toString(),
        semesterNumber: semester.number,
        semesterNameLo: semester.nameLo,
        semesterNameEn: semester.nameEn ?? null,
        month,
      })),
    );
  }

  /**
   * The month asked for, or this month — or, between the term's months (the
   * exam break), the term's last month, as ສະຫຼຸບປະຈຳເດືອນ does.
   */
  private currentPeriod(
    periods: StandingPeriod[],
    semesterId: string,
    month: number | undefined,
  ): StandingPeriod {
    const ofTerm = periods.filter((period) => period.semesterId === semesterId);
    if (month !== undefined) {
      const asked = ofTerm.find((period) => period.month === month);
      if (!asked) throw AppException.badRequest('monthlyMark.monthNotInTerm', { month });
      return asked;
    }
    const today = new Date().getMonth() + 1;
    const found = ofTerm.find((period) => period.month === today) ?? ofTerm[ofTerm.length - 1];
    if (!found) throw AppException.badRequest('monthlyMark.monthNotInTerm', { month: today });
    return found;
  }

  /** The month asked to compare with, or the one before the current month in the year. */
  private previousPeriod(
    periods: StandingPeriod[],
    current: StandingPeriod,
    query: StandingQueryDto,
  ): StandingPeriod | null {
    if (query.compareMonth !== undefined) {
      const asked = periods.find(
        (period) =>
          period.month === query.compareMonth &&
          (!query.compareSemesterId || period.semesterId === query.compareSemesterId),
      );
      if (!asked) {
        throw AppException.badRequest('monthlyMark.monthNotInTerm', { month: query.compareMonth });
      }
      return asked;
    }
    const index = periods.findIndex(
      (period) => period.semesterId === current.semesterId && period.month === current.month,
    );
    return index > 0 ? periods[index - 1] : null;
  }
}

/** Each enrolled student of one class sheet, banded, and each subject tallied. */
function standingsOf(sheet: ClassMonth) {
  const fullMarks = sheet.subjects.map((subject) => subject.fullMark);
  // A student moved out of the room stays on its sheet for the marks they left
  // behind; they are counted in the room they are in now.
  const enrolled = sheet.rows.filter((row) => row.isEnrolled);

  const rows = enrolled.map((row) => {
    const marked = row.scores.filter((score): score is number => score !== null);
    return {
      studentId: row.studentId,
      studentCode: row.studentCode,
      studentNameLo: row.studentNameLo,
      studentNickname: row.studentNickname,
      rollNumber: row.rollNumber,
      classroomId: sheet.classroom.id,
      band: standingOf(row.scores, fullMarks),
      average: row.average,
      lowest: marked.length > 0 ? Math.min(...marked) : null,
      subjectsMarked: marked.length,
      subjectsExpected: sheet.subjects.length,
      failing: sheet.subjects
        .map((subject, index) => ({
          subjectId: subject.id,
          nameLo: subject.nameLo,
          nameEn: subject.nameEn,
          score: row.scores[index],
          fullMark: subject.fullMark,
        }))
        .filter(
          (entry): entry is typeof entry & { score: number } =>
            entry.score !== null && failsSubject(entry.score, entry.fullMark),
        ),
    };
  });

  return {
    classroom: {
      id: sheet.classroom.id,
      name: sheet.classroom.name,
      gradeLevelCode: sheet.classroom.gradeLevelCode,
      homeroomTeacherName: sheet.classroom.homeroomTeacherName,
    },
    rows,
    tally: tallyBands(rows.map((row) => row.band)),
    subjects: sheet.subjects.map((subject, index) => ({
      id: subject.id,
      nameLo: subject.nameLo,
      nameEn: subject.nameEn,
      fullMark: subject.fullMark,
      tally: tallySubject(
        enrolled.map((row) => row.scores[index]),
        subject.fullMark,
      ),
    })),
  };
}

/**
 * The school's subjects, each summed over the classes that sit it.
 *
 * Joined by Lao name: each grade keeps its own subject rows (ພາສາລາວ at ມ.1 is
 * not the same record as at ມ.4), but the office reads "ຄະນິດສາດ" across the school.
 * Counts are summed before the share is taken, never the classes' percentages.
 */
function schoolSubjects(
  sheets: { now: ReturnType<typeof standingsOf>; before: ReturnType<typeof standingsOf> | null }[],
) {
  const order: string[] = [];
  const now = new Map<string, { nameEn: string | null; tallies: SubjectTally[] }>();
  const before = new Map<string, SubjectTally[]>();

  for (const sheet of sheets) {
    for (const subject of sheet.now.subjects) {
      if (!now.has(subject.nameLo)) {
        order.push(subject.nameLo);
        now.set(subject.nameLo, { nameEn: subject.nameEn, tallies: [] });
      }
      now.get(subject.nameLo)!.tallies.push(subject.tally);
    }
    for (const subject of sheet.before?.subjects ?? []) {
      before.set(subject.nameLo, [...(before.get(subject.nameLo) ?? []), subject.tally]);
    }
  }

  return order.map((nameLo) => {
    const entry = now.get(nameLo)!;
    const earlier = before.get(nameLo);
    return {
      nameLo,
      nameEn: entry.nameEn,
      current: sumSubjectTallies(entry.tallies),
      previous: earlier ? sumSubjectTallies(earlier) : null,
    };
  });
}

function levelOf(gradeLevel: unknown): number {
  const level = (gradeLevel as { level?: number } | null)?.level;
  return typeof level === 'number' ? level : 99;
}
