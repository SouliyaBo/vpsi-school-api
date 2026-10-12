import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsMongoId, IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationQueryDto } from 'src/common/dto/pagination.dto';

/**
 * ຮັບສອນແທນ — a claim on one day of one timetabled lesson.
 *
 * `substituteTeacherId` is deliberately optional and deliberately *not* the
 * normal case. A teacher who finds themselves covering a colleague's period
 * claims it for themselves — that is the whole point of the endpoint, and the
 * reason the office does not have to be in the loop at 7am — so leaving it out
 * means "me". Only an account with oversight may name somebody else, which is
 * what lets the office file cover that was arranged by phone, or correct a claim
 * made under the wrong name.
 *
 * Nothing else about the lesson is accepted: the class, subject, term and school
 * year are read off the assignment, so a claim cannot describe a lesson the
 * timetable does not agree with.
 */
export class CreateLessonSubstitutionDto {
  @ApiProperty({ description: 'The timetabled lesson being covered' })
  @IsMongoId()
  teachingAssignmentId: string;

  @ApiProperty({
    example: '2026-09-30',
    description:
      'The school day covered. Normalized to UTC midnight, and must fall on a weekday the ' +
      'lesson is actually taught on.',
  })
  @IsDateString()
  date: string;

  @ApiPropertyOptional({
    description:
      'The teacher who took the lesson. Defaults to the caller, and naming anyone else ' +
      'requires `lesson-substitutions:manage`.',
  })
  @IsMongoId()
  @IsOptional()
  substituteTeacherId?: string;

  @ApiPropertyOptional({
    description: 'ເຫດຜົນ — why the timetabled teacher was away',
    example: 'ລາປ່ວຍ',
  })
  @IsString()
  @IsOptional()
  @MaxLength(300)
  reason?: string;
}

/**
 * The claim log, narrowed however it is being read.
 *
 * Three readers, three filters: a teacher checks what they are answerable for
 * (`substituteTeacherId`), a teacher checks who took their lessons
 * (`ownerTeacherId`), and the office reads a class or a date range.
 */
export class QueryLessonSubstitutionsDto extends PaginationQueryDto {
  @ApiPropertyOptional()
  @IsMongoId()
  @IsOptional()
  teachingAssignmentId?: string;

  @ApiPropertyOptional({ description: 'Claims where this teacher stood in' })
  @IsMongoId()
  @IsOptional()
  substituteTeacherId?: string;

  @ApiPropertyOptional({ description: 'Claims against this teacher’s own timetabled lessons' })
  @IsMongoId()
  @IsOptional()
  ownerTeacherId?: string;

  @ApiPropertyOptional()
  @IsMongoId()
  @IsOptional()
  classroomId?: string;

  @ApiPropertyOptional()
  @IsMongoId()
  @IsOptional()
  semesterId?: string;

  @ApiPropertyOptional({ example: '2026-09-01', description: 'Inclusive lower bound' })
  @IsDateString()
  @IsOptional()
  from?: string;

  @ApiPropertyOptional({ example: '2026-09-30', description: 'Inclusive upper bound' })
  @IsDateString()
  @IsOptional()
  to?: string;
}

/**
 * Whether the caller may claim a given lesson-day, and until when.
 *
 * What the roll-call screen asks before it decides between a save button and a
 * "ຂ້ອຍສອນແທນຄາບນີ້" one. Returned rather than inferred in the client because the
 * deadline is the school calendar's answer — the next *working* day, holidays and
 * closures included — and a second implementation of it in the browser would
 * disagree with the server exactly on the days that matter.
 */
export class LessonClaimabilityDto {
  @ApiProperty({ description: 'The caller already holds this lesson, by timetable or by claim' })
  canRecord: boolean;

  @ApiProperty({ description: 'A claim would be accepted right now' })
  canClaim: boolean;

  @ApiProperty({ nullable: true, description: 'Why not, as a message key' })
  blockedBy: string | null;

  @ApiProperty({
    nullable: true,
    description: 'The instant the claim window shuts — noon of the next working day',
  })
  claimableUntil: string | null;

  @ApiProperty({ nullable: true, description: 'Who already holds cover for this lesson-day' })
  claimedByTeacherId: string | null;
}
