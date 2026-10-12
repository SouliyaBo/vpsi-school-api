import { Model, Types } from 'mongoose';
import { TeachingAssignmentDocument } from 'src/database/schemas';
import type { CoverageAssignment } from './lesson-coverage';

/**
 * The timetable side of a coverage report, read once for both of them.
 *
 * "Which lessons were supposed to happen" is the same question whether the report
 * is chasing the behaviour register or the roll call, and it is not a small read:
 * three populates, and a row dropped whenever any of them comes back empty. A
 * second copy of it would be a second place for the drop rule to drift.
 *
 * Takes the model rather than being injectable, so neither module has to grow a
 * dependency on the other and no new provider needs wiring for it.
 */
export async function loadCoverageAssignments(
  assignments: Model<TeachingAssignmentDocument>,
  semesterId: Types.ObjectId,
  scope: {
    teacherId?: string | null;
    classroomId?: string | null;
    /**
     * Lessons to include even though they are somebody else's on the timetable.
     *
     * The teacher filter selects on the *timetabled* teacher, which is the wrong
     * half of the question once a lesson can be covered: a stand-in's own report
     * would be missing exactly the lessons they are now answerable for, and the
     * reminder they get would name none of them. The caller passes the lessons
     * they covered — see `LessonAccessService.coveredAssignmentIds` — and narrows
     * the built rows back down to that teacher afterwards, because this widening
     * also pulls in the owner's share of those same lessons.
     *
     * Ignored without a `teacherId`: there is nothing to widen when the report is
     * already reading the whole school.
     */
    alsoAssignmentIds?: string[] | null;
  } = {},
): Promise<CoverageAssignment[]> {
  const filter: Record<string, unknown> = { semesterId, isActive: true, deletedAt: null };
  if (scope.teacherId) {
    const covered = (scope.alsoAssignmentIds ?? []).filter((id) => Types.ObjectId.isValid(id));
    filter.$or = [
      { teacherId: new Types.ObjectId(scope.teacherId) },
      ...(covered.length > 0
        ? [{ _id: { $in: covered.map((id) => new Types.ObjectId(id)) } }]
        : []),
    ];
  }
  if (scope.classroomId) filter.classroomId = new Types.ObjectId(scope.classroomId);

  const found = await assignments
    .find(filter)
    .populate('teacherId', 'teacherCode firstNameLo lastNameLo')
    .populate('subjectId', 'code nameLo nameEn')
    .populate({
      path: 'classroomId',
      select: 'name gradeLevelId',
      populate: { path: 'gradeLevelId', select: 'code' },
    })
    .lean()
    .exec();

  const rows: CoverageAssignment[] = [];
  for (const assignment of found) {
    const teacher = assignment.teacherId as unknown as {
      _id: Types.ObjectId;
      teacherCode?: string | null;
      firstNameLo: string;
      lastNameLo: string;
    } | null;
    const subject = assignment.subjectId as unknown as {
      _id: Types.ObjectId;
      code?: string | null;
      nameLo: string;
      nameEn?: string | null;
    } | null;
    const classroom = assignment.classroomId as unknown as {
      _id: Types.ObjectId;
      name: string;
      gradeLevelId?: { code?: string | null } | null;
    } | null;

    // A soft-deleted teacher, subject or class leaves the populate null, and a
    // gap nobody owns is not something the office can chase — so it is dropped
    // rather than reported against an empty name.
    if (!teacher || !subject || !classroom) continue;

    rows.push({
      teachingAssignmentId: assignment._id.toString(),
      teacherId: teacher._id.toString(),
      teacherCode: teacher.teacherCode ?? null,
      teacherName: `${teacher.firstNameLo} ${teacher.lastNameLo}`.trim(),
      subjectId: subject._id.toString(),
      subjectCode: subject.code ?? null,
      subjectNameLo: subject.nameLo,
      subjectNameEn: subject.nameEn ?? null,
      classroomId: classroom._id.toString(),
      classroomName: classroom.name,
      gradeLevelCode: classroom.gradeLevelId?.code ?? null,
      // Passed whole rather than reduced to weekdays: a rotating period is not
      // counted, and that rule belongs with the counting.
      schedule: assignment.schedule.map((period) => ({
        dayOfWeek: period.dayOfWeek,
        isRotating: period.isRotating,
      })),
      // What the timetable said on each earlier day, so a revision does not
      // rewrite the weeks behind it — see `CoverageAssignment.scheduleHistory`.
      scheduleHistory: (assignment.scheduleHistory ?? []).map((spell) => ({
        from: spell.from.toISOString().slice(0, 10),
        to: spell.to ? spell.to.toISOString().slice(0, 10) : null,
        schedule: spell.schedule.map((period) => ({
          dayOfWeek: period.dayOfWeek,
          isRotating: period.isRotating,
        })),
      })),
    });
  }

  return rows;
}
