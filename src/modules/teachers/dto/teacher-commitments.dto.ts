import { ApiProperty } from '@nestjs/swagger';
import { TEACHER_STATUSES, type TeacherStatus } from 'src/common/constants/enums';

/**
 * What a teacher still holds that a departure would leave vacant.
 *
 * Deliberately only the *posts*, not every row with their name on it. A teacher's
 * registers, marks and reviews are history and must keep their name; a timetable
 * slot and a ຄູປະຈຳຫ້ອງ post are jobs, and a school cannot run with either of
 * them empty. Those are the three the office has to do something about, so those
 * are the three this reports.
 */
export class TeacherAssignmentHoldDto {
  @ApiProperty() id: string;
  @ApiProperty() subjectNameLo: string;
  @ApiProperty() classroomName: string;
  @ApiProperty({ nullable: true, description: '`ມ.4` — so a section letter reads unambiguously' })
  gradeLevelCode: string | null;
  @ApiProperty() semesterNameLo: string;
  /** Periods a week, which is what makes a slot big or small to refill. */
  @ApiProperty() periods: number;
}

export class TeacherHomeroomHoldDto {
  @ApiProperty() id: string;
  @ApiProperty() name: string;
  @ApiProperty({ nullable: true }) gradeLevelCode: string | null;
  /** How many children stop being reviewed if the post is left vacant. */
  @ApiProperty() studentCount: number;
}

export class TeacherSubjectGroupHoldDto {
  @ApiProperty() id: string;
  @ApiProperty() code: string;
  @ApiProperty() nameLo: string;
}

export class TeacherCommitmentsDto {
  @ApiProperty() teacherId: string;
  @ApiProperty({ enum: TEACHER_STATUSES }) status: TeacherStatus;
  /**
   * Heads an academic department — gates lesson-plan approval.
   *
   * Reported but not moved by a handover: it is a standing on the person rather
   * than a post attached to a class, and who the next head is, is the office's
   * decision and not a consequence of one teacher leaving.
   */
  @ApiProperty() isAcademicHead: boolean;
  /**
   * Whether they can still sign in.
   *
   * On the same screen because the two halves of a departure are usually done on
   * different days by different people: the account is suspended the moment
   * somebody leaves, and the posts are moved when the replacement arrives.
   */
  @ApiProperty() hasActiveAccount: boolean;
  @ApiProperty({ type: [TeacherAssignmentHoldDto] })
  assignments: TeacherAssignmentHoldDto[];
  @ApiProperty({ type: [TeacherHomeroomHoldDto] })
  homerooms: TeacherHomeroomHoldDto[];
  @ApiProperty({ type: [TeacherSubjectGroupHoldDto] })
  subjectGroups: TeacherSubjectGroupHoldDto[];
}
