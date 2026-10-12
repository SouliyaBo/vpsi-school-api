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
  'score.subjectIsSplit': {
    lo: 'ວິຊານີ້ບໍ່ໄດ້ໃຫ້ຄະແນນເປັນວິຊາລວມ ໃຫ້ເລືອກວິຊາຍ່ອຍທີ່ແຍກອອກມາ',
    en: 'This subject is marked as the subjects it splits into, not as a whole',
  },
  'score.studentNotInClassroom': {
    lo: 'ນັກຮຽນຄົນນີ້ບໍ່ໄດ້ຢູ່ໃນຫ້ອງນີ້',
    en: 'That student is not enrolled in this classroom',
  },
  'score.columnNotMarked': {
    lo: 'ວິຊານີ້ບໍ່ໄດ້ເກັບຄະແນນຊ່ອງນີ້',
    en: 'This subject is not marked on that column',
  },
  'score.columnMaxInvalid': {
    lo: 'ຄະແນນເຕັມທັງ 4 ຊ່ອງຕ້ອງລວມກັນເທົ່າກັບ 10',
    en: "The four monthly columns' maximum marks must total 10",
  },

  // ── Teacher departure (ການສົ່ງມອບການສອນ) ───────────────────────────────────
  'teacher.stillResponsible': {
    lo: 'ຍັງລຶບບໍ່ໄດ້ ເພາະຄູທ່ານນີ້ຍັງຮັບຜິດຊອບຕາຕະລາງສອນ ຫຼື ຫ້ອງປະຈຳຢູ່ — ກະລຸນາສົ່ງມອບໃຫ້ຄູຜູ້ອື່ນກ່ອນ',
    en:
      'This teacher still holds a timetable or a homeroom, so the record cannot be ' +
      'removed — hand the work over to another teacher first',
  },
  'teacher.handoverToSelf': {
    lo: 'ສົ່ງມອບໃຫ້ຄູຄົນເກົ່າບໍ່ໄດ້ — ກະລຸນາເລືອກຄູຜູ້ຮັບມອບ',
    en: 'A teacher cannot hand over to themselves — choose the teacher taking over',
  },
  'teacher.handoverTargetInactive': {
    lo: 'ຄູຜູ້ຮັບມອບຕ້ອງເປັນຄູທີ່ຍັງປະຈຳການຢູ່',
    en: 'The teacher taking over must still be in service',
  },
  'teacher.nothingToHandOver': {
    lo: 'ຄູທ່ານນີ້ບໍ່ມີຕາຕະລາງສອນ ຫຼື ຫ້ອງປະຈຳທີ່ຕ້ອງສົ່ງມອບ',
    en: 'This teacher holds no timetable or homeroom to hand over',
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

  // ── Lesson substitution (ການມອບໝາຍສອນແທນ) ─────────────────────────────────
  'substitution.alreadyClaimed': {
    lo: 'ຊົ່ວໂມງນີ້ມີຄູຮັບສອນແທນໄວ້ແລ້ວ',
    en: 'Another teacher has already claimed cover for this lesson',
  },
  'substitution.ownLesson': {
    lo: 'ທ່ານເປັນຄູສອນຂອງຊົ່ວໂມງນີ້ຢູ່ແລ້ວ ບໍ່ຈຳເປັນຕ້ອງຮັບສອນແທນ',
    en: 'You are already the teacher of this lesson; no cover is needed',
  },
  'substitution.claimWindowClosed': {
    lo: 'ໝົດກຳນົດຮັບສອນແທນຂອງຊົ່ວໂມງນີ້ແລ້ວ — ກະລຸນາແຈ້ງຫ້ອງການວິຊາການ',
    en: 'The window to claim cover for this lesson has closed — ask the academic office',
  },
  'substitution.notATeacher': {
    lo: 'ມີແຕ່ຄູສອນເທົ່ານັ້ນທີ່ຮັບສອນແທນໄດ້',
    en: 'Only a teacher can claim cover for a lesson',
  },
  'substitution.notYours': {
    lo: 'ທ່ານຖອນໄດ້ແຕ່ການສອນແທນຂອງຕົນເອງ',
    en: 'You may only withdraw cover you claimed yourself',
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

  // ── Homeroom review (ການຕິດຕາມນັກຮຽນຂອງຄູປະຈຳຫ້ອງ) ─────────────────────────
  'homeroomReview.notHomeroomTeacher': {
    lo: 'ທ່ານບໍ່ແມ່ນຄູປະຈຳຫ້ອງນີ້',
    en: 'You are not the homeroom teacher of that class',
  },
  'homeroomReview.notReviewDay': {
    lo: 'ວັນທີ່ເລືອກບໍ່ແມ່ນວັນຕິດຕາມ (ວັນພຸດ ຫຼື ວັນສຸກ ທີ່ໂຮງຮຽນເປີດສອນ)',
    en: 'That date is not a review day — a Wednesday or Friday the school taught on',
  },
  'homeroomReview.noReviewDayYet': {
    lo: 'ຍັງບໍ່ມີວັນຕິດຕາມໃນພາກຮຽນນີ້',
    en: 'The term has not reached its first review day yet',
  },
  'homeroomReview.alreadyFiled': {
    lo: 'ຫ້ອງນີ້ໄດ້ຢືນຢັນການຕິດຕາມຂອງວັນນີ້ແລ້ວ — ໃຫ້ແກ້ໄຂລາຍການເກົ່າແທນ',
    en: 'This class has already confirmed that review day — amend the existing one',
  },
  'homeroomReview.studentNotOnRoll': {
    lo: 'ມີນັກຮຽນທີ່ບໍ່ຢູ່ໃນບັນຊີຫ້ອງນີ້',
    en: 'A student named is not on this class roster',
  },
  'homeroomReview.channelRequired': {
    lo: 'ກະລຸນາລະບຸຊ່ອງທາງທີ່ແຈ້ງຜູ້ປົກຄອງ',
    en: 'Say how the guardian was contacted',
  },
  'homeroomReview.channelNotAllowed': {
    lo: 'ບໍ່ຕ້ອງລະບຸຊ່ອງທາງ ເມື່ອຍັງບໍ່ໄດ້ແຈ້ງຜູ້ປົກຄອງ',
    en: 'A contact channel belongs only to an action that reached a guardian',
  },
  'homeroomReview.noHomeroomTeacher': {
    lo: 'ຫ້ອງນີ້ຍັງບໍ່ມີຄູປະຈຳຫ້ອງ',
    en: 'That class has no homeroom teacher on file',
  },
  'homeroomReview.reportNotOpen': {
    lo: 'ຍັງສົ່ງບົດສະຫຼຸບເດືອນນີ້ບໍ່ໄດ້ — ສົ່ງໄດ້ແຕ່ວັນສຸດທ້າຍຂອງເດືອນເປັນຕົ້ນໄປ',
    en: 'This month’s report cannot be sent yet — it opens on the last day of the month',
  },
  'homeroomReview.monthNotInSemester': {
    lo: 'ເດືອນທີ່ເລືອກບໍ່ຢູ່ໃນພາກຮຽນນີ້',
    en: 'That month does not fall in the chosen term',
  },

  // ── Conduct deductions (ຕັດຄະແນນກົດລະບຽບ) ──────────────────────────────────
  'conductRule.duplicateCode': {
    lo: 'ມີລະບຽບຂໍ້ນີ້ຢູ່ແລ້ວ',
    en: 'A rule with that number already exists',
  },
  'conductRule.inUse': {
    lo: 'ລະບຽບຂໍ້ນີ້ຖືກນຳໃຊ້ຕັດຄະແນນແລ້ວ — ໃຫ້ປິດການນຳໃຊ້ແທນການລຶບ',
    en: 'That rule has already been applied — withdraw it instead of deleting it',
  },
  'conductRule.withdrawn': {
    lo: 'ລະບຽບຂໍ້ນີ້ຖືກປິດການນຳໃຊ້ແລ້ວ',
    en: 'That rule is no longer in force',
  },
  'conductDeduction.futureDate': {
    lo: 'ບໍ່ສາມາດຕັດຄະແນນລ່ວງໜ້າໄດ້',
    en: 'Points cannot be deducted for a future date',
  },
  'conductDeduction.outsideSemester': {
    lo: 'ວັນທີບໍ່ຢູ່ໃນພາກຮຽນໃດ',
    en: 'That date does not fall within any semester',
  },
  'conductDeduction.duplicateStudent': {
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
  'student.codeIsOfficeOnly': {
    lo: 'ການປ່ຽນລະຫັດນັກຮຽນແມ່ນໜ້າທີ່ຂອງຫ້ອງທະບຽນ',
    en: 'Changing a student’s code is the registrar’s decision',
  },

  // ── Exam papers (ບົດສອບປາລະໄນ) ──────────────────────────────────────────────
  'examPaper.notWord': {
    lo: 'ໄຟລ໌ນີ້ບໍ່ແມ່ນເອກະສານ Word (.docx)',
    en: 'The file is not a Word document (.docx)',
  },
  'examPaper.noQuestions': {
    lo: 'ບໍ່ພົບຄຳຖາມໃນໄຟລ໌ — ຄຳຖາມຕ້ອງຂຶ້ນຕົ້ນດ້ວຍເລກ ເຊັ່ນ 1. ແລະ ຄຳຕອບດ້ວຍ A. B. C. D.',
    en: 'No questions were found — a question starts with its number (1.) and options with A. B. C. D.',
  },
  'examPaper.noVariants': {
    lo: 'ຍັງບໍ່ໄດ້ສ້າງຊຸດບົດສອບ — ກົດ ສ້າງຊຸດ ກ່ອນ',
    en: 'No sets have been drawn yet — generate the sets first',
  },
  'examPaper.unknownSet': {
    lo: 'ບໍ່ມີຊຸດນີ້',
    en: 'There is no such set',
  },
  'examPaper.imageNotOwned': {
    lo: 'ຮູບພາບບໍ່ແມ່ນຂອງບົດສອບນີ້',
    en: 'That picture does not belong to this paper',
  },
  'examPaper.classroomRequired': {
    lo: 'ກະລຸນາເລືອກຫ້ອງຮຽນ',
    en: 'Choose a classroom',
  },
  'examPaper.noStudents': {
    lo: 'ຫ້ອງນີ້ບໍ່ມີນັກຮຽນ',
    en: 'The classroom has no students',
  },
  'examPaper.notTheOwner': {
    lo: 'ບົດສອບນີ້ບໍ່ແມ່ນຂອງທ່ານ',
    en: 'This paper is not yours',
  },
  'examPaper.subjectRequired': {
    lo: 'ກະລຸນາລະບຸວິຊາຂອງບົດສອບກ່ອນ ຈຶ່ງສົ່ງຄະແນນເຂົ້າຄະແນນປະຈຳເດືອນໄດ້',
    en: 'Set the paper’s subject before sending marks to the monthly sheet',
  },
  'examPaper.pointsExceedTest': {
    lo: 'ຄະແນນເຕັມຂອງບົດສອບເກີນຊ່ອງ ກວດກາ ({{max}} ຄະແນນ) — ຕັ້ງຄະແນນເຕັມບໍ່ເກີນ {{max}}',
    en: 'The paper’s total exceeds the ກວດກາ column ({{max}}) — set a total of at most {{max}}',
  },
  'examPaper.scanNeedsStudent': {
    lo: 'ກະລຸນາລະບຸນັກຮຽນ ແລະ ຊຸດ ກ່ອນຢືນຢັນ',
    en: 'Name the pupil and the set before confirming',
  },
  'examPaper.scanAlreadyConfirmed': {
    lo: 'ໃບນີ້ຢືນຢັນແລ້ວ',
    en: 'This sheet has already been confirmed',
  },
  'examPaper.nothingToPush': {
    lo: 'ຍັງບໍ່ມີເຈ້ຍຕອບທີ່ກອກຄະແນນໄວ້',
    en: 'No sheets with points have been keyed in yet',
  },

  // ── Teaching observation (ຕິດຕາມການສອນຂອງຄູ) ───────────────────────────────
  'observation.observerRequired': {
    lo: 'ຕ້ອງລະບຸຜູ້ຕິດຕາມ — ບັນຊີນີ້ບໍ່ໄດ້ຜູກກັບຄູຄົນໃດ',
    en: 'Name the observer — this account is not linked to a teacher',
  },
  'observation.notTheObserver': {
    lo: 'ແກ້ໄຂໄດ້ສະເພາະຜູ້ທີ່ເປັນຜູ້ຕິດຕາມໃນແບບຟອມນີ້',
    en: 'Only the observer named on this sheet may change it',
  },
  'observation.notTheObservedTeacher': {
    lo: 'ຢືນຢັນການຮັບຮູ້ໄດ້ສະເພາະຄູທີ່ຖືກຕິດຕາມເທົ່ານັ້ນ',
    en: 'Only the teacher who was observed may confirm they have read it',
  },
  'observation.selfObservation': {
    lo: 'ຜູ້ຕິດຕາມ ແລະ ຄູທີ່ຖືກຕິດຕາມຕ້ອງບໍ່ແມ່ນຄົນດຽວກັນ',
    en: 'The observer and the teacher observed cannot be the same person',
  },
  'observation.alreadySubmitted': {
    lo: 'ແບບຟອມນີ້ສົ່ງແລ້ວ ບໍ່ສາມາດແກ້ໄຂໄດ້',
    en: 'This sheet has been filed and can no longer be changed',
  },
  'observation.notYetSubmitted': {
    lo: 'ແບບຟອມນີ້ຍັງເປັນສະບັບຮ່າງ',
    en: 'This sheet is still a draft',
  },
  'observation.incompleteSheet': {
    lo: 'ຕ້ອງໃຫ້ຄະແນນຄົບທັງ 6 ຂໍ້ກ່ອນສົ່ງ — ຍັງຂາດ: {criteria}',
    en: 'All six criteria must be scored before filing — still blank: {criteria}',
  },
  'observation.duplicateVisit': {
    lo: 'ທ່ານໄດ້ປະເມີນຄູຄົນນີ້ ວິຊານີ້ ຄັ້ງທີ {visitNumber} ໄປແລ້ວໃນພາກຮຽນນີ້',
    en: 'You have already filed visit {visitNumber} for this teacher and subject this term',
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
