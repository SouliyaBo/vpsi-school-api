import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  laoSpellingVariants,
  provinceLookupNames,
  stripInvisible,
} from 'src/common/utils/lao-text';
import { LAO_PHONE_PATTERN, normalizeLaoPhone } from 'src/common/utils/phone';
import {
  Classroom,
  ClassroomDocument,
  ConductScore,
  ConductScoreDocument,
  Enrollment,
  EnrollmentDocument,
  Guardian,
  GuardianDocument,
  Location,
  LocationDocument,
  SchoolYear,
  SchoolYearDocument,
  Semester,
  SemesterDocument,
  Student,
  StudentDocument,
  StudentGuardianLink,
  User,
  UserDocument,
} from 'src/database/schemas';
import { conductGradeFor } from 'src/modules/term-results/grading';
import {
  guardianKey,
  locationLookupName,
  parseGender,
  parseSourceDate,
  splitContact,
  splitEnglishName,
  splitLaoName,
  splitTitle,
  type SourceParent,
  type SourceStudent,
} from './student-import.mapper';

export interface ImportOptions {
  /** Read and report, write nothing. */
  dryRun?: boolean;
  /**
   * Classroom to place every row in, by name — `ມ.2/ກ`.
   *
   * The register is kept one class per file, and the class it belongs to is
   * written on the folder rather than in the rows, so it is passed in.
   */
  classroom?: string;
}

export interface ImportReport {
  studentsCreated: number;
  studentsUpdated: number;
  guardiansCreated: number;
  guardiansReused: number;
  locationsCreated: number;
  enrollmentsCreated: number;
  enrollmentsReused: number;
  conductScoresWritten: number;
  skipped: { studentId: string; reason: string }[];
  /** Things that imported but are worth a human look. */
  warnings: string[];
}

type LocationType = 'province' | 'district' | 'village';

/** Where the run puts its students, resolved once before the rows are read. */
interface Placement {
  classroom: ClassroomDocument;
  /** The open semester of the classroom's year — conduct marks need one. */
  semester: SemesterDocument | null;
  /** Author of record for the conduct marks. */
  recordedBy: Types.ObjectId | null;
  /** Next free roll number, advanced as the run enrolls. */
  nextRollNumber: number;
  /** Seats left, so a class is never overfilled. */
  seatsLeft: number;
}

/**
 * Loads the school's existing student register into the database.
 *
 * Writes through the models rather than `StudentsService`, because that service
 * pulls in storage, audit and transaction infrastructure that a one-shot CLI has
 * no business booting — the same trade the seed CLI makes. The one thing it must
 * copy exactly is the shape of `students.guardians[]`, whose denormalized name
 * and phone the rest of the app reads.
 *
 * Re-running is safe: a student is keyed by `student_id`, so a second pass
 * updates rather than duplicates. That matters more than it sounds — the first
 * import of a real register is never the last.
 */
@Injectable()
export class StudentImportService {
  private readonly logger = new Logger('StudentImport');

  /** Guardians already resolved in this run, keyed by `guardianKey`. */
  private readonly guardianCache = new Map<string, Types.ObjectId>();
  /** Locations resolved in this run, keyed by `type:parentId:foldedName`. */
  private readonly locationCache = new Map<string, Types.ObjectId>();

  constructor(
    @InjectModel(Student.name) private readonly students: Model<StudentDocument>,
    @InjectModel(Guardian.name) private readonly guardians: Model<GuardianDocument>,
    @InjectModel(Location.name) private readonly locations: Model<LocationDocument>,
    @InjectModel(Classroom.name) private readonly classrooms: Model<ClassroomDocument>,
    @InjectModel(Enrollment.name) private readonly enrollments: Model<EnrollmentDocument>,
    @InjectModel(SchoolYear.name) private readonly schoolYears: Model<SchoolYearDocument>,
    @InjectModel(Semester.name) private readonly semesters: Model<SemesterDocument>,
    @InjectModel(ConductScore.name) private readonly conductScores: Model<ConductScoreDocument>,
    @InjectModel(User.name) private readonly users: Model<UserDocument>,
  ) {}

  async run(rows: SourceStudent[], options: ImportOptions = {}): Promise<ImportReport> {
    const report: ImportReport = {
      studentsCreated: 0,
      studentsUpdated: 0,
      guardiansCreated: 0,
      guardiansReused: 0,
      locationsCreated: 0,
      enrollmentsCreated: 0,
      enrollmentsReused: 0,
      conductScoresWritten: 0,
      skipped: [],
      warnings: [],
    };

    this.guardianCache.clear();
    this.locationCache.clear();

    // Resolved before anything is written: a mistyped class name should stop the
    // run, not leave half a register imported with nowhere to sit.
    const placement = options.classroom
      ? await this.resolvePlacement(options.classroom, report)
      : null;

    for (const row of rows) {
      const studentCode = (row.student_id ?? '').trim();
      if (!studentCode) {
        report.skipped.push({ studentId: String(row.id ?? '?'), reason: 'no student_id' });
        continue;
      }

      const dateOfBirth = parseSourceDate(row.dob);
      if (!dateOfBirth) {
        report.skipped.push({
          studentId: studentCode,
          reason: `unreadable dob "${row.dob ?? ''}"`,
        });
        continue;
      }

      const { title, name: givenName } = splitTitle(row.first_name);
      const lastNameLo = (row.last_name ?? '').trim();
      if (!givenName || !lastNameLo) {
        report.skipped.push({ studentId: studentCode, reason: 'missing Lao name' });
        continue;
      }

      const villageId = await this.resolveVillage(row, options, report);
      const links = await this.resolveGuardians(row, lastNameLo, options, report);

      if (links.length === 0) {
        report.warnings.push(`${studentCode}: no parent on file — imported with no guardian`);
      }

      const contact = splitContact(row.contact_phone);

      // A conduct mark is keyed by semester and classroom, so it can only be
      // imported alongside a placement that supplies both.
      if (row.demerits && !placement?.semester) {
        report.warnings.push(
          `${studentCode}: conduct mark (${row.demerits.score ?? '?'}) not imported — ` +
            (placement
              ? `${placement.classroom.name} has no open semester to record it against`
              : 'no --classroom was given, so it has no semester or classroom'),
        );
      }

      if (row.english_class) {
        // Stated once per row would drown the report; the summary says it too.
        this.logger.debug(`${studentCode}: english_class "${row.english_class}" not imported`);
      }

      const fields = {
        studentCode,
        title: title ?? null,
        firstNameLo: givenName,
        lastNameLo,
        ...splitEnglishName(row.english_name),
        nickname: row.nickname?.trim() || null,
        nicknameEn: row.english_nickname?.trim() || null,
        gender: parseGender(row.gender),
        dateOfBirth,
        ethnicity: row.ethnicity?.trim() || null,
        phone: null,
        contactPhone: contact.contactPhone ?? null,
        contactName: contact.contactName ?? null,
        villageId,
        notes: row.notes?.trim() || null,
        guardians: links,
      };

      const existing = await this.students
        .findOne({ studentCode, deletedAt: null })
        .select('_id')
        .exec();

      let studentId: Types.ObjectId;

      if (options.dryRun) {
        studentId = existing?._id ?? new Types.ObjectId();
        if (existing) report.studentsUpdated += 1;
        else report.studentsCreated += 1;
      } else if (existing) {
        await this.students.updateOne({ _id: existing._id }, { $set: fields }).exec();
        studentId = existing._id;
        report.studentsUpdated += 1;
      } else {
        const created = await this.students.create({ ...fields, status: 'active' });
        studentId = created._id;
        report.studentsCreated += 1;
      }

      if (!placement) continue;

      const enrolled = await this.enroll(
        { studentId, studentCode, nameLo: `${givenName} ${lastNameLo}` },
        placement,
        options,
        report,
      );

      if (enrolled && row.demerits && placement.semester) {
        await this.recordConduct(studentId, studentCode, row, placement, options, report);
      }
    }

    return report;
  }

  // ── Placement ─────────────────────────────────────────────────────────────

  /**
   * Finds the classroom the run enrolls into, plus what a conduct mark needs.
   *
   * Throws rather than warns: every row of the file belongs in this class, so a
   * name that resolves to nothing — or to two classes in different years — is a
   * mistake to fix before any of it is written.
   */
  private async resolvePlacement(name: string, report: ImportReport): Promise<Placement> {
    const wanted = name.trim();
    const matches = await this.classrooms.find({ name: wanted, deletedAt: null }).exec();

    if (matches.length === 0) {
      const known = await this.classrooms.find({ deletedAt: null }).select('name').lean().exec();
      throw new Error(
        `no classroom named "${wanted}". Known classrooms: ${known.map((c) => c.name).join(', ')}`,
      );
    }

    // The same section name recurs every year, so the active year decides it.
    const years = await this.schoolYears
      .find({ _id: { $in: matches.map((c) => c.schoolYearId) } })
      .select('code isActive')
      .lean()
      .exec();
    const yearsById = new Map(years.map((year) => [String(year._id), year]));

    const active = matches.filter((c) => yearsById.get(String(c.schoolYearId))?.isActive === true);
    const candidates = active.length > 0 ? active : matches;

    if (candidates.length > 1) {
      const codes = candidates
        .map((c) => yearsById.get(String(c.schoolYearId))?.code ?? '?')
        .join(', ');
      throw new Error(
        `"${wanted}" exists in more than one school year (${codes}) and none is active — ` +
          'mark the current year active before importing',
      );
    }

    const classroom = candidates[0];
    const year = yearsById.get(String(classroom.schoolYearId));
    this.logger.log(`Placing into "${classroom.name}" of school year ${year?.code ?? '?'}`);

    const semester = await this.semesters
      .findOne({ schoolYearId: classroom.schoolYearId, status: 'active', deletedAt: null })
      .exec();

    const recorder = await this.users
      .findOne({ username: 'admin' })
      .select('_id')
      .lean()
      .exec()
      .then((user) => user ?? this.users.findOne({}).select('_id').lean().exec());

    if (!recorder) {
      report.warnings.push('no user on file to attribute conduct marks to — they will be skipped');
    }

    // Roll numbers come from the roster rather than `currentCount`: the count is
    // a cache, and a class whose cache has drifted must not hand out a number
    // that is already taken.
    const roster = await this.enrollments
      .find({ classroomId: classroom._id, status: 'active', deletedAt: null })
      .select('rollNumber')
      .lean()
      .exec();

    const highest = roster.reduce((max, row) => Math.max(max, row.rollNumber ?? 0), 0);

    return {
      classroom,
      semester,
      recordedBy: recorder?._id ?? null,
      nextRollNumber: highest + 1,
      seatsLeft: classroom.capacity - roster.length,
    };
  }

  /**
   * Places one student in the run's classroom for that classroom's school year.
   *
   * A student already active elsewhere that year is left where they are and
   * reported: moving them is a transfer, which carries a reason and a trail this
   * importer has no business inventing.
   *
   * Returns whether the student ends the run in this classroom — a conduct mark
   * may only be written for one who does.
   */
  private async enroll(
    student: { studentId: Types.ObjectId; studentCode: string; nameLo: string },
    placement: Placement,
    options: ImportOptions,
    report: ImportReport,
  ): Promise<boolean> {
    const { classroom } = placement;

    const existing = await this.enrollments
      .findOne({
        studentId: student.studentId,
        schoolYearId: classroom.schoolYearId,
        status: 'active',
        deletedAt: null,
      })
      .select('classroomId')
      .lean()
      .exec();

    if (existing) {
      if (String(existing.classroomId) === String(classroom._id)) {
        report.enrollmentsReused += 1;
        return true;
      }

      report.warnings.push(
        `${student.studentCode}: already enrolled in another class this year — ` +
          `left there rather than moved into ${classroom.name}; transfer them in the app if that is wrong`,
      );
      return false;
    }

    if (placement.seatsLeft <= 0) {
      report.warnings.push(
        `${student.studentCode}: ${classroom.name} is full (capacity ${classroom.capacity}) — not enrolled`,
      );
      return false;
    }

    const rollNumber = placement.nextRollNumber;
    placement.nextRollNumber += 1;
    placement.seatsLeft -= 1;
    report.enrollmentsCreated += 1;

    if (options.dryRun) return true;

    await this.enrollments.create({
      studentId: student.studentId,
      studentCode: student.studentCode,
      studentNameLo: student.nameLo,
      classroomId: classroom._id,
      schoolYearId: classroom.schoolYearId,
      gradeLevelId: classroom.gradeLevelId,
      enrolledAt: new Date(),
      status: 'active',
      rollNumber,
    });

    // Kept in step with the roster the same way EnrollmentsService does, so the
    // app's capacity checks stay meaningful after an import.
    await this.classrooms.updateOne({ _id: classroom._id }, { $inc: { currentCount: 1 } }).exec();

    return true;
  }

  /**
   * Writes the register's conduct mark as the semester conduct score.
   *
   * The register records a running total and the deduction that produced it; the
   * total is the score, and the deduction and its reason become the remark, so
   * *why* a child is not on 100 survives the import.
   *
   * The letter grade is derived from the score rather than carried over — the
   * same rule the app applies, so an imported mark and an entered one agree.
   */
  private async recordConduct(
    studentId: Types.ObjectId,
    studentCode: string,
    row: SourceStudent,
    placement: Placement,
    options: ImportOptions,
    report: ImportReport,
  ): Promise<void> {
    const semester = placement.semester!;
    const score = row.demerits?.score;

    if (typeof score !== 'number' || score < 0 || score > 100) {
      report.warnings.push(`${studentCode}: conduct score "${score ?? ''}" is not 0–100 — skipped`);
      return;
    }

    if (!placement.recordedBy) return; // already warned once, when resolving the placement

    const deducted = row.demerits?.deducted;
    const reason = row.demerits?.reason?.trim();
    const remark = [deducted ? `-${deducted}` : null, reason || null].filter(Boolean).join(': ');

    report.conductScoresWritten += 1;
    if (options.dryRun) return;

    await this.conductScores
      .updateOne(
        {
          studentId,
          semesterId: semester._id,
          periodType: 'semester',
          periodValue: semester.number,
          deletedAt: null,
        },
        {
          $set: {
            studentId,
            semesterId: semester._id,
            schoolYearId: placement.classroom.schoolYearId,
            classroomId: placement.classroom._id,
            periodType: 'semester',
            periodValue: semester.number,
            score,
            grade: conductGradeFor(score),
            remark: remark || null,
            recordedBy: placement.recordedBy,
          },
        },
        { upsert: true },
      )
      .exec();
  }

  // ── Guardians ─────────────────────────────────────────────────────────────

  /**
   * Turns the row's father and mother into guardian links, reusing a parent
   * already on file rather than making a second copy of them.
   *
   * Deduplication is the whole point: two children of one father are only
   * visible as siblings because both point at the same guardian document.
   */
  private async resolveGuardians(
    row: SourceStudent,
    childLastName: string,
    options: ImportOptions,
    report: ImportReport,
  ): Promise<StudentGuardianLink[]> {
    // Split rather than normalized whole: an annotated number like
    // `9112 1155 (ເອື້ອຍລ້ຽງ)` would otherwise match no parent at all.
    const contact = splitContact(row.contact_phone).contactPhone ?? '';
    const parents: {
      parent: SourceParent | null | undefined;
      relationship: 'father' | 'mother';
    }[] = [
      { parent: row.father, relationship: 'father' },
      { parent: row.mother, relationship: 'mother' },
    ];

    const links: StudentGuardianLink[] = [];

    for (const { parent, relationship } of parents) {
      const name = parent?.name?.trim();
      const phone = normalizeLaoPhone(parent?.phone ?? '') as string;
      if (!name) continue;

      // A guardian is identified by their number, so an unusable one is not a
      // detail to tidy up later: it becomes half of the key that decides whether
      // two children are siblings. Better to leave the parent off and say so.
      if (!phone) {
        report.warnings.push(
          `${childLastName}: ${relationship} "${name}" has no phone — not linked`,
        );
        continue;
      }
      if (!LAO_PHONE_PATTERN.test(phone)) {
        report.warnings.push(
          `${relationship} "${name}" has "${parent?.phone ?? ''}", which is not a Lao number — ` +
            'not linked, since a guardian is identified by their number',
        );
        continue;
      }

      const { firstNameLo, lastNameLo } = splitLaoName(name, childLastName);
      const alternatePhone = normalizeLaoPhone(parent?.alternate_phone ?? '') as string;
      const guardianId = await this.resolveGuardian(
        {
          firstNameLo,
          lastNameLo,
          phone,
          alternatePhone: alternatePhone || null,
          occupation: parent?.occupation?.trim() || null,
        },
        options,
        report,
      );

      links.push({
        guardianId,
        fullNameLo: `${firstNameLo} ${lastNameLo}`,
        phone,
        relationship,
        // Filled in below, once it is known whether any parent owns the contact
        // number — a row where neither does still needs exactly one primary.
        isPrimary: false,
        isEmergencyContact: true,
        canViewRecords: true,
      });
    }

    if (links.length === 0) return links;

    // Who the school rings, in the order the register can be trusted on it: the
    // column that says so outright, then the parent whose number is the contact
    // number, and only then the first parent on the row.
    const stated = row.preferred_contact
      ? links.find((link) => link.relationship === row.preferred_contact)
      : undefined;
    const primary = stated ?? links.find((link) => link.phone === contact) ?? links[0];
    primary.isPrimary = true;

    return links;
  }

  private async resolveGuardian(
    input: {
      firstNameLo: string;
      lastNameLo: string;
      phone: string;
      alternatePhone: string | null;
      occupation: string | null;
    },
    options: ImportOptions,
    report: ImportReport,
  ): Promise<Types.ObjectId> {
    const key = guardianKey(`${input.firstNameLo} ${input.lastNameLo}`, input.phone);

    const cached = this.guardianCache.get(key);
    if (cached) {
      report.guardiansReused += 1;
      return cached;
    }

    const existing = await this.guardians
      .findOne({
        firstNameLo: input.firstNameLo,
        lastNameLo: input.lastNameLo,
        phone: input.phone,
        deletedAt: null,
      })
      .select('_id alternatePhone')
      .exec();

    if (existing) {
      this.guardianCache.set(key, existing._id);
      report.guardiansReused += 1;

      // A later sheet often carries a number the first one did not. Filling an
      // empty second slot is the one thing a re-import may safely add to a
      // guardian already on file — it answers a question the record left blank,
      // rather than overruling an answer someone gave.
      if (input.alternatePhone && !options.dryRun) {
        const filled = await this.guardians
          .updateOne(
            {
              _id: existing._id,
              $or: [{ alternatePhone: null }, { alternatePhone: { $exists: false } }],
            },
            { $set: { alternatePhone: input.alternatePhone } },
          )
          .exec();
        if (filled.modifiedCount > 0) {
          report.warnings.push(
            `${input.firstNameLo} ${input.lastNameLo}: second number ${input.alternatePhone} ` +
              'added from this sheet',
          );
        }
      }

      return existing._id;
    }

    // A number already on file under another name is either a shared handset or
    // the same parent spelled differently. Only a human can tell which, so it is
    // reported and the row proceeds as a separate guardian.
    const sharesPhone = await this.guardians
      .findOne({ phone: input.phone, deletedAt: null })
      .select('firstNameLo lastNameLo')
      .lean()
      .exec();

    if (sharesPhone) {
      report.warnings.push(
        `phone ${input.phone} is on file as "${sharesPhone.firstNameLo} ${sharesPhone.lastNameLo}" ` +
          `and now also as "${input.firstNameLo} ${input.lastNameLo}" — check they are not the same person`,
      );
    }

    // The mirror case, and the more damaging one: the same parent written with a
    // different number, usually a digit out. It creates a second guardian, and
    // the children on either side of the split stop being siblings — which is
    // invisible until someone wonders why a family only has one child on file.
    const sharesName = await this.guardians
      .findOne({ firstNameLo: input.firstNameLo, lastNameLo: input.lastNameLo, deletedAt: null })
      .select('phone')
      .lean()
      .exec();

    if (sharesName) {
      report.warnings.push(
        `"${input.firstNameLo} ${input.lastNameLo}" is on file on ${sharesName.phone} and now ` +
          `also on ${input.phone} — imported as two guardians, so their children will not ` +
          'read as siblings until one number is corrected',
      );
    }

    if (options.dryRun) {
      report.guardiansCreated += 1;
      const pretend = new Types.ObjectId();
      this.guardianCache.set(key, pretend);
      return pretend;
    }

    const created = await this.guardians.create({
      firstNameLo: input.firstNameLo,
      lastNameLo: input.lastNameLo,
      phone: input.phone,
      alternatePhone: input.alternatePhone,
      occupation: input.occupation,
    });

    this.guardianCache.set(key, created._id);
    report.guardiansCreated += 1;
    return created._id;
  }

  // ── Locations ─────────────────────────────────────────────────────────────

  /** province → district → village, creating whichever levels are not on file. */
  private async resolveVillage(
    row: SourceStudent,
    options: ImportOptions,
    report: ImportReport,
  ): Promise<Types.ObjectId | null> {
    const { province, district, village } = row.address ?? {};
    if (!province?.trim() || !district?.trim() || !village?.trim()) return null;

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
    options: ImportOptions,
    report: ImportReport,
  ): Promise<Types.ObjectId> {
    // Zero-width characters ride along when a cell is pasted between
    // applications; they match nothing and must not reach the tree.
    const cleaned = stripInvisible(name).trim();
    const folded = locationLookupName(cleaned, type);
    const cacheKey = `${type}:${String(parentId ?? 'root')}:${folded}`;

    const cached = this.locationCache.get(cacheKey);
    if (cached) return cached;

    // Two spellings vary independently and neither is wrong: the register drops
    // the class word (`ບ້ານ`) that the seeded data keeps, and `ຳ` is typed both
    // as one character and as two. Every combination is offered to the query, so
    // the place is found however it was first written down.
    const prefix = { province: 'ແຂວງ', district: 'ເມືອງ', village: 'ບ້ານ' }[type];
    const bare = cleaned.startsWith(prefix) ? cleaned.slice(prefix.length) : cleaned;
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

    // Stored as the school writes it, only without the invisible characters.
    const created = await this.locations.create({
      nameLo: cleaned,
      type,
      parentId,
      ancestors,
      depth,
    });

    this.locationCache.set(cacheKey, created._id);
    report.locationsCreated += 1;
    return created._id;
  }
}
