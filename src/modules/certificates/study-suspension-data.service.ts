import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { GuardianRelationship, TITLE_BY_GENDER } from 'src/common/constants/enums';
import { AppException } from 'src/common/exceptions/app.exception';
import { AddressableLocation, bareLocationName } from 'src/common/utils/location-path';
import {
  Certificate,
  CertificateDocument,
  Classroom,
  ClassroomDocument,
  Enrollment,
  EnrollmentDocument,
  GradeLevel,
  GradeLevelDocument,
  Guardian,
  GuardianDocument,
  Location,
  LocationDocument,
  SchoolYear,
  SchoolYearDocument,
  Student,
  StudentDocument,
  StudySuspensionDetails,
} from 'src/database/schemas';
import { StudySuspensionData } from '../reports/pdf/study-suspension.renderer';
import { SettingsService } from '../settings/settings.service';

/** The editable fields of a memo, as the office reviews them before issuing. */
export interface StudySuspensionDraft {
  guardianNameLo: string | null;
  guardianPhone: string | null;
  villageLo: string | null;
  districtLo: string | null;
  provinceLo: string | null;
  classLabelLo: string | null;
  schoolYearCode: string | null;
  /** ISO date; null means "from the day the memo is issued". */
  suspendedFrom: string | null;
}

/** A draft plus the parts of it nobody may edit, for the review dialog. */
export interface StudySuspensionPrefill extends StudySuspensionDraft {
  studentId: string;
  studentCode: string;
  titleLo: string;
  fullNameLo: string;
  /** Which fields the register could not supply, so the dialog can mark them. */
  missing: (keyof StudySuspensionDraft)[];
}

const SCHOOL_DEFAULTS = {
  authorityLo: 'ພະແນກສຶກສາທິການ ແລະ ກີລາ',
  nameLo: 'ໂຮງຮຽນ',
  provinceLo: '',
  phone: '',
  principalTitleLo: 'ອຳນວຍການໂຮງຮຽນ',
} as const;

/** The title a guardian's relationship implies, when the register holds no gender. */
const TITLE_BY_RELATIONSHIP: Partial<Record<GuardianRelationship, string>> = {
  father: 'ທ້າວ',
  grandfather: 'ທ້າວ',
  uncle: 'ທ້າວ',
  mother: 'ນາງ',
  grandmother: 'ນາງ',
  aunt: 'ນາງ',
};

/**
 * Gathers what a `ບົດບັນທຶກ ຂໍໂຈະການຮຽນ` states and reports what is missing.
 *
 * A sibling of `StudyCertificateDataService` rather than an extension of it:
 * the two forms ask the register different questions. The letter wants the
 * pupil's birthplace and parents; the memo wants the *guardian who signs*, their
 * phone, and the address split into the three parts the form labels itself.
 */
@Injectable()
export class StudySuspensionDataService {
  constructor(
    @InjectModel(Student.name) private readonly studentModel: Model<StudentDocument>,
    @InjectModel(Guardian.name) private readonly guardianModel: Model<GuardianDocument>,
    @InjectModel(Location.name) private readonly locationModel: Model<LocationDocument>,
    @InjectModel(Enrollment.name) private readonly enrollmentModel: Model<EnrollmentDocument>,
    @InjectModel(Classroom.name) private readonly classroomModel: Model<ClassroomDocument>,
    @InjectModel(GradeLevel.name) private readonly gradeLevelModel: Model<GradeLevelDocument>,
    @InjectModel(SchoolYear.name) private readonly schoolYearModel: Model<SchoolYearDocument>,
    @InjectModel(Certificate.name) private readonly certificateModel: Model<CertificateDocument>,
    private readonly settings: SettingsService,
  ) {}

  /**
   * Builds the draft the office reviews.
   *
   * Falls back to the last memo issued for the same pupil for anything the
   * register cannot answer, for the same reason the study letter does: whoever
   * typed it the first time asked the family.
   */
  async prefill(studentId: string): Promise<StudySuspensionPrefill> {
    if (!Types.ObjectId.isValid(studentId)) throw AppException.notFound();

    const student = await this.studentModel
      .findOne({ _id: studentId, deletedAt: null })
      .populate<{ villageId: LocationDocument | null }>('villageId', 'nameLo type ancestors')
      .lean()
      .exec();
    if (!student) throw AppException.notFound();

    const [guardian, address, placement, previous] = await Promise.all([
      this.resolveGuardian(student),
      this.resolveAddress(student),
      this.resolvePlacement(studentId),
      this.lastIssuedDetails(studentId),
    ]);

    const draft: StudySuspensionDraft = {
      guardianNameLo: guardian.nameLo ?? previous?.guardianNameLo ?? null,
      guardianPhone: guardian.phone ?? previous?.guardianPhone ?? null,
      villageLo: address.villageLo ?? previous?.villageLo ?? null,
      districtLo: address.districtLo ?? previous?.districtLo ?? null,
      provinceLo: address.provinceLo ?? previous?.provinceLo ?? null,
      classLabelLo: placement.classLabelLo ?? previous?.classLabelLo ?? null,
      schoolYearCode: placement.schoolYearCode ?? previous?.schoolYearCode ?? null,
      // Never carried over: the day a pupil leaves is decided per memo.
      suspendedFrom: null,
    };

    return {
      ...draft,
      studentId,
      studentCode: student.studentCode,
      titleLo: TITLE_BY_GENDER[student.gender] ?? '',
      fullNameLo: `${student.firstNameLo} ${student.lastNameLo}`,
      missing: (Object.keys(draft) as (keyof StudySuspensionDraft)[]).filter(
        // The date is the office's choice, not a register fact — a blank there
        // is not something "not on file".
        (key) => key !== 'suspendedFrom' && (draft[key] ?? '').trim().length === 0,
      ),
    };
  }

  /** Everything the renderer prints, for a memo that is being issued. */
  async assemble(options: {
    studentId: string;
    certificateNumber: string;
    issuedDate: Date;
    details: StudySuspensionDetails;
  }): Promise<StudySuspensionData> {
    const student = await this.studentModel
      .findOne({ _id: options.studentId, deletedAt: null })
      .lean()
      .exec();
    if (!student) throw AppException.notFound();

    return {
      school: await this.resolveSchool(),
      memo: { numberLo: options.certificateNumber, issuedDate: options.issuedDate },
      guardian: {
        nameLo: options.details.guardianNameLo ?? null,
        phone: options.details.guardianPhone ?? null,
        villageLo: options.details.villageLo ?? null,
        districtLo: options.details.districtLo ?? null,
        provinceLo: options.details.provinceLo ?? null,
      },
      student: {
        titleLo: TITLE_BY_GENDER[student.gender] ?? '',
        fullNameLo: `${student.firstNameLo} ${student.lastNameLo}`,
        studentCode: options.details.studentCode ?? student.studentCode,
        classLabelLo: options.details.classLabelLo ?? null,
      },
      suspension: {
        schoolYearCode: options.details.schoolYearCode ?? null,
        fromDate: options.details.suspendedFrom ?? null,
        reasonLo: options.details.reasonLo ?? null,
        documentsLo: options.details.documentsLo ?? [],
      },
    };
  }

  /**
   * Merges a caller's overrides over the draft, so a partial body is enough.
   *
   * `suspendedFrom` defaults to the issue date rather than to nothing: the memo
   * is usually written on the day the parent comes in, and a dotted run where
   * the date goes would be the one blank on the form that is never right.
   */
  async resolveDetails(
    studentId: string,
    overrides: Partial<StudySuspensionDraft> & { reasonLo?: string; documentsLo?: string[] },
    issuedDate: Date,
  ): Promise<StudySuspensionDetails> {
    const prefill = await this.prefill(studentId);
    const pick = (override: string | null | undefined, fallback: string | null): string | null => {
      if (override === undefined) return fallback;
      const trimmed = override?.trim();
      return trimmed && trimmed.length > 0 ? trimmed : null;
    };

    const from = overrides.suspendedFrom?.trim();
    const suspendedFrom = from ? new Date(from) : issuedDate;

    return {
      guardianNameLo: pick(overrides.guardianNameLo, prefill.guardianNameLo),
      guardianPhone: pick(overrides.guardianPhone, prefill.guardianPhone),
      villageLo: pick(overrides.villageLo, prefill.villageLo),
      districtLo: pick(overrides.districtLo, prefill.districtLo),
      provinceLo: pick(overrides.provinceLo, prefill.provinceLo),
      classLabelLo: pick(overrides.classLabelLo, prefill.classLabelLo),
      schoolYearCode: pick(overrides.schoolYearCode, prefill.schoolYearCode),
      suspendedFrom: Number.isNaN(suspendedFrom.getTime()) ? issuedDate : suspendedFrom,
      // Decided per memo, never drafted from the register or a previous memo.
      reasonLo: pick(overrides.reasonLo, null),
      documentsLo: (overrides.documentsLo ?? [])
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0),
      studentCode: prefill.studentCode,
    };
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  private async resolveSchool(): Promise<StudySuspensionData['school']> {
    const [authorityLo, nameLo, provinceLo, phone, principalTitleLo] = await Promise.all([
      this.settings.getValue<string>('school.authorityLo'),
      this.settings.getValue<string>('school.nameLo'),
      this.settings.getValue<string>('school.provinceLo'),
      this.settings.getValue<string>('school.phone'),
      this.settings.getValue<string>('school.principalTitleLo'),
    ]);

    return {
      authorityLo: authorityLo ?? SCHOOL_DEFAULTS.authorityLo,
      nameLo: nameLo ?? SCHOOL_DEFAULTS.nameLo,
      provinceLo: provinceLo ?? SCHOOL_DEFAULTS.provinceLo,
      phone: phone ?? SCHOOL_DEFAULTS.phone,
      principalTitleLo: principalTitleLo ?? SCHOOL_DEFAULTS.principalTitleLo,
    };
  }

  /**
   * The guardian who signs: the primary contact if one is flagged, else the
   * father, else the mother, else whoever is listed first.
   *
   * The title comes from the guardian's own gender when the register holds it,
   * and from the relationship when it does not — a `father` is `ທ້າວ` whatever
   * the gender field says, because the field is null on most imported rows.
   */
  private async resolveGuardian(student: {
    guardians?: {
      guardianId: Types.ObjectId;
      relationship: GuardianRelationship;
      fullNameLo: string;
      phone: string;
      isPrimary: boolean;
    }[];
  }): Promise<{ nameLo: string | null; phone: string | null }> {
    const links = student.guardians ?? [];
    const link =
      links.find((entry) => entry.isPrimary) ??
      links.find((entry) => entry.relationship === 'father') ??
      links.find((entry) => entry.relationship === 'mother') ??
      links[0];
    if (!link) return { nameLo: null, phone: null };

    const name = link.fullNameLo?.trim();
    const phone = link.phone?.trim() || null;
    if (!name) return { nameLo: null, phone };

    // A name that already carries a title is left alone — some rows were typed
    // by hand rather than imported.
    if (/^(ທ້າວ|ນາງ|ທ\.|ນ\.)\s/.test(name)) return { nameLo: name, phone };

    let title = TITLE_BY_RELATIONSHIP[link.relationship];
    if (!title) {
      const guardian = await this.guardianModel
        .findById(link.guardianId)
        .select('gender')
        .lean()
        .exec();
      title = guardian?.gender ? TITLE_BY_GENDER[guardian.gender] : undefined;
    }

    return { nameLo: title ? `${title} ${name}` : name, phone };
  }

  /**
   * The pupil's address as the three bare names the form's own labels expect.
   *
   * A village on file is the usual case; a pupil recorded only to district
   * level (the official village list covers Vientiane Capital alone) leaves the
   * village blank rather than the whole address.
   */
  private async resolveAddress(student: {
    villageId?: unknown;
    addressDetail?: string | null;
  }): Promise<{ villageLo: string | null; districtLo: string | null; provinceLo: string | null }> {
    const node = this.asLocation(student.villageId);
    const empty = { villageLo: null, districtLo: null, provinceLo: null };
    if (!node) {
      const detail = student.addressDetail?.trim();
      return detail ? { ...empty, villageLo: detail } : empty;
    }

    const ancestors =
      (node.ancestors ?? []).length > 0
        ? ((await this.locationModel
            .find({ _id: { $in: node.ancestors } })
            .select('nameLo type')
            .lean()
            .exec()) as unknown as AddressableLocation[])
        : [];

    const chain = [...ancestors, node];
    const at = (type: AddressableLocation['type']): string | null => {
      const entry = chain.find((candidate) => candidate.type === type);
      return entry ? bareLocationName(entry) : null;
    };

    return { villageLo: at('village'), districtLo: at('district'), provinceLo: at('province') };
  }

  private asLocation(value: unknown): AddressableLocation | null {
    if (!value || typeof value !== 'object') return null;
    const candidate = value as Partial<AddressableLocation>;
    if (typeof candidate.nameLo !== 'string' || typeof candidate.type !== 'string') return null;
    return candidate as AddressableLocation;
  }

  /**
   * `ມ.1/ກ` and `2026-2027`, from the pupil's current placement.
   *
   * The memo names the section — it is the class register the pupil is struck
   * from — where the study letter names the level only.
   */
  private async resolvePlacement(
    studentId: string,
  ): Promise<{ classLabelLo: string | null; schoolYearCode: string | null }> {
    const enrollment = await this.enrollmentModel
      .findOne({ studentId: new Types.ObjectId(studentId), status: 'active', deletedAt: null })
      .sort({ enrolledAt: -1 })
      .select('classroomId gradeLevelId schoolYearId')
      .lean()
      .exec();

    if (!enrollment) {
      // No placement — the memo can still name the year it is written in.
      const active = await this.schoolYearModel
        .findOne({ isActive: true, deletedAt: null })
        .select('code')
        .lean()
        .exec();
      return { classLabelLo: null, schoolYearCode: active?.code ?? null };
    }

    const [classroom, gradeLevel, year] = await Promise.all([
      this.classroomModel.findById(enrollment.classroomId).select('name').lean().exec(),
      this.gradeLevelModel.findById(enrollment.gradeLevelId).select('level').lean().exec(),
      this.schoolYearModel.findById(enrollment.schoolYearId).select('code').lean().exec(),
    ]);

    const classLabelLo = gradeLevel
      ? `ມ.${gradeLevel.level}${classroom?.name ? `/${classroom.name}` : ''}`
      : null;

    return { classLabelLo, schoolYearCode: year?.code ?? null };
  }

  /** The details of the last such memo, used to fill what the register lacks. */
  private async lastIssuedDetails(studentId: string): Promise<StudySuspensionDetails | null> {
    const previous = await this.certificateModel
      .findOne({
        studentId: new Types.ObjectId(studentId),
        type: 'study_suspension',
        deletedAt: null,
      })
      .sort({ issuedDate: -1 })
      .select('suspensionDetails')
      .lean()
      .exec();

    return (previous?.suspensionDetails as StudySuspensionDetails | undefined) ?? null;
  }
}
