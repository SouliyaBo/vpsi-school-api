import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { AuthService } from 'src/modules/auth/auth.service';
import {
  CalendarEvent,
  CalendarEventDocument,
  Classroom,
  ClassroomDocument,
  ConductRule,
  ConductRuleDocument,
  GradeLevel,
  GradeLevelDocument,
  ReportTemplate,
  ReportTemplateDocument,
  Location,
  LocationDocument,
  Role,
  RoleDocument,
  SchoolYear,
  SchoolYearDocument,
  Semester,
  SemesterDocument,
  Setting,
  SettingDocument,
  Subject,
  SubjectDocument,
  SubjectGroup,
  SubjectGroupDocument,
  Teacher,
  TeacherDocument,
  User,
  UserDocument,
} from 'src/database/schemas';
import { DEFAULT_LESSON_PLAN_POLICY } from 'src/modules/lesson-plans/lesson-plan-weeks';
import {
  DEFAULT_CERTIFICATE_LAYOUT,
  DEFAULT_REPORT_CARD_LAYOUT,
} from 'src/modules/reports/pdf/layout.types';
import { DEFAULT_SEMESTER_MONTHS } from 'src/modules/monthly-marks/monthly-grading';
import { DEFAULT_GRADE_SCALE, DEFAULT_PASSING_PERCENTAGE } from 'src/modules/term-results/grading';
import { flattenOfficialLocations } from 'src/database/locations/location-matching';
import { CONDUCT_RULE_SEEDS } from './conduct-rules';
import { ROLE_SEEDS } from './role-permissions';

const GRADE_LEVEL_SEEDS = [
  { code: 'm1', nameLo: 'ມັດທະຍົມສຶກສາປີທີ 1', nameEn: 'Grade 7', level: 1, isExitLevel: false },
  { code: 'm2', nameLo: 'ມັດທະຍົມສຶກສາປີທີ 2', nameEn: 'Grade 8', level: 2, isExitLevel: false },
  { code: 'm3', nameLo: 'ມັດທະຍົມສຶກສາປີທີ 3', nameEn: 'Grade 9', level: 3, isExitLevel: false },
  { code: 'm4', nameLo: 'ມັດທະຍົມສຶກສາປີທີ 4', nameEn: 'Grade 10', level: 4, isExitLevel: true },
  { code: 'm5', nameLo: 'ມັດທະຍົມສຶກສາປີທີ 5', nameEn: 'Grade 11', level: 5, isExitLevel: false },
  { code: 'm6', nameLo: 'ມັດທະຍົມສຶກສາປີທີ 6', nameEn: 'Grade 12', level: 6, isExitLevel: false },
  { code: 'm7', nameLo: 'ມັດທະຍົມສຶກສາປີທີ 7', nameEn: 'Grade 13', level: 7, isExitLevel: true },
];

/** The departments (`ສາຍວິຊາ`) subjects and teachers are filed under. */
const SUBJECT_GROUP_SEEDS = [
  { code: 'math', nameLo: 'ສາຍຄະນິດສາດ', nameEn: 'Mathematics', sortOrder: 1 },
  { code: 'languages', nameLo: 'ສາຍພາສາ', nameEn: 'Languages', sortOrder: 2 },
  { code: 'science', nameLo: 'ສາຍວິທະຍາສາດ', nameEn: 'Science', sortOrder: 3 },
  { code: 'social', nameLo: 'ສາຍສັງຄົມ', nameEn: 'Social Studies', sortOrder: 4 },
];

/**
 * Core curriculum, replicated per grade level.
 *
 * `group` is what makes maths one department rather than seven subjects: the
 * subject row is per grade level, the group is not.
 */
const SUBJECT_TEMPLATES = [
  {
    code: 'MATH',
    nameLo: 'ຄະນິດສາດ',
    nameEn: 'Mathematics',
    credits: 4,
    hoursPerWeek: 5,
    group: 'math',
  },
  {
    code: 'LAO',
    nameLo: 'ພາສາລາວ',
    nameEn: 'Lao Language',
    credits: 4,
    hoursPerWeek: 5,
    group: 'languages',
  },
  {
    code: 'ENG',
    nameLo: 'ພາສາອັງກິດ',
    nameEn: 'English',
    credits: 3,
    hoursPerWeek: 4,
    group: 'languages',
  },
  {
    code: 'PHYS',
    nameLo: 'ຟີຊິກສາດ',
    nameEn: 'Physics',
    credits: 3,
    hoursPerWeek: 3,
    group: 'science',
  },
  {
    code: 'CHEM',
    nameLo: 'ເຄມີສາດ',
    nameEn: 'Chemistry',
    credits: 3,
    hoursPerWeek: 3,
    group: 'science',
  },
  {
    code: 'BIO',
    nameLo: 'ຊີວະສາດ',
    nameEn: 'Biology',
    credits: 3,
    hoursPerWeek: 3,
    group: 'science',
  },
  {
    code: 'HIST',
    nameLo: 'ປະຫວັດສາດ',
    nameEn: 'History',
    credits: 2,
    hoursPerWeek: 2,
    group: 'social',
  },
  {
    code: 'GEO',
    nameLo: 'ພູມສາດ',
    nameEn: 'Geography',
    credits: 2,
    hoursPerWeek: 2,
    group: 'social',
  },
];

/** The year the demo semesters, classrooms and calendar hang off. */
const FIXTURE_YEAR_CODE = '2025-2026';

/**
 * Idempotent seeder.
 *
 * Every step upserts on a natural key, so running it repeatedly converges to the
 * same state rather than duplicating rows. That makes it safe to run on an
 * existing database to pick up newly added settings or roles.
 */
@Injectable()
export class SeedService {
  private readonly logger = new Logger(SeedService.name);

  constructor(
    @InjectModel(Role.name) private readonly roleModel: Model<RoleDocument>,
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    @InjectModel(Location.name) private readonly locationModel: Model<LocationDocument>,
    @InjectModel(SchoolYear.name) private readonly schoolYearModel: Model<SchoolYearDocument>,
    @InjectModel(Semester.name) private readonly semesterModel: Model<SemesterDocument>,
    @InjectModel(GradeLevel.name) private readonly gradeLevelModel: Model<GradeLevelDocument>,
    @InjectModel(SubjectGroup.name)
    private readonly subjectGroupModel: Model<SubjectGroupDocument>,
    @InjectModel(Subject.name) private readonly subjectModel: Model<SubjectDocument>,
    @InjectModel(Classroom.name) private readonly classroomModel: Model<ClassroomDocument>,
    @InjectModel(Teacher.name) private readonly teacherModel: Model<TeacherDocument>,
    @InjectModel(Setting.name) private readonly settingModel: Model<SettingDocument>,
    @InjectModel(ReportTemplate.name)
    private readonly reportTemplateModel: Model<ReportTemplateDocument>,
    @InjectModel(CalendarEvent.name)
    private readonly calendarEventModel: Model<CalendarEventDocument>,
    @InjectModel(ConductRule.name)
    private readonly conductRuleModel: Model<ConductRuleDocument>,
  ) {}

  async run(): Promise<void> {
    this.logger.log('Seeding…');

    await this.seedSettings();
    const roles = await this.seedRoles();
    await this.seedAdminUser(roles.get('admin')!);
    await this.seedLocations();
    const gradeLevels = await this.seedGradeLevels();
    const subjectGroups = await this.seedSubjectGroups();
    await this.seedSubjects(gradeLevels, subjectGroups);
    const schoolYear = await this.seedSchoolYear();
    await this.seedSemesters(schoolYear);
    const teachers = await this.seedTeachers(subjectGroups);
    // After the teachers exist, so each group can point at its head.
    await this.assignGroupHeads(subjectGroups, teachers);
    await this.seedClassrooms(schoolYear, gradeLevels, teachers);
    await this.seedReportTemplates();
    await this.seedCalendarEvents(schoolYear);
    await this.seedConductRules();

    this.logger.log('Seed complete.');
  }

  /**
   * Re-applies the permission matrix, and nothing else.
   *
   * `run()` is only safe on a fresh database: it also upserts settings, the
   * subject catalogue, demo teachers, classrooms and locations, so on a school's
   * live data it would reset the school name and the timetable window, and add
   * fixtures nobody asked for.
   *
   * A newly added resource still has to reach the roles that need it, and the
   * permissions of a system role deliberately cannot be changed through the API
   * — see RolesService.update. So this is the supported way in, and the only step
   * that should ever be run against a database in use.
   *
   * Roles are matched by code, so a school's own custom roles are untouched; they
   * need the new resource granted through the roles API.
   */
  /**
   * Re-applies only the settings catalogue.
   *
   * Exists because the alternative is what actually happened: someone needed one
   * new school setting, ran the full seed against a live database, and silently
   * reverted a subject's name, a subject group's name and its head teacher, and
   * un-deleted four subject groups the office had removed — none of which the
   * seed audits, so the damage had to be reconstructed from the audit trail of
   * the edits it overwrote.
   *
   * Settings are matched by key, so a value the office has since changed through
   * the API **is** reset to the seeded default. That is a much smaller blast
   * radius than `run()`, but it is not nothing: check `seedSettings` before
   * running this on a database in use.
   */
  async syncSettings(): Promise<void> {
    this.logger.log('Applying the settings catalogue…');
    await this.seedSettings();
    this.logger.log('Settings up to date.');
  }

  async syncRoles(): Promise<void> {
    this.logger.log('Applying the permission matrix…');
    await this.seedRoles();
    this.logger.log('Roles up to date.');
  }

  private async seedSettings(): Promise<void> {
    const settings = [
      {
        key: 'school.nameLo',
        value: 'ໂຮງຮຽນ ມ.ສ ນານາຊາດ ວຽງຈັນພັດທະນາ',
        category: 'school',
        isPublic: true,
        description: 'School name shown on reports, letterheads and the login screen',
      },
      {
        key: 'school.nameEn',
        value: 'Vientiane Pattana School International',
        category: 'school',
        isPublic: true,
        description: 'School name in English',
      },
      {
        key: 'school.nameFullLo',
        // Deliberately without the word ໂຮງຮຽນ: the sentences of an official
        // letter supply it themselves — ອຳນວຍການໂຮງຮຽນ …, ຮຽນທີ່ ໂຮງຮຽນ … — and a
        // stored name that repeats it prints the word twice.
        value: 'ມັດທະຍົມສົມບູນ ນານາຊາດ ວຽງຈັນພັດທະນາ',
        category: 'school',
        isPublic: false,
        description: 'Spelled-out school name used inside letter sentences, without ໂຮງຮຽນ',
      },
      {
        key: 'school.authorityLo',
        value: 'ພະແນກສຶກສາທິການ ແລະ ກີລາ',
        category: 'school',
        isPublic: false,
        description: 'The department named above the school on a letterhead',
      },
      {
        key: 'school.provinceLo',
        value: 'ນະຄອນຫຼວງວຽງຈັນ',
        category: 'school',
        isPublic: false,
        description: 'Province printed on the letterhead',
      },
      {
        key: 'school.phone',
        value: '020 59163105',
        category: 'school',
        isPublic: true,
        description: 'Office telephone number printed on letterheads',
      },
      {
        key: 'school.addressLo',
        value: 'ບ້ານ ຂຸນຕາທົ່ງ, ເມືອງ ສີໂຄດຕະບອງ ນະຄອນຫຼວງວຽງຈັນ',
        category: 'school',
        isPublic: true,
        description: 'Where the school stands, as a letter states it',
      },
      {
        key: 'school.principalTitleLo',
        value: 'ອຳນວຍການໂຮງຮຽນ',
        category: 'school',
        isPublic: false,
        description: 'Signature line under a letter',
      },
      {
        key: 'school.documentCodeLo',
        // The code after the slash in an outgoing letter number. Confirm the
        // spelling against a signed letter before the series is in use: it is
        // baked into every number issued and cannot be corrected afterwards
        // without contradicting letters already in circulation.
        value: 'ວຈພທນ(ຄນຮ)',
        category: 'school',
        isPublic: false,
        description: 'Department code in an outgoing letter number, e.g. 99/ວຈພທນ(ຄນຮ)',
      },
      {
        key: 'certificates.studyVerificationNumberPadding',
        // 0 prints `99`, `100`; 3 prints `001`, `002`. The office's paper book
        // decides which, and the two must not be mixed within one series.
        value: 0,
        category: 'certificates',
        isPublic: false,
        description: 'Digits to zero-pad a ໃບຢັ້ງຢືນການສຶກສາ number to; 0 for none',
      },
      {
        key: 'certificates.studyVerificationStartNumber',
        // The series continues the school's paper book rather than restarting.
        value: 99,
        category: 'certificates',
        isPublic: false,
        description: 'First ໃບຢັ້ງຢືນການສຶກສາ number; ignored once one has been issued',
      },
      {
        key: 'school.defaultLocale',
        value: 'lo',
        category: 'school',
        isPublic: true,
        description: 'Default interface language',
      },
      {
        key: 'grading.scale',
        value: DEFAULT_GRADE_SCALE,
        category: 'grading',
        isPublic: false,
        description: 'Grade bands. Changing this should be paired with a COMPUTATION_VERSION bump.',
      },
      {
        key: 'grading.reportMarkScale',
        value: 10,
        category: 'grading',
        isPublic: false,
        description:
          'What marks are printed out of on a report card. The school marks out of 10; the ' +
          'stored figure stays a percentage so classes can still be ranked and averaged.',
      },
      {
        key: 'grading.semesterMonths',
        value: DEFAULT_SEMESTER_MONTHS,
        category: 'grading',
        isPublic: false,
        description:
          'The calendar months each term collects on the monthly mark sheet, keyed by ' +
          'semester number. The school runs ກັນຍາ–ພະຈິກ and ກຸມພາ–ເມສາ.',
      },
      {
        key: 'grading.passingPercentage',
        value: DEFAULT_PASSING_PERCENTAGE,
        category: 'grading',
        isPublic: false,
        description: 'Default pass mark; a subject may override it',
      },
      {
        key: 'attendance.alertAbsenceThreshold',
        value: 5,
        category: 'attendance',
        isPublic: false,
        description: 'Absences in a semester before a guardian notification is raised',
      },
      // The school day. Teaching assignments are rejected outside this window,
      // which is what keeps a mistyped period off the timetable — and therefore
      // out of attendance, which takes its period from the timetable.
      {
        key: 'schedule.dayStartTime',
        value: '15:10',
        category: 'schedule',
        isPublic: true,
        description: 'Earliest a lesson may start, HH:mm',
      },
      {
        key: 'schedule.dayEndTime',
        value: '16:55',
        category: 'schedule',
        isPublic: true,
        description: 'Latest a lesson may end, HH:mm',
      },
      {
        key: 'schedule.teachingDays',
        value: [1, 2, 3, 4, 5],
        category: 'schedule',
        isPublic: true,
        description: 'Days the school teaches; 0 = Sunday, matching SchedulePeriod.dayOfWeek',
      },
      // The lesson-plan deadline is school policy, not a per-plan choice: a
      // teacher who sets their own due date is never late, which makes the
      // compliance matrix report nothing.
      {
        key: 'lessonPlans.submissionPolicy',
        value: DEFAULT_LESSON_PLAN_POLICY,
        category: 'lessonPlans',
        isPublic: false,
        description:
          'How far before the taught week a plan is due, and at what time. Applied when the ' +
          'plan is created; an existing plan keeps the deadline it was given.',
      },
      {
        key: 'exams.passingPercentage',
        value: 50,
        category: 'exams',
        isPublic: false,
        description: 'Percentage needed to pass an individual national exam subject',
      },
      {
        key: 'exams.eligibility',
        value: {
          minAttendanceRate: 80,
          maxSubjectsFailed: 2,
          requiredGradeLevel: { m4: 'm4', m7: 'm7' },
        },
        category: 'exams',
        isPublic: false,
        description: 'Thresholds the M4/M7 exam eligibility check applies',
      },
    ];

    for (const setting of settings) {
      await this.settingModel
        .updateOne(
          { key: setting.key },
          { $set: { ...setting, isSystem: true, deletedAt: null } },
          { upsert: true },
        )
        .exec();
    }
    this.logger.log(`Settings: ${settings.length}`);
  }

  private async seedRoles(): Promise<Map<string, RoleDocument>> {
    const byCode = new Map<string, RoleDocument>();

    for (const seed of ROLE_SEEDS) {
      const role = await this.roleModel
        .findOneAndUpdate(
          { code: seed.code },
          { $set: { ...seed, deletedAt: null } },
          { upsert: true, new: true, setDefaultsOnInsert: true },
        )
        .exec();
      byCode.set(seed.code, role);
    }

    this.logger.log(`Roles: ${byCode.size}`);
    return byCode;
  }

  /**
   * Creates the bootstrap administrator if no account exists yet.
   *
   * The password comes from SEED_ADMIN_PASSWORD when set. Otherwise a known
   * default is used *and* `mustChangePassword` is set, so the account is
   * unusable for anything but changing its own password until someone does.
   */
  private async seedAdminUser(adminRole: RoleDocument): Promise<void> {
    const existing = await this.userModel.findOne({ username: 'admin' }).exec();
    if (existing) {
      this.logger.log('Admin user already present — left untouched');
      return;
    }

    const password = process.env.SEED_ADMIN_PASSWORD ?? 'ChangeMe123';
    const usingDefault = !process.env.SEED_ADMIN_PASSWORD;

    await this.userModel.create({
      username: 'admin',
      email: 'admin@school.local',
      passwordHash: await AuthService.hashPassword(password),
      roleId: adminRole._id,
      personType: 'staff',
      personId: null,
      status: 'active',
      mustChangePassword: true,
      locale: 'lo',
    });

    if (usingDefault) {
      this.logger.warn(
        'Created user "admin" with the default password "ChangeMe123". ' +
          'It must be changed at first login. Set SEED_ADMIN_PASSWORD to avoid this.',
      );
    } else {
      this.logger.log('Created user "admin" from SEED_ADMIN_PASSWORD');
    }
  }

  /**
   * The official address list: 18 provinces, 149 districts, and the villages of
   * Vientiane Capital.
   *
   * Not sample data — a school records where its students live from day one, and
   * a placeholder tree is what the register was typed into last time, which took
   * a migration to undo. Keyed by the official `code`, so this is an update on a
   * database that already has it and the full list on one that does not.
   * `npm run import:locations` is the same write with the merge machinery a
   * migration needs; this is the plain version for a fresh database.
   */
  private async seedLocations(): Promise<void> {
    const official = flattenOfficialLocations();
    const idByCode = new Map<string, Types.ObjectId>();

    for (const type of ['province', 'district', 'village'] as const) {
      const rows = official.filter((row) => row.type === type);

      await this.locationModel.bulkWrite(
        rows.map((row) => {
          // Root-first, which is what the ancestors index relies on: a village
          // carries its province as well as its district.
          const parentId = row.parentCode ? idByCode.get(row.parentCode) : undefined;
          const provinceId =
            row.type === 'village' ? idByCode.get(row.code.slice(0, 2)) : undefined;
          const ancestors = [provinceId, parentId].filter(
            (id): id is Types.ObjectId => id !== undefined,
          );

          return {
            updateOne: {
              filter: { code: row.code },
              update: {
                $set: {
                  nameLo: row.nameLo,
                  type: row.type,
                  parentId: parentId ?? null,
                  ancestors,
                  depth: { province: 0, district: 1, village: 2 }[row.type],
                  deletedAt: null,
                },
              },
              upsert: true,
            },
          };
        }),
      );

      const written = await this.locationModel
        .find({ type, code: { $in: rows.map((row) => row.code) } })
        .select('_id code')
        .lean()
        .exec();

      for (const doc of written) idByCode.set(doc.code!, doc._id);
    }

    this.logger.log(`Locations: ${official.length}`);
  }

  /**
   * The discipline rule sheet, as far as it has been transcribed.
   *
   * Inserted and then left alone — `$setOnInsert`, unlike every other seed here
   * — because this is the one table the school owns rather than the system: the
   * director reissues the sheet each year, and a seed that reasserted itself on
   * every deploy would quietly undo the office's own wording. Rules missing from
   * this list are added on the ລະບຽບ screen, which is the same act.
   */
  private async seedConductRules(): Promise<void> {
    for (const seed of CONDUCT_RULE_SEEDS) {
      await this.conductRuleModel
        .updateOne(
          { code: seed.code },
          { $setOnInsert: { ...seed, isActive: true, deletedAt: null } },
          { upsert: true },
        )
        .exec();
    }
    this.logger.log(`Conduct rules: ${CONDUCT_RULE_SEEDS.length}`);
  }

  private async seedGradeLevels(): Promise<Map<string, GradeLevelDocument>> {
    const byCode = new Map<string, GradeLevelDocument>();

    for (const seed of GRADE_LEVEL_SEEDS) {
      const level = await this.gradeLevelModel
        .findOneAndUpdate(
          { code: seed.code },
          { $set: { ...seed, deletedAt: null } },
          { upsert: true, new: true, setDefaultsOnInsert: true },
        )
        .exec();
      byCode.set(seed.code, level);
    }

    this.logger.log(`Grade levels: ${byCode.size}`);
    return byCode;
  }

  private async seedSubjectGroups(): Promise<Map<string, SubjectGroupDocument>> {
    const byCode = new Map<string, SubjectGroupDocument>();

    for (const seed of SUBJECT_GROUP_SEEDS) {
      const group = await this.subjectGroupModel
        .findOneAndUpdate(
          { code: seed.code },
          { $set: { ...seed, isActive: true, deletedAt: null } },
          { upsert: true, new: true, setDefaultsOnInsert: true },
        )
        .exec();
      byCode.set(seed.code, group);
    }

    this.logger.log(`Subject groups: ${byCode.size}`);
    return byCode;
  }

  /**
   * Points each group at a head, once the teachers exist.
   *
   * Only the teachers already flagged `isAcademicHead` are considered — the flag
   * is what grants `lesson-plans:approve`, and a head who cannot approve is a
   * group whose plans nobody can clear.
   */
  private async assignGroupHeads(
    subjectGroups: Map<string, SubjectGroupDocument>,
    teachers: TeacherDocument[],
  ): Promise<void> {
    let assigned = 0;

    for (const group of subjectGroups.values()) {
      const head = teachers.find(
        (teacher) => teacher.isAcademicHead && String(teacher.subjectGroupId) === String(group._id),
      );
      if (!head) continue;

      await this.subjectGroupModel
        .updateOne({ _id: group._id }, { $set: { headTeacherId: head._id } })
        .exec();
      assigned += 1;
    }

    this.logger.log(`Subject group heads: ${assigned}`);
  }

  private async seedSubjects(
    gradeLevels: Map<string, GradeLevelDocument>,
    subjectGroups: Map<string, SubjectGroupDocument>,
  ): Promise<void> {
    let count = 0;

    for (const [levelCode, gradeLevel] of gradeLevels) {
      for (const template of SUBJECT_TEMPLATES) {
        // Subject codes are globally unique, so the grade level is part of the code.
        const code = `${template.code}-${levelCode.toUpperCase()}`;
        await this.subjectModel
          .updateOne(
            { code },
            {
              $set: {
                code,
                nameLo: template.nameLo,
                nameEn: template.nameEn,
                gradeLevelId: gradeLevel._id,
                subjectGroupId: subjectGroups.get(template.group)?._id ?? null,
                type: 'core',
                credits: template.credits,
                hoursPerWeek: template.hoursPerWeek,
                isActive: true,
                deletedAt: null,
              },
            },
            { upsert: true },
          )
          .exec();
        count += 1;
      }
    }

    this.logger.log(`Subjects: ${count}`);
  }

  private async seedSchoolYear(): Promise<SchoolYearDocument> {
    // Whichever year the school is actually running, if any. Almost everything
    // dated is read through the active year — a student's class placement, the
    // timetable, the score sheets — so seeding must not move it. A seed run that
    // stole it would blank the classroom column on every roster row, because the
    // real enrollments belong to the year that just got deactivated.
    const activeYear = await this.schoolYearModel
      .findOne({ isActive: true, deletedAt: null })
      .select('_id code')
      .lean()
      .exec();
    const yieldsToSchool = Boolean(activeYear && activeYear.code !== FIXTURE_YEAR_CODE);

    const year = await this.schoolYearModel
      .findOneAndUpdate(
        { code: FIXTURE_YEAR_CODE },
        {
          $set: {
            code: FIXTURE_YEAR_CODE,
            nameLo: 'ສົກຮຽນ 2025-2026',
            nameEn: 'Academic Year 2025-2026',
            startDate: new Date('2025-09-01'),
            endDate: new Date('2026-06-30'),
            deletedAt: null,
            // Claimed only when no year is active yet — a fresh database.
            isActive: !yieldsToSchool,
          },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      )
      .exec();

    if (yieldsToSchool) {
      this.logger.log(
        `School year: ${FIXTURE_YEAR_CODE} (fixtures only — ${activeYear!.code} stays active)`,
      );
      return year;
    }

    // Only one year may be active.
    await this.schoolYearModel
      .updateMany({ _id: { $ne: year._id } }, { $set: { isActive: false } })
      .exec();

    this.logger.log(`School year: ${FIXTURE_YEAR_CODE} (active)`);
    return year;
  }

  private async seedSemesters(schoolYear: SchoolYearDocument): Promise<void> {
    const semesters = [
      {
        number: 1,
        nameLo: 'ພາກຮຽນທີ 1',
        nameEn: 'Semester 1',
        startDate: new Date('2025-09-01'),
        endDate: new Date('2026-01-31'),
        status: 'active' as const,
        isActive: true,
      },
      {
        number: 2,
        nameLo: 'ພາກຮຽນທີ 2',
        nameEn: 'Semester 2',
        startDate: new Date('2026-02-01'),
        endDate: new Date('2026-06-30'),
        status: 'upcoming' as const,
        isActive: false,
      },
    ];

    for (const seed of semesters) {
      await this.semesterModel
        .updateOne(
          { schoolYearId: schoolYear._id, number: seed.number },
          { $set: { ...seed, schoolYearId: schoolYear._id, deletedAt: null } },
          { upsert: true },
        )
        .exec();
    }

    this.logger.log(`Semesters: ${semesters.length}`);
  }

  private async seedTeachers(
    subjectGroups: Map<string, SubjectGroupDocument>,
  ): Promise<TeacherDocument[]> {
    const seeds = [
      {
        teacherCode: 'T-2025-001',
        subjectGroupId: subjectGroups.get('math')?._id ?? null,
        firstNameLo: 'ສົມສັກ',
        lastNameLo: 'ພົມມະຈັນ',
        firstNameEn: 'Somsack',
        lastNameEn: 'Phommachanh',
        gender: 'male' as const,
        phone: '02055512345',
        qualification: 'ປະລິນຍາຕີ ຄະນິດສາດ',
        specialization: 'ຄະນິດສາດ',
        isAcademicHead: true,
      },
      {
        teacherCode: 'T-2025-002',
        subjectGroupId: subjectGroups.get('languages')?._id ?? null,
        firstNameLo: 'ຄຳຫລ້າ',
        lastNameLo: 'ສີສຸວົງ',
        firstNameEn: 'Khamla',
        lastNameEn: 'Sisouvong',
        gender: 'female' as const,
        phone: '02055512346',
        qualification: 'ປະລິນຍາຕີ ພາສາລາວ',
        specialization: 'ພາສາລາວ',
        isAcademicHead: false,
      },
      {
        teacherCode: 'T-2025-003',
        subjectGroupId: subjectGroups.get('languages')?._id ?? null,
        firstNameLo: 'ບຸນທະວີ',
        lastNameLo: 'ວົງສະຫວັນ',
        firstNameEn: 'Bounthavy',
        lastNameEn: 'Vongsavanh',
        gender: 'female' as const,
        phone: '02055512347',
        qualification: 'ປະລິນຍາຕີ ພາສາອັງກິດ',
        specialization: 'ພາສາອັງກິດ',
        isAcademicHead: false,
      },
    ];

    const teachers: TeacherDocument[] = [];
    for (const seed of seeds) {
      const teacher = await this.teacherModel
        .findOneAndUpdate(
          { teacherCode: seed.teacherCode },
          {
            $set: { ...seed, status: 'active', hireDate: new Date('2025-08-01'), deletedAt: null },
          },
          { upsert: true, new: true, setDefaultsOnInsert: true },
        )
        .exec();
      teachers.push(teacher);
    }

    this.logger.log(`Teachers: ${teachers.length}`);
    return teachers;
  }

  private async seedClassrooms(
    schoolYear: SchoolYearDocument,
    gradeLevels: Map<string, GradeLevelDocument>,
    teachers: TeacherDocument[],
  ): Promise<void> {
    // Two sections for m4 and m7 — the exit levels the exam module cares about.
    const plan: { levelCode: string; sections: string[] }[] = [
      { levelCode: 'm4', sections: ['ກ', 'ຂ'] },
      { levelCode: 'm7', sections: ['ກ'] },
    ];

    let count = 0;
    let teacherIndex = 0;

    for (const { levelCode, sections } of plan) {
      const gradeLevel = gradeLevels.get(levelCode);
      if (!gradeLevel) continue;

      for (const section of sections) {
        const homeroomTeacher = teachers[teacherIndex % teachers.length];
        teacherIndex += 1;

        await this.classroomModel
          .updateOne(
            { schoolYearId: schoolYear._id, gradeLevelId: gradeLevel._id, name: section },
            {
              $set: {
                homeroomTeacherId: homeroomTeacher?._id ?? null,
                capacity: 45,
                room: `${levelCode.toUpperCase()}-${section}`,
                isActive: true,
                deletedAt: null,
              },
              // `currentCount` is only initialized on insert: overwriting it
              // would corrupt the headcount of an existing classroom.
              $setOnInsert: { currentCount: 0 },
            },
            { upsert: true },
          )
          .exec();
        count += 1;
      }
    }

    this.logger.log(`Classrooms: ${count}`);
  }

  /**
   * Seeds the default report card and certificate templates.
   *
   * Without an active template for a type, report generation refuses to run — so
   * these are what make the reporting module usable out of the box.
   */
  private async seedReportTemplates(): Promise<void> {
    const templates = [
      {
        code: 'report-card-default',
        nameLo: 'ໃບລາຍງານຜົນການຮຽນ (ມາດຕະຖານ)',
        nameEn: 'Report Card (default)',
        type: 'report_card' as const,
        layout: DEFAULT_REPORT_CARD_LAYOUT,
      },
      {
        code: 'certificate-default',
        nameLo: 'ໃບປະກາດສະນີຍະບັດ (ມາດຕະຖານ)',
        nameEn: 'Certificate (default)',
        type: 'certificate' as const,
        layout: DEFAULT_CERTIFICATE_LAYOUT,
      },
    ];

    for (const template of templates) {
      await this.reportTemplateModel
        .updateOne(
          { code: template.code },
          {
            $set: { ...template, locale: 'lo', isActive: true, deletedAt: null },
            // Version is only initialized on insert — re-seeding must not reset
            // the version of a template an operator has since edited.
            $setOnInsert: { version: 1 },
          },
          { upsert: true },
        )
        .exec();
    }

    this.logger.log(`Report templates: ${templates.length}`);
  }

  /** A few Lao public holidays, so the calendar is not empty on first run. */
  private async seedCalendarEvents(schoolYear: SchoolYearDocument): Promise<void> {
    const events = [
      {
        titleLo: 'ວັນຊາດລາວ',
        titleEn: 'Lao National Day',
        type: 'holiday' as const,
        startDate: new Date('2025-12-02'),
        endDate: new Date('2025-12-02'),
      },
      {
        titleLo: 'ບຸນປີໃໝ່ລາວ',
        titleEn: 'Lao New Year',
        type: 'holiday' as const,
        startDate: new Date('2026-04-14'),
        endDate: new Date('2026-04-16'),
      },
      {
        titleLo: 'ສອບເສັງກາງພາກ ພາກຮຽນທີ 1',
        titleEn: 'Semester 1 midterm examinations',
        type: 'exam' as const,
        startDate: new Date('2025-11-10'),
        endDate: new Date('2025-11-14'),
      },
    ];

    const adminUser = await this.userModel.findOne({ username: 'admin' }).select('_id').exec();

    for (const event of events) {
      await this.calendarEventModel
        .updateOne(
          { titleLo: event.titleLo, startDate: event.startDate },
          {
            $set: {
              ...event,
              isAllDay: true,
              schoolYearId: schoolYear._id,
              targets: [],
              deletedAt: null,
            },
            $setOnInsert: { createdBy: adminUser?._id ?? null },
          },
          { upsert: true },
        )
        .exec();
    }

    this.logger.log(`Calendar events: ${events.length}`);
  }

  /** Wipes every collection. Test-support only; refuses to run in production. */
  async clearAll(): Promise<void> {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('Refusing to clear the database in production');
    }

    const models: Model<unknown>[] = [
      this.roleModel as unknown as Model<unknown>,
      this.userModel as unknown as Model<unknown>,
      this.locationModel as unknown as Model<unknown>,
      this.schoolYearModel as unknown as Model<unknown>,
      this.semesterModel as unknown as Model<unknown>,
      this.gradeLevelModel as unknown as Model<unknown>,
      this.subjectModel as unknown as Model<unknown>,
      this.classroomModel as unknown as Model<unknown>,
      this.teacherModel as unknown as Model<unknown>,
      this.settingModel as unknown as Model<unknown>,
    ];

    await Promise.all(models.map((model) => model.deleteMany({}).exec()));
  }

  /** Convenience for tests that need a known id. */
  async findRoleId(code: string): Promise<Types.ObjectId | null> {
    const role = await this.roleModel.findOne({ code }).select('_id').lean().exec();
    return role?._id ?? null;
  }
}
