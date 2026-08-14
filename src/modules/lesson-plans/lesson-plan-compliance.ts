import { LessonPlanStatus } from 'src/common/constants/enums';
import { deriveDueDate, LessonPlanPolicy, SemesterWeek, weekKey } from './lesson-plan-weeks';

/**
 * Assembly of the lesson-plan compliance matrix.
 *
 * The point of this file is the inversion the rest of the module cannot do:
 * `GET /lesson-plans` reads the `lessonPlans` collection, so a plan nobody wrote
 * is a row that does not exist and therefore cannot be reported. Oversight needs
 * the opposite — the *expected* set comes from the timetable, and a plan is
 * matched into it. What has no match is the answer.
 *
 * Kept free of Mongoose so the shape can be tested directly; the service does
 * the reads and hands the pieces in.
 */

/** `missing` is not a stored status — it is the absence of a plan. */
export const MISSING = 'missing' as const;
export type ComplianceStatus = LessonPlanStatus | typeof MISSING;

/** One (teacher, subject, class) the timetable says should file plans. */
export interface ExpectedRow {
  teachingAssignmentId: string;
  teacherId: string;
  teacherCode: string;
  teacherName: string;
  subjectId: string;
  subjectCode: string;
  subjectNameLo: string;
  subjectNameEn: string | null;
  classroomId: string;
  classroomName: string;
  /** `null` for a subject not yet filed under a department. */
  subjectGroupId: string | null;
}

/** What a stored plan contributes to a cell. */
export interface PlanFacts {
  id: string;
  status: LessonPlanStatus;
  isLate: boolean;
  submittedAt: Date | null;
  attachmentCount: number;
  activityCount: number;
  completedActivityCount: number;
}

export interface GroupMeta {
  id: string;
  code: string;
  nameLo: string;
  nameEn: string | null;
  headTeacherName: string | null;
}

export interface ComplianceCell {
  weekIndex: number;
  /** `yyyy-MM-dd`, the Monday — the same key the plan is stored under. */
  weekStartDate: string;
  status: ComplianceStatus;
  planId: string | null;
  isLate: boolean;
  /** What the teacher actually uploaded against the plan. */
  attachmentCount: number;
  activityCount: number;
  completedActivityCount: number;
  dueDate: string;
  /** Nothing submitted and the deadline has passed — the cell that needs chasing. */
  isOverdue: boolean;
}

export interface ComplianceCounts {
  expected: number;
  /** Reached the reviewer: submitted, under review, returned or approved. */
  submitted: number;
  approved: number;
  /** Started but never sent — invisible to the reviewer, so counted apart. */
  draft: number;
  missing: number;
  late: number;
  overdue: number;
  withAttachments: number;
  /** `submitted / expected`, 0–100, one decimal. */
  submissionRate: number;
}

export interface ComplianceRow extends ExpectedRow {
  cells: ComplianceCell[];
  summary: ComplianceCounts;
}

export interface ComplianceGroup {
  /** `null` is the bucket for subjects with no department yet. */
  subjectGroup: GroupMeta | null;
  rows: ComplianceRow[];
  summary: ComplianceCounts;
}

export interface ComplianceMatrix {
  semester: {
    id: string;
    nameLo: string;
    nameEn: string | null;
    startDate: string;
    endDate: string;
  };
  weeks: { index: number; startDate: string; endDate: string }[];
  groups: ComplianceGroup[];
  summary: ComplianceCounts;
}

/** Statuses that mean the plan is in the reviewer's hands or already cleared. */
const REACHED_REVIEWER: ReadonlySet<ComplianceStatus> = new Set<ComplianceStatus>([
  'submitted',
  'under_review',
  'returned',
  'approved',
]);

/**
 * Composite key for a cell.
 *
 * Includes the classroom because one teacher teaching the same subject to two
 * sections owes two plans a week, and dropping it would let one cover both.
 */
export function planKey(
  teacherId: string,
  subjectId: string,
  classroomId: string,
  weekStartDate: Date | string,
): string {
  const week = weekStartDate instanceof Date ? weekKey(weekStartDate) : weekStartDate;
  return `${teacherId}|${subjectId}|${classroomId}|${week}`;
}

function emptyCounts(): ComplianceCounts {
  return {
    expected: 0,
    submitted: 0,
    approved: 0,
    draft: 0,
    missing: 0,
    late: 0,
    overdue: 0,
    withAttachments: 0,
    submissionRate: 0,
  };
}

function accumulate(counts: ComplianceCounts, cell: ComplianceCell): void {
  counts.expected += 1;
  if (cell.status === MISSING) counts.missing += 1;
  if (cell.status === 'draft') counts.draft += 1;
  if (REACHED_REVIEWER.has(cell.status)) counts.submitted += 1;
  if (cell.status === 'approved') counts.approved += 1;
  if (cell.isLate) counts.late += 1;
  if (cell.isOverdue) counts.overdue += 1;
  if (cell.attachmentCount > 0) counts.withAttachments += 1;
}

function finalize(counts: ComplianceCounts): ComplianceCounts {
  counts.submissionRate =
    counts.expected === 0 ? 0 : Math.round((counts.submitted / counts.expected) * 1000) / 10;
  return counts;
}

function addInto(target: ComplianceCounts, source: ComplianceCounts): void {
  target.expected += source.expected;
  target.submitted += source.submitted;
  target.approved += source.approved;
  target.draft += source.draft;
  target.missing += source.missing;
  target.late += source.late;
  target.overdue += source.overdue;
  target.withAttachments += source.withAttachments;
}

function buildCells(
  row: ExpectedRow,
  weeks: SemesterWeek[],
  plansByKey: Map<string, PlanFacts>,
  policy: LessonPlanPolicy,
  now: Date,
): ComplianceCell[] {
  return weeks.map((week) => {
    const plan = plansByKey.get(
      planKey(row.teacherId, row.subjectId, row.classroomId, week.startDate),
    );
    const dueDate = deriveDueDate(week.startDate, policy);
    const status: ComplianceStatus = plan?.status ?? MISSING;

    return {
      weekIndex: week.index,
      weekStartDate: weekKey(week.startDate),
      status,
      planId: plan?.id ?? null,
      // Lateness is what the plan recorded at submission, not recomputed here:
      // the deadline policy can change, and a plan that was punctual must stay
      // punctual.
      isLate: plan?.isLate ?? false,
      attachmentCount: plan?.attachmentCount ?? 0,
      activityCount: plan?.activityCount ?? 0,
      completedActivityCount: plan?.completedActivityCount ?? 0,
      dueDate: dueDate.toISOString(),
      // A draft counts as overdue: the reviewer cannot see it, so as far as
      // oversight is concerned nothing was handed in.
      isOverdue: !REACHED_REVIEWER.has(status) && dueDate < now,
    };
  });
}

export function assembleMatrix(input: {
  semester: { id: string; nameLo: string; nameEn: string | null; startDate: Date; endDate: Date };
  weeks: SemesterWeek[];
  rows: ExpectedRow[];
  groups: GroupMeta[];
  plansByKey: Map<string, PlanFacts>;
  policy: LessonPlanPolicy;
  now: Date;
}): ComplianceMatrix {
  const { semester, weeks, rows, groups, plansByKey, policy, now } = input;

  const byGroupId = new Map<string | null, ComplianceRow[]>();
  for (const row of rows) {
    const cells = buildCells(row, weeks, plansByKey, policy, now);
    const summary = finalize(
      cells.reduce((counts, cell) => {
        accumulate(counts, cell);
        return counts;
      }, emptyCounts()),
    );

    const bucket = byGroupId.get(row.subjectGroupId) ?? [];
    bucket.push({ ...row, cells, summary });
    byGroupId.set(row.subjectGroupId, bucket);
  }

  const overall = emptyCounts();

  // Groups keep their configured order; the unassigned bucket goes last, where
  // it reads as a backlog rather than as a department.
  const ordered: ComplianceGroup[] = [];
  for (const meta of groups) {
    const groupRows = byGroupId.get(meta.id);
    if (!groupRows?.length) continue;
    ordered.push(buildGroup(meta, groupRows, overall));
  }

  const unassigned = byGroupId.get(null);
  if (unassigned?.length) ordered.push(buildGroup(null, unassigned, overall));

  return {
    semester: {
      id: semester.id,
      nameLo: semester.nameLo,
      nameEn: semester.nameEn,
      startDate: semester.startDate.toISOString(),
      endDate: semester.endDate.toISOString(),
    },
    weeks: weeks.map((week) => ({
      index: week.index,
      startDate: weekKey(week.startDate),
      endDate: weekKey(week.endDate),
    })),
    groups: ordered,
    summary: finalize(overall),
  };
}

function buildGroup(
  meta: GroupMeta | null,
  groupRows: ComplianceRow[],
  overall: ComplianceCounts,
): ComplianceGroup {
  const summary = emptyCounts();
  for (const row of groupRows) addInto(summary, row.summary);
  addInto(overall, summary);

  // Worst first: the row a head needs to act on should not be the one they have
  // to scroll to find.
  const sorted = [...groupRows].sort(
    (a, b) =>
      b.summary.missing + b.summary.draft - (a.summary.missing + a.summary.draft) ||
      a.teacherName.localeCompare(b.teacherName),
  );

  return { subjectGroup: meta, rows: sorted, summary: finalize(summary) };
}
