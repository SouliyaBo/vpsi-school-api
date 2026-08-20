/**
 * Message catalogue for API errors and labels.
 *
 * Kept as a plain typed object rather than a runtime i18n library: the message
 * set is small, fully known at build time, and being a compile-time key means a
 * typo in a message key fails the build instead of shipping a raw key to a user.
 */
export const MESSAGES = {
  // ── Auth ──────────────────────────────────────────────────────────────────
  'auth.invalidCredentials': {
    lo: 'ຊື່ຜູ້ໃຊ້ ຫຼື ລະຫັດຜ່ານບໍ່ຖືກຕ້ອງ',
    en: 'Invalid username or password',
  },
  'auth.accountLocked': {
    lo: 'ບັນຊີຖືກລັອກຊົ່ວຄາວ ເນື່ອງຈາກເຂົ້າລະບົບຜິດຫຼາຍເທື່ອ',
    en: 'Account temporarily locked due to too many failed login attempts',
  },
  'auth.accountInactive': {
    lo: 'ບັນຊີນີ້ຖືກປິດການໃຊ້ງານ',
    en: 'This account is not active',
  },
  'auth.invalidRefreshToken': {
    lo: 'Refresh token ບໍ່ຖືກຕ້ອງ ຫຼື ໝົດອາຍຸແລ້ວ',
    en: 'Refresh token is invalid or expired',
  },
  'auth.tokenReuseDetected': {
    lo: 'ກວດພົບການໃຊ້ token ຊ້ຳ — ທຸກ session ຖືກຍົກເລີກແລ້ວ',
    en: 'Token reuse detected — all sessions have been revoked',
  },
  'auth.currentPasswordIncorrect': {
    lo: 'ລະຫັດຜ່ານປັດຈຸບັນບໍ່ຖືກຕ້ອງ',
    en: 'Current password is incorrect',
  },
  'auth.passwordTooWeak': {
    lo: 'ລະຫັດຜ່ານບໍ່ປອດໄພພຽງພໍ',
    en: 'Password does not meet the required strength',
  },
  'auth.mustChangePassword': {
    lo: 'ຕ້ອງປ່ຽນລະຫັດຜ່ານກ່ອນໃຊ້ງານ',
    en: 'You must change your password before continuing',
  },
  'auth.forbidden': {
    lo: 'ທ່ານບໍ່ມີສິດເຂົ້າເຖິງຂໍ້ມູນນີ້',
    en: 'You do not have permission to access this resource',
  },
  'auth.unauthenticated': {
    lo: 'ກະລຸນາເຂົ້າສູ່ລະບົບກ່ອນ',
    en: 'Authentication required',
  },

  // ── Generic CRUD ──────────────────────────────────────────────────────────
  'common.notFound': { lo: 'ບໍ່ພົບຂໍ້ມູນທີ່ຮ້ອງຂໍ', en: 'The requested record was not found' },
  'common.duplicate': {
    lo: 'ຂໍ້ມູນນີ້ມີຢູ່ໃນລະບົບແລ້ວ',
    en: 'A record with these values already exists',
  },
  'common.validationFailed': { lo: 'ຂໍ້ມູນທີ່ສົ່ງມາບໍ່ຖືກຕ້ອງ', en: 'Validation failed' },
  'common.internalError': { lo: 'ເກີດຂໍ້ຜິດພາດພາຍໃນລະບົບ', en: 'An internal error occurred' },
  'common.inUse': {
    lo: 'ບໍ່ສາມາດລຶບໄດ້ ເພາະຍັງມີຂໍ້ມູນອື່ນອ້າງອີງຢູ່',
    en: 'Cannot delete: other records still reference this one',
  },
  'common.storageUnavailable': {
    lo: 'ບໍ່ສາມາດເຊື່ອມຕໍ່ບ່ອນເກັບໄຟລ໌ໄດ້ — ກະລຸນາແຈ້ງຜູ້ດູແລລະບົບ',
    en: 'The file store cannot be reached — please tell an administrator',
  },
  'common.rateLimited': {
    lo: 'ສົ່ງຄຳຂໍຫຼາຍເກີນໄປ ກະລຸນາລໍຖ້າ',
    en: 'Too many requests, please slow down',
  },

  // ── Locations ─────────────────────────────────────────────────────────────
  'location.invalidParentType': {
    lo: 'ປະເພດຂອງສະຖານທີ່ແມ່ບໍ່ຖືກຕ້ອງຕາມລຳດັບຊັ້ນ',
    en: 'Parent location type is invalid for this hierarchy level',
  },
  'location.cyclicParent': {
    lo: 'ບໍ່ສາມາດຕັ້ງໃຫ້ເປັນລູກຂອງຕົນເອງໄດ້',
    en: 'A location cannot be its own ancestor',
  },

  // ── Academic structure ────────────────────────────────────────────────────
  'schoolYear.overlappingDates': {
    lo: 'ຊ່ວງວັນທີຂອງສົກຮຽນຊ້ອນກັບສົກຮຽນອື່ນ',
    en: 'School year dates overlap another school year',
  },
  'schoolYear.notActive': { lo: 'ສົກຮຽນນີ້ບໍ່ໄດ້ເປີດໃຊ້ງານ', en: 'This school year is not active' },
  'semester.outsideSchoolYear': {
    lo: 'ຊ່ວງວັນທີຂອງພາກຮຽນຢູ່ນອກສົກຮຽນ',
    en: 'Semester dates fall outside the school year',
  },
  'semester.closed': {
    lo: 'ພາກຮຽນນີ້ປິດແລ້ວ ບໍ່ສາມາດແກ້ໄຂໄດ້',
    en: 'This semester is closed and can no longer be modified',
  },

  // ── Classrooms & enrollment ───────────────────────────────────────────────
  'classroom.capacityExceeded': {
    lo: 'ຫ້ອງຮຽນເຕັມແລ້ວ',
    en: 'Classroom is at full capacity',
  },
  'classroom.gradeLevelMismatch': {
    lo: 'ຫ້ອງຮຽນບໍ່ຕົງກັບຊັ້ນຮຽນທີ່ລະບຸ',
    en: 'Classroom does not belong to the specified grade level',
  },
  'enrollment.alreadyEnrolled': {
    lo: 'ນັກຮຽນລົງທະບຽນໃນສົກຮຽນນີ້ແລ້ວ',
    en: 'Student is already enrolled for this school year',
  },
  'enrollment.studentNotActive': {
    lo: 'ນັກຮຽນບໍ່ຢູ່ໃນສະຖານະທີ່ລົງທະບຽນໄດ້',
    en: 'Student status does not allow enrollment',
  },
  'enrollment.invalidStatusTransition': {
    lo: 'ບໍ່ສາມາດປ່ຽນສະຖານະນີ້ໄດ້',
    en: 'That enrollment status change is not allowed',
  },
  'enrollment.notOwnHomeroom': {
    lo: 'ຈັດເຂົ້າຫ້ອງໄດ້ສະເພາະຫ້ອງທີ່ທ່ານເປັນຄູປະຈຳຫ້ອງ',
    en: 'You may only place a student in the classroom you are homeroom teacher of',
  },

  // ── Teaching assignments ──────────────────────────────────────────────────
  'assignment.teacherConflict': {
    lo: 'ຄູສອນມີຊົ່ວໂມງສອນຊ້ອນກັນໃນເວລານີ້',
    en: 'The teacher already has a class scheduled at this time',
  },
  'assignment.classroomConflict': {
    lo: 'ຫ້ອງຮຽນມີວິຊາອື່ນສອນຢູ່ໃນເວລານີ້',
    en: 'The classroom already has a lesson scheduled at this time',
  },
  'assignment.roomConflict': {
    lo: 'ຫ້ອງນີ້ຖືກໃຊ້ຢູ່ໃນເວລານີ້ແລ້ວ',
    en: 'That room is already in use at this time',
  },
  'assignment.alreadyAssigned': {
    lo: 'ຄູຄົນນີ້ສອນວິຊານີ້ໃຫ້ຫ້ອງນີ້ຢູ່ແລ້ວ — ໃຫ້ໄປແກ້ໄຂລາຍການນັ້ນ ແລ້ວກົດ "ເພີ່ມຄາບ" ແທນການສ້າງໃໝ່',
    en: 'This teacher already takes this subject with this class — edit that assignment and use "add period" instead of creating a new one',
  },
  'assignment.rotationNotMarked': {
    lo: 'ຄາບສະລັບຕ້ອງຕິກທັງສອງຝ່າຍ — ໄປຕິກ "ຄາບສະລັບ" ໃສ່ການສອນອີກລາຍການທີ່ໃຊ້ຄາບນີ້ນຳ',
    en: 'A swap slot must be marked on both sides — tick "swap slot" on the other lesson sharing this period too',
  },
  'assignment.invalidTimeRange': {
    lo: 'ເວລາເລີ່ມຕ້ອງກ່ອນເວລາຈົບ',
    en: 'Start time must be before end time',
  },
  'assignment.subjectGradeMismatch': {
    lo: 'ວິຊານີ້ບໍ່ແມ່ນຂອງຊັ້ນຮຽນຂອງຫ້ອງນີ້',
    en: 'The subject does not belong to this classroom grade level',
  },
  'assignment.outsideSchoolDay': {
    lo: 'ເວລາສອນຢູ່ນອກຊ່ວງເວລາຮຽນຂອງໂຮງຮຽນ',
    en: 'The lesson time falls outside the school day',
  },
  'assignment.notATeachingDay': {
    lo: 'ໂຮງຮຽນບໍ່ໄດ້ເປີດສອນໃນວັນນີ້',
    en: 'The school does not teach on that day of the week',
  },

  // ── Scores ────────────────────────────────────────────────────────────────
  'score.weightSumInvalid': {
    lo: 'ນ້ຳໜັກຂອງອົງປະກອບຄະແນນລວມກັນຕ້ອງເທົ່າກັບ 100%',
    en: 'Score component weights must total 100%',
  },
  'score.exceedsMax': {
    lo: 'ຄະແນນເກີນຄະແນນເຕັມ',
    en: 'Score exceeds the maximum for this component',
  },
  'score.locked': {
    lo: 'ຄະແນນຖືກລັອກແລ້ວ ຕ້ອງຂໍອະນຸຍາດກ່ອນແກ້ໄຂ',
    en: 'Scores are locked; an override with a reason is required to amend them',
  },
  'score.notAssignedTeacher': {
    lo: 'ທ່ານບໍ່ແມ່ນຄູສອນວິຊານີ້ໃນຫ້ອງນີ້',
    en: 'You are not the assigned teacher for this subject and classroom',
  },
  'score.overrideReasonRequired': {
    lo: 'ຕ້ອງລະບຸເຫດຜົນໃນການແກ້ໄຂຄະແນນທີ່ລັອກແລ້ວ',
    en: 'A reason is required when amending a locked score',
  },
  'score.studentNotInClassroom': {
    lo: 'ນັກຮຽນຄົນນີ້ບໍ່ໄດ້ຢູ່ໃນຫ້ອງນີ້',
    en: 'That student is not enrolled in this classroom',
  },

  // ── Attendance ────────────────────────────────────────────────────────────
  'attendance.futureDate': {
    lo: 'ບໍ່ສາມາດບັນທຶກການເຂົ້າຮຽນລ່ວງໜ້າໄດ້',
    en: 'Attendance cannot be recorded for a future date',
  },
  'attendance.outsideSemester': {
    lo: 'ວັນທີຢູ່ນອກຊ່ວງພາກຮຽນ',
    en: 'Date falls outside the semester',
  },
  'attendance.lessonNotScheduled': {
    lo: 'ວິຊານີ້ບໍ່ມີການສອນໃນວັນທີດັ່ງກ່າວ',
    en: 'This lesson is not on the timetable for that date',
  },
  'attendance.assignmentInactive': {
    lo: 'ຕາຕະລາງສອນນີ້ຖືກປິດການນຳໃຊ້ແລ້ວ',
    en: 'That teaching assignment is no longer active',
  },
  'attendance.notAssignedTeacher': {
    lo: 'ທ່ານບໍ່ແມ່ນຄູສອນຂອງຊົ່ວໂມງນີ້',
    en: 'You are not the teacher assigned to this lesson',
  },

  // ── Behavior log ──────────────────────────────────────────────────────────
  'behaviorLog.futureDate': {
    lo: 'ບໍ່ສາມາດບັນທຶກພຶດຕິກຳລ່ວງໜ້າໄດ້',
    en: 'Behaviour cannot be recorded for a future date',
  },
  'behaviorLog.emptyRow': {
    lo: 'ຕ້ອງລະບຸສະພາບລວມພາຍໃນຫ້ອງ ຫຼື ນັກຮຽນຢ່າງໜ້ອຍໜຶ່ງຄົນ',
    en: 'Give either a class note or at least one student',
  },
  'behaviorLog.duplicateStudent': {
    lo: 'ມີຊື່ນັກຮຽນຊ້ຳກັນໃນລາຍການດຽວ',
    en: 'The same student is listed twice in one entry',
  },

  // ── Term results ──────────────────────────────────────────────────────────
  'termResult.noScores': {
    lo: 'ຍັງບໍ່ມີຄະແນນພຽງພໍທີ່ຈະຄິດໄລ່ຜົນການຮຽນ',
    en: 'Not enough scores recorded to compute a term result',
  },
  'termResult.notPublished': {
    lo: 'ຜົນການຮຽນຍັງບໍ່ທັນປະກາດ',
    en: 'Term results have not been published yet',
  },

  // ── People ────────────────────────────────────────────────────────────────
  'student.guardianRequired': {
    lo: 'ຕ້ອງມີຜູ້ປົກຄອງຢ່າງໜ້ອຍ 1 ຄົນ',
    en: 'At least one guardian is required',
  },
  'student.multiplePrimaryGuardians': {
    lo: 'ກຳນົດຜູ້ປົກຄອງຫຼັກໄດ້ພຽງຄົນດຽວ',
    en: 'Only one guardian can be marked as primary',
  },
  'student.duplicateOrganization': {
    lo: 'ນັກຮຽນເຂົ້າແຕ່ລະອົງການໄດ້ພຽງຄັ້ງດຽວ',
    en: 'A student can hold only one membership per organisation',
  },
  'student.notInHomeroom': {
    lo: 'ແກ້ໄຂໄດ້ສະເພາະນັກຮຽນໃນຫ້ອງທີ່ທ່ານເປັນຄູປະຈຳຫ້ອງ',
    en: 'You may only edit students in the classroom you are homeroom teacher of',
  },
  'student.statusIsOfficeOnly': {
    lo: 'ການປ່ຽນສະຖານະນັກຮຽນແມ່ນໜ້າທີ່ຂອງຫ້ອງທະບຽນ',
    en: 'Changing a student’s status is the registrar’s decision',
  },

  // ── Health ────────────────────────────────────────────────────────────────
  'vaccination.campaignHasDoses': {
    lo: 'ລຶບໂຄງການບໍ່ໄດ້ ເພາະໄດ້ສັກໃຫ້ນັກຮຽນແລ້ວ {count} ຄົນ — ໃຫ້ປ່ຽນສະຖານະເປັນ "ຍົກເລີກ" ແທນ',
    en: 'Cannot delete a campaign that has already given {count} dose(s) — cancel it instead',
  },
  'vaccination.studentNotEligible': {
    lo: 'ນັກຮຽນບໍ່ຢູ່ໃນເງື່ອນໄຂຂອງໂຄງການນີ້: {studentIds}',
    en: 'These students do not meet this campaign’s eligibility rule: {studentIds}',
  },
  'vaccination.studentNotOnRound': {
    lo: 'ນັກຮຽນຍັງບໍ່ໄດ້ຖືກເລືອກເຂົ້າໂຄງການນີ້: {studentIds}',
    en: 'These students have not been added to this round: {studentIds}',
  },
  'vaccination.studentHasRecord': {
    lo: 'ເອົານັກຮຽນ {count} ຄົນອອກຈາກໂຄງການບໍ່ໄດ້ ເພາະໄດ້ບັນທຶກຜົນການສັກໄວ້ແລ້ວ',
    en: 'Cannot remove {count} student(s) from this round — a dose is already recorded for them',
  },
  'vaccination.guardianNotOnFile': {
    lo: 'ຜູ້ປົກຄອງທີ່ເຊັນຍິນຍອມບໍ່ຢູ່ໃນລາຍຊື່ຜູ້ປົກຄອງຂອງນັກຮຽນ {studentCode}',
    en: 'The consenting guardian is not on student {studentCode}’s guardian list',
  },
  'vaccination.administeredDateRequired': {
    lo: 'ຕ້ອງລະບຸວັນທີ່ສັກ ສຳລັບນັກຮຽນ {studentCode}',
    en: 'A dose marked as given must say when — student {studentCode}',
  },
  'vaccination.consentRequired': {
    lo: 'ຍັງບໍ່ມີໃບຍິນຍອມຈາກຜູ້ປົກຄອງຂອງນັກຮຽນ {studentCode}',
    en: 'No guardian consent on file for student {studentCode}',
  },
} as const;

export type MessageKey = keyof typeof MESSAGES;
export type Locale = 'lo' | 'en';

export const SUPPORTED_LOCALES: readonly Locale[] = ['lo', 'en'];

export const isSupportedLocale = (value: unknown): value is Locale =>
  typeof value === 'string' && (SUPPORTED_LOCALES as readonly string[]).includes(value);
