import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsMongoId, IsOptional } from 'class-validator';

/**
 * The window a punctuality report is read for.
 *
 * Shared by the roll call and the behaviour register, which are judged against
 * the same deadline and differ only in whether an unwritten lesson is a gap.
 *
 * The window is a range rather than the week-or-day the coverage report takes,
 * because the two are asked at different scales. "Who has not filled this in" is
 * a question about this week, chased on a Friday; "who files late" is a habit,
 * and a habit does not show in five days — the office reviews it a term at a
 * time. So the default is the active term to date.
 */
export class TimelinessQueryDto {
  @ApiPropertyOptional({
    example: '2026-08-17',
    description: 'Inclusive. Defaults to the start of the term.',
  })
  @IsDateString()
  @IsOptional()
  from?: string;

  @ApiPropertyOptional({
    example: '2026-09-30',
    description: 'Inclusive. Defaults to today, or the end of the term once it has closed.',
  })
  @IsDateString()
  @IsOptional()
  to?: string;

  @ApiPropertyOptional({ description: 'Defaults to the term the window falls in' })
  @IsMongoId()
  @IsOptional()
  semesterId?: string;

  @ApiPropertyOptional({ description: 'The teacher the timetable names for the lesson' })
  @IsMongoId()
  @IsOptional()
  teacherId?: string;

  @ApiPropertyOptional() @IsMongoId() @IsOptional() classroomId?: string;
}
