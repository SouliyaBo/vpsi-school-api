import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsInt,
  IsMongoId,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { GUARDIAN_REPORT_SECTIONS, type GuardianReportSection } from '../guardian-report-rules';

/** The month a draft or a report is about. */
export class GuardianReportDraftQueryDto {
  @ApiProperty()
  @IsMongoId()
  studentId: string;

  @ApiProperty({ example: 10, description: 'Calendar month 1–12, inside the term' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(12)
  month: number;

  @ApiPropertyOptional({ description: 'Defaults to the active semester' })
  @IsMongoId()
  @IsOptional()
  semesterId?: string;
}

/**
 * ສົ່ງລາຍງານຫາຜູ້ປົກຄອງ.
 *
 * The request names what to include, never the figures: the report is assembled
 * again on the server from the same reads the draft showed, so a client cannot
 * send a guardian marks the register does not hold. `behaviorLogIds` is the one
 * choice of content the teacher makes row by row — a diary entry can name another
 * child, and only the teacher can tell.
 */
export class CreateGuardianReportDto extends GuardianReportDraftQueryDto {
  @ApiProperty({ description: 'The guardian it is addressed to — their phone opens it' })
  @IsMongoId()
  guardianId: string;

  @ApiProperty({ enum: GUARDIAN_REPORT_SECTIONS, isArray: true })
  @IsArray()
  @ArrayUnique()
  @IsIn(GUARDIAN_REPORT_SECTIONS, { each: true })
  sections: GuardianReportSection[];

  @ApiPropertyOptional({
    type: [String],
    description: 'With `behavior`: the register entries to send, from the draft',
  })
  @IsArray()
  @ArrayMaxSize(200)
  @IsMongoId({ each: true })
  @IsOptional()
  behaviorLogIds?: string[];

  @ApiPropertyOptional({
    description: 'ຂໍ້ຄວາມຈາກຄູ',
    example: 'ນ້ອງຕັ້ງໃຈຮຽນດີຂຶ້ນຫຼາຍໃນເດືອນນີ້',
  })
  @IsString()
  @IsOptional()
  @MaxLength(1000)
  message?: string;
}

export class QueryGuardianReportsDto {
  @ApiProperty()
  @IsMongoId()
  studentId: string;
}

/** What the guardian's page posts. The token comes from the link's `#fragment`. */
export class OpenGuardianReportDto {
  @ApiProperty({ description: 'The token from the link' })
  @IsString()
  @MaxLength(64)
  token: string;

  @ApiProperty({ example: '1234', description: 'The last four digits of the guardian’s phone' })
  @IsString()
  @MaxLength(16)
  pin: string;
}
