import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsMongoId, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * ສົ່ງມອບການສອນ — one teacher's posts passed to another.
 *
 * The flags are all opt-out rather than opt-in, because the case this exists for
 * is a teacher who has left and a replacement who starts on Monday: the office
 * wants the whole lot moved, and anything they have to remember to tick is
 * something they will forget on the day they are busiest. The flags are there for
 * the partial cases — a teacher going on leave who keeps their homeroom, or a
 * handover of lessons only while the office decides about the room.
 */
export class TeacherHandoverDto {
  @ApiProperty({ description: 'The teacher taking the work on' })
  @IsMongoId()
  toTeacherId: string;

  @ApiPropertyOptional({
    default: true,
    description:
      'Deactivate the outgoing teacher’s active lessons and recreate them under the incoming ' +
      'one, same subject, class, term and periods.',
  })
  @IsBoolean()
  @IsOptional()
  assignments?: boolean;

  @ApiPropertyOptional({
    default: true,
    description: 'Move every ຄູປະຈຳຫ້ອງ post, recording the change in the room’s history.',
  })
  @IsBoolean()
  @IsOptional()
  homerooms?: boolean;

  @ApiPropertyOptional({
    default: false,
    description:
      'Move the headship of any ສາຍວິຊາ they run. Off by default: who the next head is, is ' +
      'the office’s decision rather than a consequence of somebody leaving.',
  })
  @IsBoolean()
  @IsOptional()
  subjectGroups?: boolean;

  @ApiPropertyOptional({
    default: true,
    description:
      'Also set the outgoing teacher to `resigned`. Off for a handover that is temporary.',
  })
  @IsBoolean()
  @IsOptional()
  resign?: boolean;

  @ApiPropertyOptional({
    description: 'ເຫດຜົນ — kept on the room’s homeroom history and in the audit trail',
    example: 'ຄູລາອອກກາງເທີມ',
  })
  @IsString()
  @IsOptional()
  @MaxLength(300)
  note?: string;
}

/** What actually moved, so the office can check it against what they expected. */
export class TeacherHandoverResultDto {
  @ApiProperty() fromTeacherId: string;
  @ApiProperty() toTeacherId: string;
  @ApiProperty({
    description: 'Lessons closed under the outgoing teacher and reopened under the incoming one',
  })
  assignmentsMoved: number;
  @ApiProperty({ description: 'ຄູປະຈຳຫ້ອງ posts moved' })
  homeroomsMoved: number;
  @ApiProperty() subjectGroupsMoved: number;
  @ApiProperty({ description: 'Whether the outgoing teacher was set to `resigned`' })
  resigned: boolean;
}
