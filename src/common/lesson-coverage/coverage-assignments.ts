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
  scope: { teacherId?: string | null; classroomId?: string | null } = {},
): Promise<CoverageAssignment[]> {
  const filter: Record<string, unknown> = { semesterId, isActive: true, deletedAt: null };
  if (scope.teacherId) filter.teacherId = new Types.ObjectId(scope.teacherId);
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
    });
  }

  return rows;
}
