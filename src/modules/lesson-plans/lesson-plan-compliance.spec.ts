import {
  assembleMatrix,
  ExpectedRow,
  GroupMeta,
  PlanFacts,
  planKey,
} from './lesson-plan-compliance';
import { buildSemesterWeeks, DEFAULT_LESSON_PLAN_POLICY } from './lesson-plan-weeks';

const SEMESTER = {
  id: 'sem1',
  nameLo: 'ພາກຮຽນທີ 1',
  nameEn: 'Semester 1',
  startDate: new Date('2025-09-01'),
  endDate: new Date('2025-09-21'),
};

/** Three weeks: 2025-09-01, 09-08, 09-15. */
const WEEKS = buildSemesterWeeks(SEMESTER.startDate, SEMESTER.endDate);

const SCIENCE: GroupMeta = {
  id: 'g-science',
  code: 'science',
  nameLo: 'ສາຍວິທະຍາສາດ',
  nameEn: 'Science',
  headTeacherName: 'ສົມໃຈ ວົງສາ',
};

const LANGUAGES: GroupMeta = {
  id: 'g-lang',
  code: 'languages',
  nameLo: 'ສາຍພາສາ',
  nameEn: 'Languages',
  headTeacherName: null,
};

const row = (overrides: Partial<ExpectedRow> = {}): ExpectedRow => ({
  teachingAssignmentId: 'ta1',
  teacherId: 't1',
  teacherCode: 'T-001',
  teacherName: 'ບຸນມີ ແກ້ວ',
  subjectId: 's1',
  subjectCode: 'CHEM-M4',
  subjectNameLo: 'ເຄມີສາດ',
  subjectNameEn: 'Chemistry',
  classroomId: 'c1',
  classroomName: 'm4/ກ',
  subjectGroupId: SCIENCE.id,
  ...overrides,
});

const plan = (overrides: Partial<PlanFacts> = {}): PlanFacts => ({
  id: 'p1',
  status: 'approved',
  isLate: false,
  submittedAt: new Date('2025-08-29'),
  attachmentCount: 1,
  activityCount: 5,
  completedActivityCount: 5,
  ...overrides,
});

/** Keys a plan onto the cell for `weekIndex` (1-based) of the given row. */
const at = (target: ExpectedRow, weekIndex: number): string =>
  planKey(target.teacherId, target.subjectId, target.classroomId, WEEKS[weekIndex - 1].startDate);

const build = (
  rows: ExpectedRow[],
  plans: Record<string, PlanFacts> = {},
  now = new Date('2025-09-22T08:00:00.000Z'),
) =>
  assembleMatrix({
    semester: SEMESTER,
    weeks: WEEKS,
    rows,
    groups: [SCIENCE, LANGUAGES],
    plansByKey: new Map(Object.entries(plans)),
    policy: DEFAULT_LESSON_PLAN_POLICY,
    now,
  });

describe('assembleMatrix', () => {
  it('reports a week with no plan as missing — the gap the list endpoint cannot show', () => {
    const only = row();
    const matrix = build([only], { [at(only, 1)]: plan() });

    const cells = matrix.groups[0].rows[0].cells;
    expect(cells.map((cell) => cell.status)).toEqual(['approved', 'missing', 'missing']);
  });

  it('gives every expected row a cell per week', () => {
    const matrix = build([row(), row({ teacherId: 't2', teachingAssignmentId: 'ta2' })]);
    for (const groupRow of matrix.groups[0].rows) {
      expect(groupRow.cells).toHaveLength(WEEKS.length);
    }
  });

  it('separates a draft from a submission — a reviewer cannot see a draft', () => {
    const only = row();
    const matrix = build([only], { [at(only, 1)]: plan({ status: 'draft' }) });

    expect(matrix.summary.draft).toBe(1);
    expect(matrix.summary.submitted).toBe(0);
  });

  it('counts returned and under_review as having reached the reviewer', () => {
    const only = row();
    const matrix = build([only], {
      [at(only, 1)]: plan({ status: 'returned' }),
      [at(only, 2)]: plan({ status: 'under_review' }),
    });

    expect(matrix.summary.submitted).toBe(2);
    expect(matrix.summary.approved).toBe(0);
  });

  it('marks a missing cell overdue only once its deadline has passed', () => {
    // Week 3 (2025-09-15) is due 2025-09-12 16:00; "now" is the 11th, so it is
    // still pending rather than overdue.
    const only = row();
    const matrix = build([only], {}, new Date('2025-09-11T08:00:00.000Z'));

    const cells = matrix.groups[0].rows[0].cells;
    expect(cells.map((cell) => cell.isOverdue)).toEqual([true, true, false]);
    expect(matrix.summary.overdue).toBe(2);
  });

  it('treats an unsubmitted draft past its deadline as overdue', () => {
    const only = row();
    const matrix = build([only], { [at(only, 1)]: plan({ status: 'draft' }) });
    expect(matrix.groups[0].rows[0].cells[0].isOverdue).toBe(true);
  });

  it('never marks a submitted cell overdue, however late it was', () => {
    const only = row();
    const matrix = build([only], { [at(only, 1)]: plan({ status: 'submitted', isLate: true }) });

    const cell = matrix.groups[0].rows[0].cells[0];
    expect(cell.isOverdue).toBe(false);
    expect(cell.isLate).toBe(true);
    expect(matrix.summary.late).toBe(1);
  });

  it('takes lateness from the plan rather than recomputing it against the current policy', () => {
    // A plan submitted on time under the old deadline must stay on time even
    // though the cell's derived due date has since moved.
    const only = row();
    const matrix = build([only], { [at(only, 1)]: plan({ status: 'approved', isLate: false }) });
    expect(matrix.groups[0].rows[0].cells[0].isLate).toBe(false);
  });

  it('counts uploads separately from submissions', () => {
    const only = row();
    const matrix = build([only], {
      [at(only, 1)]: plan({ status: 'submitted', attachmentCount: 0 }),
      [at(only, 2)]: plan({ status: 'submitted', attachmentCount: 2 }),
    });

    expect(matrix.summary.submitted).toBe(2);
    expect(matrix.summary.withAttachments).toBe(1);
  });

  it('does not match a plan filed for another class to this row', () => {
    // One teacher, one subject, two sections: each section owes its own plan.
    const sectionA = row();
    const sectionB = row({ teachingAssignmentId: 'ta2', classroomId: 'c2', classroomName: 'm4/ຂ' });
    const matrix = build([sectionA, sectionB], { [at(sectionA, 1)]: plan() });

    const forB = matrix.groups[0].rows.find((r) => r.classroomId === 'c2');
    expect(forB?.cells.every((cell) => cell.status === 'missing')).toBe(true);
  });

  it('groups rows by department, in configured order', () => {
    const matrix = build([
      row({ subjectGroupId: LANGUAGES.id, teacherId: 't2', subjectId: 's2' }),
      row(),
    ]);

    expect(matrix.groups.map((group) => group.subjectGroup?.code)).toEqual([
      'science',
      'languages',
    ]);
  });

  it('omits a department with no timetabled rows', () => {
    const matrix = build([row()]);
    expect(matrix.groups).toHaveLength(1);
  });

  it('files a subject with no department in a trailing unassigned bucket', () => {
    const matrix = build([row(), row({ teacherId: 't2', subjectId: 's9', subjectGroupId: null })]);

    expect(matrix.groups).toHaveLength(2);
    expect(matrix.groups[1].subjectGroup).toBeNull();
  });

  it('sorts the rows most-outstanding first', () => {
    const behind = row({ teacherId: 't1', teacherName: 'ກ ກ' });
    const upToDate = row({ teacherId: 't2', teacherName: 'ຂ ຂ', teachingAssignmentId: 'ta2' });

    const matrix = build([behind, upToDate], {
      [at(upToDate, 1)]: plan(),
      [at(upToDate, 2)]: plan(),
      [at(upToDate, 3)]: plan(),
    });

    expect(matrix.groups[0].rows[0].teacherId).toBe('t1');
  });

  it('rolls row counts up into the group and the group into the whole', () => {
    const first = row();
    const second = row({ teacherId: 't2', teachingAssignmentId: 'ta2' });
    const matrix = build([first, second], { [at(first, 1)]: plan() });

    expect(matrix.summary.expected).toBe(6);
    expect(matrix.groups[0].summary.expected).toBe(6);
    expect(matrix.summary.submitted).toBe(1);
    expect(matrix.summary.missing).toBe(5);
  });

  it('reports the submission rate as a percentage to one decimal', () => {
    const only = row();
    const matrix = build([only], { [at(only, 1)]: plan() });
    // 1 of 3 weeks.
    expect(matrix.summary.submissionRate).toBe(33.3);
  });

  it('reports a zero rate rather than NaN when nothing is expected', () => {
    const matrix = build([]);
    expect(matrix.summary.submissionRate).toBe(0);
    expect(matrix.groups).toEqual([]);
  });

  it('exposes the week columns the cells are keyed to', () => {
    const matrix = build([row()]);
    expect(matrix.weeks.map((week) => week.startDate)).toEqual([
      '2025-09-01',
      '2025-09-08',
      '2025-09-15',
    ]);
    expect(matrix.groups[0].rows[0].cells.map((cell) => cell.weekStartDate)).toEqual([
      '2025-09-01',
      '2025-09-08',
      '2025-09-15',
    ]);
  });
});
