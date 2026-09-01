import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { TITLE_BY_GENDER } from 'src/common/constants/enums';
import { AppException } from 'src/common/exceptions/app.exception';
import { AddressableLocation, formatAddressLine } from 'src/common/utils/location-path';
import {
  Certificate,
  CertificateDocument,
  Enrollment,
  EnrollmentDocument,
  GradeLevel,
  GradeLevelDocument,
  Location,
  LocationDocument,
  SchoolYear,
  SchoolYearDocument,
  Student,
  StudentDocument,
  StudyVerificationDetails,
} from 'src/database/schemas';
import { StudyCertificateData } from '../reports/pdf/study-certificate.renderer';
import { SettingsService } from '../settings/settings.service';

/** The editable fields of a letter, as the office reviews them before issuing. */
export interface StudyCertificateDraft {
  birthPlaceLo: string | null;
  fatherNameLo: string | null;
  motherNameLo: string | null;
  currentAddressLo: string | null;
  studyFromYearCode: string | null;
  studyToYearCode: string | null;
  classLabelLo: string | null;
}

/** A draft plus the parts of it nobody may edit, for the review dialog. */
export interface StudyCertificatePrefill extends StudyCertificateDraft {
  studentId: string;
  studentCode: string;
  titleLo: string;
  fullNameLo: string;
  dateOfBirth: Date | null;
  /**
   * Which fields the register could not supply, so the dialog can mark them for
   * the person filling the letter in rather than presenting empty boxes that
   * look optional.
   */
  missing: (keyof StudyCertificateDraft)[];
}

const SCHOOL_DEFAULTS = {
  authorityLo: 'ພະແນກສຶກສາທິການ ແລະ ກີລາ',
  nameLo: 'ໂຮງຮຽນ',
  nameFullLo: 'ມັດທະຍົມສົມບູນ',
  provinceLo: '',
  phone: '',
  addressLo: '',
  principalTitleLo: 'ອຳນວຍການໂຮງຮຽນ',
} as const;

/**
 * Gathers what a `ໃບຢັ້ງຢືນການສຶກສາ` states and reports what is missing.
 *
 * Separate from `ReportDataService` because the two answer different questions.
 * A report card is assembled from marks; this letter is assembled from the
 * register — birthplace, parents, address, the span of years attended — none of
 * which that service reads. Most of those fields are also, in practice, absent:
 * the school holds a birthplace for one pupil in its whole roll, so telling the
 * caller *which* fields are blank is as much of the job as filling the rest.
 */
@Injectable()
export class StudyCertificateDataService {
  constructor(
    @InjectModel(Student.name) private readonly studentModel: Model<StudentDocument>,
    @InjectModel(Location.name) private readonly locationModel: Model<LocationDocument>,
    @InjectModel(Enrollment.name) private readonly enrollmentModel: Model<EnrollmentDocument>,
    @InjectModel(GradeLevel.name) private readonly gradeLevelModel: Model<GradeLevelDocument>,
    @InjectModel(SchoolYear.name) private readonly schoolYearModel: Model<SchoolYearDocument>,
    @InjectModel(Certificate.name) private readonly certificateModel: Model<CertificateDocument>,
    private readonly settings: SettingsService,
  ) {}

  /**
   * Builds the draft the office reviews.
   *
   * Falls back to the most recent letter issued for the same pupil for anything
   * the register cannot answer. That is deliberate: whoever typed the birthplace
   * the first time got it from the family, and asking again would produce either
   * a retyped copy or, worse, a second letter that contradicts the first.
   */
  async prefill(studentId: string): Promise<StudyCertificatePrefill> {
    if (!Types.ObjectId.isValid(studentId)) throw AppException.notFound();

    const student = await this.studentModel
      .findOne({ _id: studentId, deletedAt: null })
      .populate<{ villageId: LocationDocument | null }>('villageId', 'nameLo type ancestors')
      .populate<{ birthLocationId: LocationDocument | null }>(
        'birthLocationId',
        'nameLo type ancestors',
      )
      .lean()
      .exec();
    if (!student) throw AppException.notFound();

    const [addresses, years, classLabel, previous] = await Promise.all([
      this.resolveAddresses(student),
      this.resolveStudyYears(studentId),
      this.resolveClassLabel(studentId),
      this.lastIssuedDetails(studentId),
    ]);

    const draft: StudyCertificateDraft = {
      birthPlaceLo: addresses.birthPlaceLo ?? previous?.birthPlaceLo ?? null,
      fatherNameLo: this.guardianName(student, 'father') ?? previous?.fatherNameLo ?? null,
      motherNameLo: this.guardianName(student, 'mother') ?? previous?.motherNameLo ?? null,
      currentAddressLo: addresses.currentAddressLo ?? previous?.currentAddressLo ?? null,
      studyFromYearCode: years.fromYearCode ?? previous?.studyFromYearCode ?? null,
      studyToYearCode: years.toYearCode ?? previous?.studyToYearCode ?? null,
      classLabelLo: classLabel ?? previous?.classLabelLo ?? null,
    };

    return {
      ...draft,
      studentId,
      studentCode: student.studentCode,
      titleLo: TITLE_BY_GENDER[student.gender] ?? '',
      fullNameLo: `${student.firstNameLo} ${student.lastNameLo}`,
      dateOfBirth: student.dateOfBirth ?? null,
      missing: (Object.keys(draft) as (keyof StudyCertificateDraft)[]).filter(
        (key) => (draft[key] ?? '').trim().length === 0,
      ),
    };
  }

  /** Everything the renderer prints, for a letter that is being issued. */
  async assemble(options: {
    studentId: string;
    certificateNumber: string;
    issuedDate: Date;
    details: StudyVerificationDetails;
  }): Promise<StudyCertificateData> {
    const student = await this.studentModel
      .findOne({ _id: options.studentId, deletedAt: null })
      .lean()
      .exec();
    if (!student) throw AppException.notFound();

    return {
      school: await this.resolveSchool(),
      certificate: {
        numberLo: options.certificateNumber,
        issuedDate: options.issuedDate,
      },
      student: {
        titleLo: TITLE_BY_GENDER[student.gender] ?? '',
        fullNameLo: `${student.firstNameLo} ${student.lastNameLo}`,
        dateOfBirth: student.dateOfBirth ?? null,
        birthPlaceLo: options.details.birthPlaceLo ?? null,
        fatherNameLo: options.details.fatherNameLo ?? null,
        motherNameLo: options.details.motherNameLo ?? null,
        currentAddressLo: options.details.currentAddressLo ?? null,
        studentCode: options.details.studentCode ?? student.studentCode,
        classLabelLo: options.details.classLabelLo ?? null,
      },
      study: {
        fromYearCode: options.details.studyFromYearCode ?? null,
        toYearCode: options.details.studyToYearCode ?? null,
      },
    };
  }

  /** Merges a caller's overrides over the draft, so a partial body is enough. */
  async resolveDetails(
    studentId: string,
    overrides: Partial<StudyCertificateDraft>,
  ): Promise<StudyVerificationDetails> {
    const prefill = await this.prefill(studentId);
    const pick = (override: string | null | undefined, fallback: string | null): string | null => {
      if (override === undefined) return fallback;
      const trimmed = override?.trim();
      return trimmed && trimmed.length > 0 ? trimmed : null;
    };

    return {
      birthPlaceLo: pick(overrides.birthPlaceLo, prefill.birthPlaceLo),
      fatherNameLo: pick(overrides.fatherNameLo, prefill.fatherNameLo),
      motherNameLo: pick(overrides.motherNameLo, prefill.motherNameLo),
      currentAddressLo: pick(overrides.currentAddressLo, prefill.currentAddressLo),
      studyFromYearCode: pick(overrides.studyFromYearCode, prefill.studyFromYearCode),
      studyToYearCode: pick(overrides.studyToYearCode, prefill.studyToYearCode),
      classLabelLo: pick(overrides.classLabelLo, prefill.classLabelLo),
      studentCode: prefill.studentCode,
    };
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  private async resolveSchool(): Promise<StudyCertificateData['school']> {
    const [authorityLo, nameLo, nameFullLo, provinceLo, phone, addressLo, principalTitleLo] =
      await Promise.all([
        this.settings.getValue<string>('school.authorityLo'),
        this.settings.getValue<string>('school.nameLo'),
        this.settings.getValue<string>('school.nameFullLo'),
        this.settings.getValue<string>('school.provinceLo'),
        this.settings.getValue<string>('school.phone'),
        this.settings.getValue<string>('school.addressLo'),
        this.settings.getValue<string>('school.principalTitleLo'),
      ]);

    return {
      authorityLo: authorityLo ?? SCHOOL_DEFAULTS.authorityLo,
      nameLo: nameLo ?? SCHOOL_DEFAULTS.nameLo,
      nameFullLo: nameFullLo ?? SCHOOL_DEFAULTS.nameFullLo,
      provinceLo: provinceLo ?? SCHOOL_DEFAULTS.provinceLo,
      phone: phone ?? SCHOOL_DEFAULTS.phone,
      addressLo: addressLo ?? SCHOOL_DEFAULTS.addressLo,
      principalTitleLo: principalTitleLo ?? SCHOOL_DEFAULTS.principalTitleLo,
    };
  }

  /**
   * Writes the birthplace and the current address as official address lines.
   *
   * Both locations' ancestors are fetched in **one** query rather than two
   * populate chains: a village needs its district and province named, and the
   * two addresses are usually the same village, so a single `$in` over the union
   * of the ancestor ids costs one round trip either way.
   */
  private async resolveAddresses(student: {
    villageId?: unknown;
    birthLocationId?: unknown;
    addressDetail?: string | null;
    birthAddressDetail?: string | null;
  }): Promise<{ birthPlaceLo: string | null; currentAddressLo: string | null }> {
    const village = this.asLocation(student.villageId);
    const birth = this.asLocation(student.birthLocationId);

    const ancestorIds = [...(village?.ancestors ?? []), ...(birth?.ancestors ?? [])].map((id) =>
      String(id),
    );

    const ancestors =
      ancestorIds.length > 0
        ? ((await this.locationModel
            .find({ _id: { $in: [...new Set(ancestorIds)] } })
            .select('nameLo type ancestors')
            .lean()
            .exec()) as unknown as AddressableLocation[])
        : [];

    const lineage = (node: AddressableLocation | null): AddressableLocation[] =>
      node
        ? ancestors.filter((a) => node.ancestors?.some((id) => String(id) === String(a._id)))
        : [];

    const birthPlaceLo = formatAddressLine(birth, lineage(birth), student.birthAddressDetail);
    const currentAddressLo = formatAddressLine(village, lineage(village), student.addressDetail);

    return {
      birthPlaceLo: birthPlaceLo.length > 0 ? birthPlaceLo : null,
      currentAddressLo: currentAddressLo.length > 0 ? currentAddressLo : null,
    };
  }

  private asLocation(value: unknown): AddressableLocation | null {
    if (!value || typeof value !== 'object') return null;
    const candidate = value as Partial<AddressableLocation>;
    // A populate that found nothing, or an un-populated raw ObjectId, leaves no
    // name to print — and a name is the only part of a location this uses.
    if (typeof candidate.nameLo !== 'string' || typeof candidate.type !== 'string') return null;
    return candidate as AddressableLocation;
  }

  /**
   * The span of school years the letter attests to.
   *
   * Taken from the pupil's own enrollment rows, which is the only record of it.
   * For a pupil who transferred in before the system was in use that span is
   * one year long and understates the truth — hence the field being editable
   * rather than printed straight from here.
   */
  private async resolveStudyYears(
    studentId: string,
  ): Promise<{ fromYearCode: string | null; toYearCode: string | null }> {
    const enrollments = await this.enrollmentModel
      .find({ studentId: new Types.ObjectId(studentId), deletedAt: null })
      .select('schoolYearId')
      .lean()
      .exec();

    if (enrollments.length === 0) return { fromYearCode: null, toYearCode: null };

    const years = await this.schoolYearModel
      .find({ _id: { $in: enrollments.map((e) => e.schoolYearId) } })
      .select('code')
      .lean()
      .exec();

    // `2025-2026` sorts correctly as a string, so no date parsing is needed —
    // and `startDate` is not populated on every year in this database.
    const codes = years.map((year) => year.code).sort();
    return {
      fromYearCode: codes[0] ?? null,
      toYearCode: codes[codes.length - 1] ?? null,
    };
  }

  /** `ມ.4`, from the level of the pupil's current placement. */
  private async resolveClassLabel(studentId: string): Promise<string | null> {
    const enrollment = await this.enrollmentModel
      .findOne({ studentId: new Types.ObjectId(studentId), status: 'active', deletedAt: null })
      .sort({ enrolledAt: -1 })
      .select('gradeLevelId')
      .lean()
      .exec();
    if (!enrollment) return null;

    const gradeLevel = await this.gradeLevelModel
      .findById(enrollment.gradeLevelId)
      .select('level')
      .lean()
      .exec();

    // The letter names the level only — `ມ.4`, not `ມ.4/ກ`. Which section a pupil
    // sat in is the school's business, not the reader's.
    return gradeLevel ? `ມ.${gradeLevel.level}` : null;
  }

  /**
   * `ທ້າວ ສະຫງ່ວນ ປອງປັນຍາ` — the parent's name with the title the letter uses.
   *
   * The title comes from the relationship rather than from a stored gender: the
   * guardian link records `father`/`mother`, and the denormalized name is the
   * bare register name with the honorific stripped by the importer.
   */
  private guardianName(
    student: { guardians?: { relationship: string; fullNameLo: string }[] },
    relationship: 'father' | 'mother',
  ): string | null {
    const link = student.guardians?.find((entry) => entry.relationship === relationship);
    const name = link?.fullNameLo?.trim();
    if (!name) return null;

    const title = relationship === 'father' ? 'ທ້າວ' : 'ນາງ';
    // A name that already carries a title is left alone — some rows were typed
    // by hand rather than imported.
    return /^(ທ້າວ|ນາງ|ທ\.|ນ\.)\s/.test(name) ? name : `${title} ${name}`;
  }

  /** The details of the last such letter, used to fill what the register lacks. */
  private async lastIssuedDetails(studentId: string): Promise<StudyVerificationDetails | null> {
    const previous = await this.certificateModel
      .findOne({
        studentId: new Types.ObjectId(studentId),
        type: 'study_verification',
        deletedAt: null,
      })
      .sort({ issuedDate: -1 })
      .select('studyDetails')
      .lean()
      .exec();

    return (previous?.studyDetails as StudyVerificationDetails | undefined) ?? null;
  }
}
