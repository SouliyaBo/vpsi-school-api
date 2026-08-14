import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { laoSpellingVariants, provinceLookupNames } from 'src/common/utils/lao-text';
import {
  Location,
  LocationDocument,
  SchoolYear,
  SchoolYearDocument,
  Teacher,
  TeacherDocument,
} from 'src/database/schemas';
import {
  formatTeacherCode,
  nextSerialForYear,
  resolveCodeYear,
  schoolYearShortCode,
} from 'src/modules/teachers/teacher-code';
import { locationLookupName, splitEnglishName, splitLaoName } from './student-import.mapper';
import {
  genderFromTitles,
  isPlausibleBirthDate,
  parseEmail,
  parseJoinedOrgDate,
  parseTeacherDate,
  parseTeacherPhone,
  readAmbiguousBlock,
  splitLaoTitle,
  splitTeachingSubjects,
  stripEnglishTitle,
  stripPlacePrefix,
  type SourceTeacher,
} from './teacher-import.mapper';

export interface TeacherImportOptions {
  /** Read and report, write nothing. */
  dryRun?: boolean;
  /**
   * School year the generated codes belong to — `2026-2027` yields `T-2627-…`.
   *
   * Defaults to the active year on file. Passed explicitly when the register is
   * loaded ahead of the year being created, which is the usual case: the staff
   * list arrives before the year opens.
   */
  schoolYear?: string;
}

export interface TeacherImportReport {
  teachersCreated: number;
  teachersUpdated: number;
  locationsCreated: number;
  /** Codes minted this run, in order, so the office can print them. */
  codesIssued: { code: string; name: string }[];
  skipped: { row: string; reason: string }[];
  /** Imported, but a human should look. */
  warnings: string[];
}

type LocationType = 'province' | 'district' | 'village';

/**
 * Loads the school's staff register into the database.
 *
 * Writes through the models rather than `TeachersService` for the same reason
 * the student importer does: that service pulls in storage and audit
 * infrastructure a one-shot CLI has no business booting.
 *
 * Two things make this different from the student import. There is no natural
 * key in the file — the register numbers rows `1…17` and nothing more — so
 * identity is the person's Lao name, and a re-run updates rather than
 * duplicates. And the code is ours to mint: `T-2627-001`, issued in file order,
 * reported so the office can hand each teacher their own.
 *
 * The file's own columns are, in several places, not the columns their headers
 * claim — see `readAmbiguousBlock`. What cannot be read with certainty is left
 * empty for the teacher to fill in, and named in the report.
 */
@Injectable()
export class TeacherImportService {
  private readonly logger = new Logger('TeacherImport');

  /** Locations resolved in this run, keyed by `type:parentId:foldedName`. */
  private readonly locationCache = new Map<string, Types.ObjectId>();

  constructor(
    @InjectModel(Teacher.name) private readonly teachers: Model<TeacherDocument>,
    @InjectModel(Location.name) private readonly locations: Model<LocationDocument>,
    @InjectModel(SchoolYear.name) private readonly schoolYears: Model<SchoolYearDocument>,
  ) {}

  async run(
    rows: SourceTeacher[],
    options: TeacherImportOptions = {},
  ): Promise<TeacherImportReport> {
    const report: TeacherImportReport = {
      teachersCreated: 0,
      teachersUpdated: 0,
      locationsCreated: 0,
      codesIssued: [],
      skipped: [],
      warnings: [],
    };

    this.locationCache.clear();

    // Resolved before anything is written: without a year there is no code to
    // give, and half an imported register with no codes is worse than none.
    const yearShort = await this.resolveYear(options);
    let serial = await nextSerialForYear(this.teachers, yearShort);
    this.logger.log(`Issuing codes for school year ${yearShort}, from ${serial}`);

    for (const row of rows) {
      const rowLabel = (row['ລ/ດ'] ?? '?').trim() || '?';

      const { title, name: laoName } = splitLaoTitle(row['ຊື່ ແລະນາມສະກຸນ']);
      const { firstNameLo, lastNameLo } = splitLaoName(laoName);

      if (!firstNameLo || !lastNameLo) {
        report.skipped.push({ row: rowLabel, reason: 'no usable Lao name' });
        continue;
      }

      const gender = genderFromTitles(title, row['Name and surname']);
      if (!gender) {
        report.skipped.push({
          row: rowLabel,
          reason: `no honorific to read gender from ("${row['ຊື່ ແລະນາມສະກຸນ'] ?? ''}")`,
        });
        continue;
      }

      const fields = this.buildFields(row, { title, firstNameLo, lastNameLo, gender }, report);
      fields.villageId = await this.resolveVillage(row, options, report);

      // Identity is the name: the register has no staff number of its own, and
      // matching on it is what makes a second run an update rather than a
      // seventeen-teacher duplicate.
      const existing = await this.teachers
        .findOne({ firstNameLo, lastNameLo, deletedAt: null })
        .select('_id teacherCode')
        .lean()
        .exec();

      if (existing) {
        report.teachersUpdated += 1;
        // `teacherCode` is deliberately absent from `fields` — a code already
        // issued is on a payslip and a timetable, and must not be reissued.
        if (!options.dryRun) {
          await this.teachers.updateOne({ _id: existing._id }, { $set: fields }).exec();
        }
        continue;
      }

      const teacherCode = formatTeacherCode(yearShort, serial);
      serial += 1;

      report.teachersCreated += 1;
      report.codesIssued.push({ code: teacherCode, name: `${firstNameLo} ${lastNameLo}` });

      if (options.dryRun) continue;

      await this.teachers.create({ ...fields, teacherCode, status: 'active' });
    }

    return report;
  }

  /** `2026-2027` → `2627`, from the option or the active year. */
  private async resolveYear(options: TeacherImportOptions): Promise<string> {
    if (options.schoolYear) {
      const short = schoolYearShortCode(options.schoolYear);
      if (!short) {
        throw new Error(
          `--year "${options.schoolYear}" is not a school year — write it as "2026-2027"`,
        );
      }
      return short;
    }

    const resolved = await resolveCodeYear(this.schoolYears);
    if (!resolved) {
      throw new Error(
        'no school year on file to build teacher codes from — create one, or pass --year="2026-2027"',
      );
    }
    return resolved;
  }

  // ── Row → document ────────────────────────────────────────────────────────

  private buildFields(
    row: SourceTeacher,
    identity: { title: string | null; firstNameLo: string; lastNameLo: string; gender: string },
    report: TeacherImportReport,
  ): Record<string, unknown> {
    const who = `${identity.firstNameLo} ${identity.lastNameLo}`;

    const dateOfBirth = this.readBirthDate(row, who, report);
    const phone = this.readPhone(row, who, report);
    const block = readAmbiguousBlock(row);

    if (block.unrecognized.length > 0) {
      report.warnings.push(
        `${who}: left empty — could not tell what ${block.unrecognized
          .map((cell) => `"${cell}"`)
          .join(', ')} ${block.unrecognized.length === 1 ? 'is' : 'are'} ` +
          '(the sheet has two unlabelled columns and its values slid across)',
      );
    }

    const father = this.readParent(row, 'ພໍ່', who, report);
    const mother = this.readParent(row, 'ແມ່', who, report);

    return {
      title: identity.title,
      firstNameLo: identity.firstNameLo,
      lastNameLo: identity.lastNameLo,
      ...splitEnglishName(stripEnglishTitle(row['Name and surname'])),
      gender: identity.gender,
      dateOfBirth,
      ethnicity: (row['ຊົນເຜົ່າ'] ?? '').trim() || null,
      placeOfBirth: {
        village: stripPlacePrefix(row['ບ. ເກີດ']),
        district: stripPlacePrefix(row['ມ. ເກີດ']),
        province: stripPlacePrefix(row['ຂ. ເກີດ']),
      },
      phone,
      email: parseEmail(row.mail),
      specialization: (row['ສາຂາວິຊາ'] ?? '').trim() || null,
      education: {
        institution: (row['ຈົບຈາກ'] ?? '').trim() || null,
        graduatedYear: (row['ສົກຮຽນຈົບປີໃດ'] ?? '').trim() || null,
      },
      teachingSubjects: splitTeachingSubjects(row['ສອນວິຊາ']),
      professionalLevel: (row['ລະດັບວິຊາສະເພາະ'] ?? '').trim() || null,
      joinedOrgDate: parseJoinedOrgDate(row),
      maritalStatus: block.maritalStatus,
      childrenCount: block.childrenCount,
      housingType: block.housingType,
      livingWith: block.livingWith,
      siblings: (row['ຊື່ ເອື້ອຍ/ອ້າຍ/ນ້ອງ ຄີງ(ພ້ອມບອກທີ່ຢູ່ອາໄສລະອຽດ)'] ?? '').trim() || null,
      father,
      mother,
    };
  }

  /**
   * A birth date, or nothing plus a warning.
   *
   * `dateOfBirth` is optional on a teacher — unlike a student, where it is
   * required and an unreadable one skips the row. Here the rest of the record is
   * worth importing without it.
   */
  private readBirthDate(row: SourceTeacher, who: string, report: TeacherImportReport): Date | null {
    const raw = (row['ວັນ.ເດືອນ.ປີເກີດ'] ?? '').trim();
    if (!raw) return null;

    const parsed = parseTeacherDate(raw);
    if (!parsed) {
      report.warnings.push(`${who}: birth date "${raw}" is unreadable — left empty`);
      return null;
    }

    if (!isPlausibleBirthDate(parsed)) {
      report.warnings.push(
        `${who}: birth date "${raw}" would make them under 18 or over 90 — left empty`,
      );
      return null;
    }

    return parsed;
  }

  private readPhone(row: SourceTeacher, who: string, report: TeacherImportReport): string | null {
    const raw = (row['ເບີໂທ/ເບີແອັບ'] ?? '').trim();
    if (!raw) return null;

    const phone = parseTeacherPhone(raw);
    if (!phone) {
      report.warnings.push(`${who}: phone "${raw}" is not a Lao number — left empty`);
    }
    return phone;
  }

  /**
   * A parent's three columns, kept as written.
   *
   * `ທີ່ຢູ່ປັດຈຸບັນ` sometimes says `ເສຍຊີວິດແລ້ວ` rather than a place. That is
   * true and worth keeping, but it is not an address, so it is imported and
   * flagged for the teacher to move into the right place themselves.
   */
  private readParent(
    row: SourceTeacher,
    side: 'ພໍ່' | 'ແມ່',
    who: string,
    report: TeacherImportReport,
  ): Record<string, string | null> {
    const fullNameLo = (
      (side === 'ພໍ່' ? row['ຊື່ພໍ່ ແລະ ນາມສະກຸນ'] : row['ຊື່ແມ່ ແລະ ນາມສະກຸນ']) ?? ''
    ).trim();
    const address = (
      (side === 'ພໍ່' ? row['ທີ່ຢູ່ປັດຈຸບັນ (ພໍ່)'] : row['ທີ່ຢູ່ປັດຈຸບັນ (ແມ່)']) ?? ''
    ).trim();
    const occupation = ((side === 'ພໍ່' ? row['ອາຊີບ (ພໍ່)'] : row['ອາຊີບ (ແມ່)']) ?? '').trim();

    if (address.includes('ເສຍຊີວິດ')) {
      report.warnings.push(
        `${who}: the ${side} address column says "${address}" rather than a place — ` +
          'imported as written, worth correcting in the app',
      );
    }

    return {
      fullNameLo: fullNameLo || null,
      address: address || null,
      occupation: occupation || null,
    };
  }

  // ── Locations ─────────────────────────────────────────────────────────────

  /** province → district → village for where they live now, creating what is missing. */
  private async resolveVillage(
    row: SourceTeacher,
    options: TeacherImportOptions,
    report: TeacherImportReport,
  ): Promise<Types.ObjectId | null> {
    // Stripped of their class words first: the same district arrives as
    // `ໄຊທານີ` on one row and `ມ.ໄຊທານີ` on another, and the query below
    // re-attaches the one spelling the seeded data uses.
    const province = stripPlacePrefix(row['ແຂວງຢູ່ປັດຈຸບັນ']);
    const district = stripPlacePrefix(row['ເມືອງຢູ່ປັດຈຸບັນ']);
    const village = stripPlacePrefix(row['ບ້ານຢູ່ປັດຈຸບັນ']);
    if (!province || !district || !village) return null;

    const provinceId = await this.resolveLocation(province, 'province', null, [], options, report);
    const districtId = await this.resolveLocation(
      district,
      'district',
      provinceId,
      [provinceId],
      options,
      report,
    );

    return this.resolveLocation(
      village,
      'village',
      districtId,
      [provinceId, districtId],
      options,
      report,
    );
  }

  private async resolveLocation(
    name: string,
    type: LocationType,
    parentId: Types.ObjectId | null,
    ancestors: Types.ObjectId[],
    options: TeacherImportOptions,
    report: TeacherImportReport,
  ): Promise<Types.ObjectId> {
    const folded = locationLookupName(name, type);
    const cacheKey = `${type}:${String(parentId ?? 'root')}:${folded}`;

    const cached = this.locationCache.get(cacheKey);
    if (cached) return cached;

    // The register drops the class word (`ບ້ານ`, `ມ.`) that the seeded data
    // keeps, and `ຳ` is typed both as one character and as two. Every
    // combination is offered, so the place is found however it was first
    // written — including by the student importer, which stores it unfolded.
    const prefix = { province: 'ແຂວງ', district: 'ເມືອງ', village: 'ບ້ານ' }[type];
    const bare = name.startsWith(prefix) ? name.slice(prefix.length).trim() : name;
    // A province is also matched by its spelled-out form, so `ນະຄອນຫຼວງ` and
    // `ນະຄອນຫຼວງວຽງຈັນ` resolve to the one place rather than to two.
    const spellings = type === 'province' ? provinceLookupNames(bare) : laoSpellingVariants(bare);
    const candidates = spellings.flatMap((spelling) => [spelling, `${prefix}${spelling}`]);

    const existing = await this.locations
      .findOne({ type, parentId, nameLo: { $in: candidates }, deletedAt: null })
      .select('_id')
      .exec();

    if (existing) {
      this.locationCache.set(cacheKey, existing._id);
      return existing._id;
    }

    const depth = { province: 0, district: 1, village: 2 }[type];

    if (options.dryRun) {
      report.locationsCreated += 1;
      const pretend = new Types.ObjectId();
      this.locationCache.set(cacheKey, pretend);
      return pretend;
    }

    const created = await this.locations.create({ nameLo: bare, type, parentId, ancestors, depth });

    this.locationCache.set(cacheKey, created._id);
    report.locationsCreated += 1;
    return created._id;
  }
}
