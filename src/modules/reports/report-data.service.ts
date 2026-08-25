import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { AppException } from 'src/common/exceptions/app.exception';
import {
  Classroom,
  ClassroomDocument,
  GradeLevel,
  GradeLevelDocument,
  SchoolYear,
  SchoolYearDocument,
  Semester,
  SemesterDocument,
  Student,
  StudentDocument,
  TermResult,
  TermResultDocument,
} from 'src/database/schemas';
import { AttendancesService } from '../attendances/attendances.service';
import { SettingsService } from '../settings/settings.service';
import { CONDUCT_LABELS, GENDER_LABELS, ReportData } from './pdf/pdf-renderer.service';

/**
 * Gathers everything a report needs into one flat structure.
 *
 * Kept apart from the renderer so the renderer stays a pure
 * layout-plus-data function — that separation is what makes the PDF layer
 * testable without a database.
 */
@Injectable()
export class ReportDataService {
  constructor(
    @InjectModel(TermResult.name) private readonly termResultModel: Model<TermResultDocument>,
    @InjectModel(Student.name) private readonly studentModel: Model<StudentDocument>,
    @InjectModel(Classroom.name) private readonly classroomModel: Model<ClassroomDocument>,
    @InjectModel(GradeLevel.name) private readonly gradeLevelModel: Model<GradeLevelDocument>,
    @InjectModel(SchoolYear.name) private readonly schoolYearModel: Model<SchoolYearDocument>,
    @InjectModel(Semester.name) private readonly semesterModel: Model<SemesterDocument>,
    private readonly attendances: AttendancesService,
    private readonly settings: SettingsService,
  ) {}

  /**
   * Assembles a report card from a stored term result.
   *
   * Reads the stored `termResults` document rather than recomputing: the report
   * must show exactly the marks that were computed and reviewed, not a fresh
   * calculation that might differ if a score changed in between.
   */
  async buildReportCard(studentId: string, semesterId: string): Promise<ReportData> {
    const termResult = await this.termResultModel
      .findOne({
        studentId: new Types.ObjectId(studentId),
        semesterId: new Types.ObjectId(semesterId),
        deletedAt: null,
      })
      .lean()
      .exec();

    if (!termResult) {
      throw AppException.notFound('termResult.noScores', { studentId, semesterId });
    }

    const [student, classroom, semester, schoolName] = await Promise.all([
      this.studentModel.findById(termResult.studentId).lean().exec(),
      this.classroomModel.findById(termResult.classroomId).lean().exec(),
      this.semesterModel.findById(termResult.semesterId).lean().exec(),
      this.resolveSchoolName(),
    ]);

    if (!student) throw AppException.notFound('common.notFound', { field: 'studentId' });

    const [gradeLevel, schoolYear, attendance] = await Promise.all([
      classroom ? this.gradeLevelModel.findById(classroom.gradeLevelId).lean().exec() : null,
      this.schoolYearModel.findById(termResult.schoolYearId).lean().exec(),
      this.attendances.getStudentSummary(studentId, semesterId),
    ]);

    const primaryGuardian =
      student.guardians.find((link) => link.isPrimary) ?? student.guardians[0] ?? null;

    return {
      schoolNameLo: schoolName,
      student: {
        studentCode: student.studentCode,
        fullNameLo: `${student.firstNameLo} ${student.lastNameLo}`,
        genderLo: GENDER_LABELS[student.gender] ?? student.gender,
        dateOfBirth: student.dateOfBirth ?? null,
        villageLo: null,
        guardianLo: primaryGuardian
          ? `${primaryGuardian.fullNameLo} (${primaryGuardian.phone})`
          : null,
      },
      academic: {
        classroomName: classroom?.name ?? '—',
        gradeLevelLo: gradeLevel?.nameLo ?? '—',
        schoolYearCode: schoolYear?.code ?? '—',
        semesterLo: semester?.nameLo ?? '—',
      },
      markScale: await this.resolveMarkScale(),
      subjects: termResult.subjects.map((subject) => ({
        nameLo: subject.subjectNameLo,
        credits: subject.credits,
        percentage: subject.percentage,
        grade: subject.grade,
        gradePoint: subject.gradePoint,
        isPassed: subject.isPassed,
        components: subject.components.map((component) => ({
          nameLo: component.nameLo,
          score: component.score ?? null,
          maxScore: component.maxScore,
          weight: component.weight,
        })),
      })),
      summary: {
        average: termResult.average,
        gpa: termResult.gpa,
        grade: termResult.grade,
        rank: termResult.rank ?? null,
        totalStudents: termResult.totalStudents ?? null,
        subjectsPassed: termResult.subjectsPassed,
        subjectsFailed: termResult.subjectsFailed,
        isProvisional: termResult.isProvisional,
      },
      attendance: {
        present: attendance.present,
        absent: attendance.absent,
        late: attendance.late,
        excused: attendance.excused + attendance.sick,
      },
      conductGradeLo: termResult.conductGrade
        ? (CONDUCT_LABELS[termResult.conductGrade] ?? termResult.conductGrade)
        : null,
    };
  }

  /**
   * Assembles a certificate.
   *
   * Falls back to a bare student record when no term result exists, because a
   * participation or achievement certificate has no marks behind it.
   */
  async buildCertificate(
    studentId: string,
    options: {
      certificateNumber: string;
      issuedDate: Date;
      titleLo: string | null;
      schoolYearId?: string | null;
      gradeLevelId?: string | null;
      semesterId?: string | null;
    },
  ): Promise<ReportData> {
    if (options.semesterId) {
      const withMarks = await this.termResultModel
        .findOne({
          studentId: new Types.ObjectId(studentId),
          semesterId: new Types.ObjectId(options.semesterId),
          deletedAt: null,
        })
        .lean()
        .exec();

      if (withMarks) {
        const base = await this.buildReportCard(studentId, options.semesterId);
        return { ...base, certificate: this.toCertificateBlock(options) };
      }
    }

    const [student, schoolName] = await Promise.all([
      this.studentModel.findById(studentId).lean().exec(),
      this.resolveSchoolName(),
    ]);
    if (!student) throw AppException.notFound();

    const [gradeLevel, schoolYear] = await Promise.all([
      options.gradeLevelId
        ? this.gradeLevelModel.findById(options.gradeLevelId).lean().exec()
        : null,
      options.schoolYearId
        ? this.schoolYearModel.findById(options.schoolYearId).lean().exec()
        : null,
    ]);

    return {
      schoolNameLo: schoolName,
      student: {
        studentCode: student.studentCode,
        fullNameLo: `${student.firstNameLo} ${student.lastNameLo}`,
        genderLo: GENDER_LABELS[student.gender] ?? student.gender,
        dateOfBirth: student.dateOfBirth ?? null,
        villageLo: null,
        guardianLo: null,
      },
      academic: {
        classroomName: '—',
        gradeLevelLo: gradeLevel?.nameLo ?? '—',
        schoolYearCode: schoolYear?.code ?? '—',
        semesterLo: '—',
      },
      subjects: [],
      summary: {
        average: 0,
        gpa: 0,
        grade: '—',
        rank: null,
        totalStudents: null,
        subjectsPassed: 0,
        subjectsFailed: 0,
        isProvisional: false,
      },
      attendance: { present: 0, absent: 0, late: 0, excused: 0 },
      conductGradeLo: null,
      certificate: this.toCertificateBlock(options),
    };
  }

  /** Narrows the caller's options to the fields the renderer prints. */
  private toCertificateBlock(options: {
    certificateNumber: string;
    issuedDate: Date;
    titleLo: string | null;
  }): { number: string; issuedDate: Date; titleLo: string | null } {
    return {
      number: options.certificateNumber,
      issuedDate: options.issuedDate,
      titleLo: options.titleLo,
    };
  }

  /** Every actively enrolled student in a classroom — the batch report unit. */
  async listClassroomStudentIds(classroomId: string, semesterId: string): Promise<string[]> {
    const results = await this.termResultModel
      .find({
        classroomId: new Types.ObjectId(classroomId),
        semesterId: new Types.ObjectId(semesterId),
        deletedAt: null,
      })
      .select('studentId')
      .sort({ rank: 1 })
      .lean()
      .exec();

    return results.map((result) => result.studentId.toString());
  }

  /**
   * What marks are printed out of.
   *
   * The stored figure is always a percentage; this only decides how it is read
   * back. Defaults to 100 so a school that has not said otherwise keeps the
   * report card it had.
   */
  private async resolveMarkScale(): Promise<number> {
    const configured = await this.settings.getValue<number>('grading.reportMarkScale');
    return typeof configured === 'number' && configured > 0 ? configured : 100;
  }

  private async resolveSchoolName(): Promise<string> {
    const configured = await this.settings.getValue<string>('school.nameLo');
    return configured ?? 'ໂຮງຮຽນ';
  }
}
