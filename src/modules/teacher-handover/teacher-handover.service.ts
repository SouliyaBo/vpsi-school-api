import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import { AppException } from 'src/common/exceptions/app.exception';
import type { CrudContext } from 'src/common/services/base-crud.service';
import {
  Semester,
  SemesterDocument,
  SubjectGroup,
  SubjectGroupDocument,
  Teacher,
  TeacherDocument,
  TeachingAssignment,
  TeachingAssignmentDocument,
} from 'src/database/schemas';
import { TransactionHelper } from 'src/database/transaction.helper';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { ClassroomsService } from '../classrooms/classrooms.service';
import { findScheduleConflicts } from '../teaching-assignments/schedule-conflict';
import { TeachersService } from '../teachers/teachers.service';
import { TeacherHandoverDto, TeacherHandoverResultDto } from './dto/teacher-handover.dto';

/**
 * ການສົ່ງມອບການສອນ — a teacher's posts passed to the one taking over.
 *
 * This exists because the school had a teacher leave mid-term, and the system's
 * answer was a checklist: close each lesson, create each lesson again under the
 * new name, move the homeroom, suspend the account, set the status. Six or seven
 * writes across three screens, in an order that matters — create a lesson before
 * closing the old one and the clash check refuses it — with the failure mode of
 * each omission being silent. A homeroom nobody moved keeps the departed teacher's
 * name on the ວັນພຸດ/ວັນສຸກ report forever and sends its reminders to an account
 * that cannot sign in.
 *
 * Three things it deliberately does **not** do:
 *
 * - **It does not touch history.** The registers, marks, reviews and lesson plans
 *   the outgoing teacher wrote keep their name. The timetable entry they taught
 *   under is closed rather than edited — `teacherId` is not editable on an
 *   assignment at all, and that is right: every coverage and punctuality figure
 *   is derived per day from the assignment's teacher, so rewriting it would hand
 *   the incoming teacher a term of somebody else's unmarked registers.
 * - **It does not reach into a closed term.** A closed term's timetable is a
 *   record, not a plan.
 * - **It does not promote.** `isAcademicHead` and a ສາຍວິຊາ headship are standings
 *   on a person, not posts attached to a class; the headship moves only when the
 *   office says so, and the flag never moves at all.
 *
 * Everything runs in one transaction, so a handover is whole or it never happened.
 */
@Injectable()
export class TeacherHandoverService {
  constructor(
    @InjectModel(TeachingAssignment.name)
    private readonly assignmentModel: Model<TeachingAssignmentDocument>,
    @InjectModel(Semester.name) private readonly semesterModel: Model<SemesterDocument>,
    @InjectModel(SubjectGroup.name)
    private readonly subjectGroupModel: Model<SubjectGroupDocument>,
    @InjectModel(Teacher.name) private readonly teacherModel: Model<TeacherDocument>,
    private readonly teachers: TeachersService,
    private readonly classrooms: ClassroomsService,
    private readonly tx: TransactionHelper,
    private readonly audit: AuditLogsService,
  ) {}

  async handOver(
    fromTeacherId: string,
    dto: TeacherHandoverDto,
    context: CrudContext,
  ): Promise<TeacherHandoverResultDto> {
    const [outgoing, incoming] = await Promise.all([
      this.teachers.findOneOrFail(fromTeacherId),
      this.teachers.findOneOrFail(dto.toTeacherId),
    ]);

    if (outgoing._id.equals(incoming._id)) {
      throw AppException.badRequest('teacher.handoverToSelf');
    }
    // The point of a handover is that somebody is there to take it on. Handing a
    // timetable to a teacher who has themselves resigned would move the problem
    // rather than solve it, and the next report would look identical.
    if (incoming.status !== 'active') {
      throw AppException.badRequest('teacher.handoverTargetInactive', {
        status: incoming.status,
      });
    }

    const moveAssignments = dto.assignments ?? true;
    const moveHomerooms = dto.homerooms ?? true;
    const moveSubjectGroups = dto.subjectGroups ?? false;
    const resign = dto.resign ?? true;

    const held = await this.teachers.commitments(fromTeacherId);
    const movable = moveAssignments ? await this.openAssignments(outgoing._id) : [];
    const homerooms = moveHomerooms ? held.homerooms : [];
    const subjectGroups = moveSubjectGroups ? held.subjectGroups : [];

    if (movable.length === 0 && homerooms.length === 0 && subjectGroups.length === 0) {
      throw AppException.badRequest('teacher.nothingToHandOver');
    }

    if (movable.length > 0) await this.assertIncomingIsFree(incoming._id, movable);

    await this.tx.run(async (session) => {
      const scoped: CrudContext = { ...context, session };

      for (const assignment of movable) {
        // Closed first, then reopened. Not an edit of `teacherId`, which the
        // assignment DTO refuses on purpose — see this class's own note.
        await this.assignmentModel
          .updateOne({ _id: assignment._id }, { $set: { isActive: false } })
          .session(session)
          .exec();

        await this.assignmentModel.create(
          [
            {
              teacherId: incoming._id,
              subjectId: assignment.subjectId,
              classroomId: assignment.classroomId,
              semesterId: assignment.semesterId,
              schoolYearId: assignment.schoolYearId,
              schedule: assignment.schedule,
              notes: dto.note?.trim() || assignment.notes || null,
            },
          ],
          { session },
        );
      }

      for (const room of homerooms) {
        await this.classrooms.setHomeroomTeacher(room.id, incoming._id, scoped, {
          note: dto.note?.trim() || null,
        });
      }

      for (const group of subjectGroups) {
        await this.subjectGroupModel
          .updateOne(
            { _id: new Types.ObjectId(group.id) },
            { $set: { headTeacherId: incoming._id } },
          )
          .session(session)
          .exec();
      }

      if (resign) {
        // The status is a label — nothing in the system reads it to change
        // behaviour — so it is set *after* the posts have actually moved. Set
        // before, it would read as a teacher who had been dealt with while their
        // timetable was still live.
        await this.teacherModel
          .updateOne({ _id: outgoing._id }, { $set: { status: 'resigned' } })
          .session(session)
          .exec();
      }

      await this.audit.record(
        {
          action: 'update',
          entityType: 'teachers',
          entityId: outgoing._id.toString(),
          userId: context.actor?.sub,
          username: context.actor?.username,
          oldValue: { status: outgoing.status },
          newValue: {
            handedOverTo: incoming._id.toString(),
            assignments: movable.map((assignment) => assignment._id.toString()),
            homerooms: homerooms.map((room) => room.id),
            subjectGroups: subjectGroups.map((group) => group.id),
            resigned: resign,
          },
          ip: context.ip,
          reason: dto.note?.trim() || null,
        },
        session,
      );
    });

    return {
      fromTeacherId: outgoing._id.toString(),
      toTeacherId: incoming._id.toString(),
      assignmentsMoved: movable.length,
      homeroomsMoved: homerooms.length,
      subjectGroupsMoved: subjectGroups.length,
      resigned: resign,
    };
  }

  /**
   * The teacher's live lessons in terms that are still open.
   *
   * A closed term is left alone: its timetable is the record of what was taught,
   * and every write against it is refused elsewhere anyway.
   */
  private async openAssignments(
    teacherId: Types.ObjectId,
    session?: ClientSession,
  ): Promise<TeachingAssignmentDocument[]> {
    const assignments = await this.assignmentModel
      .find({ teacherId, isActive: true, deletedAt: null })
      .session(session ?? null)
      .exec();
    if (assignments.length === 0) return [];

    const openTerms = await this.semesterModel
      .find({
        _id: { $in: [...new Set(assignments.map((a) => a.semesterId.toString()))] },
        status: { $ne: 'closed' },
        deletedAt: null,
      })
      .select('_id')
      .lean()
      .exec();

    const open = new Set(openTerms.map((term) => term._id.toString()));
    return assignments.filter((assignment) => open.has(assignment.semesterId.toString()));
  }

  /**
   * Refuses the handover if the incoming teacher cannot actually take these lessons.
   *
   * Two ways they cannot, and both are refused whole rather than skipped: half a
   * timetable moved is a timetable nobody can read.
   *
   * Checked against the incoming teacher's **own** lessons only, which is
   * sufficient and not a shortcut. A classroom or physical-room clash would mean
   * two lessons already overlapping on the existing timetable, and the clash check
   * refused those when they were created — so the only constraint a change of
   * teacher can newly break is the one about the teacher.
   */
  private async assertIncomingIsFree(
    incomingId: Types.ObjectId,
    moving: TeachingAssignmentDocument[],
  ): Promise<void> {
    const semesterIds = [...new Set(moving.map((a) => a.semesterId.toString()))].map(
      (id) => new Types.ObjectId(id),
    );

    const theirs = await this.assignmentModel
      .find({
        teacherId: incomingId,
        semesterId: { $in: semesterIds },
        isActive: true,
        deletedAt: null,
      })
      .select('subjectId classroomId semesterId schedule')
      .lean()
      .exec();

    // Already teaching the same subject to the same class this term: the unique
    // index would refuse a second row, and merging the two timetables is a
    // judgement nobody should make on the office's behalf. Named so the office
    // knows to add the periods to the lesson they already have.
    for (const assignment of moving) {
      const duplicate = theirs.find(
        (existing) =>
          existing.subjectId.equals(assignment.subjectId) &&
          existing.classroomId.equals(assignment.classroomId) &&
          existing.semesterId.equals(assignment.semesterId),
      );
      if (duplicate) {
        throw AppException.conflict('assignment.alreadyAssigned', {
          assignmentId: duplicate._id.toString(),
          subjectId: assignment.subjectId.toString(),
          classroomId: assignment.classroomId.toString(),
        });
      }
    }

    // Double-booking the incoming teacher — including against another lesson in
    // the same handover, which is why the batch grows as it is checked.
    const candidates = theirs.map((existing) => ({
      id: existing._id.toString(),
      teacherId: incomingId.toString(),
      classroomId: existing.classroomId.toString(),
      schedule: existing.schedule,
    }));

    for (const assignment of moving) {
      const conflicts = findScheduleConflicts(
        {
          teacherId: incomingId.toString(),
          classroomId: assignment.classroomId.toString(),
          schedule: assignment.schedule,
        },
        candidates,
      ).filter((conflict) => conflict.kind === 'teacher');

      if (conflicts.length > 0) {
        throw AppException.conflict('assignment.teacherConflict', { conflicts });
      }

      candidates.push({
        id: assignment._id.toString(),
        teacherId: incomingId.toString(),
        classroomId: assignment.classroomId.toString(),
        schedule: assignment.schedule,
      });
    }
  }
}
