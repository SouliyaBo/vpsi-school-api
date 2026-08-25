import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsDateString, IsMongoId, IsOptional } from 'class-validator';

/**
 * The window a "who has not filled this in" report is read for.
 *
 * Shared by the behaviour register and the roll call, which ask the same question
 * of the same timetable and differ only in which log they measure against it.
 *
 * Every field is optional so the plain call answers the question that is asked
 * almost every time — "this week, the whole school" — without the client having
 * to work out which Monday it is or which semester is active.
 *
 * `date` and `weekOf` are the same question asked one day wide or seven: a week's
 * totals cannot say who wrote nothing *on Monday*, because an entry made on
 * Tuesday counts towards the same week.
 */
export class CoverageQueryDto {
  @ApiPropertyOptional({
    example: '2025-11-06',
    description:
      'Any date in the week. Defaults to today; snapped to the Monday of that week. With no ' +
      '`semesterId`, the term is taken from the week itself, so a date in an earlier term ' +
      'reports against that term rather than the active one.',
  })
  @IsDateString()
  @IsOptional()
  weekOf?: string;

  @ApiPropertyOptional({
    example: '2025-11-06',
    description:
      'One single day. Takes precedence over `weekOf`: the report then counts only the ' +
      'lessons timetabled on that date and only the entries made on it.',
  })
  @IsDateString()
  @IsOptional()
  date?: string;

  @ApiPropertyOptional({ description: 'Defaults to the term the requested window falls in' })
  @IsMongoId()
  @IsOptional()
  semesterId?: string;

  @ApiPropertyOptional() @IsMongoId() @IsOptional() classroomId?: string;

  @ApiPropertyOptional({ description: 'The teacher the timetable names for the lesson' })
  @IsMongoId()
  @IsOptional()
  teacherId?: string;

  @ApiPropertyOptional({
    description:
      'Return only the lessons with nothing recorded. The summary still counts the whole ' +
      'window, so the headline numbers do not move when the list is narrowed.',
  })
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  @IsOptional()
  outstandingOnly?: boolean;
}
