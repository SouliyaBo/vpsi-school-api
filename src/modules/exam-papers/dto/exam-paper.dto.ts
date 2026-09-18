import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsMongoId,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { EXAM_OPTION_LABEL_STYLES, ExamOptionLabelStyle } from 'src/common/constants/enums';
import { PaginationQueryDto } from 'src/common/dto/pagination.dto';
import { MAX_VARIANTS, VARIANT_LABELS } from '../variants';

/** `"null"` and `""` from a multipart form both mean "none". */
const emptyToNull = ({ value }: { value: unknown }) =>
  value === '' || value === 'null' || value === undefined ? null : value;

export class UploadExamPaperDto {
  @ApiPropertyOptional({ description: 'Defaults to the file name without its extension' })
  @IsString()
  @MaxLength(200)
  @IsOptional()
  title?: string;

  @ApiPropertyOptional({ nullable: true })
  @Transform(emptyToNull)
  @ValidateIf((_, value) => value !== null)
  @IsMongoId()
  @IsOptional()
  subjectId?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @Transform(emptyToNull)
  @ValidateIf((_, value) => value !== null)
  @IsMongoId()
  @IsOptional()
  classroomId?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @Transform(emptyToNull)
  @ValidateIf((_, value) => value !== null)
  @IsMongoId()
  @IsOptional()
  semesterId?: string | null;
}

/** A picture the paper already holds, sent back unchanged from the review page. */
export class ExamImageDto {
  @ApiProperty()
  @IsString()
  @MaxLength(300)
  key: string;

  @ApiProperty()
  @IsString()
  @MaxLength(60)
  mimeType: string;

  @ApiProperty()
  @IsInt()
  @Min(1)
  @Max(5000)
  widthPt: number;

  @ApiProperty()
  @IsInt()
  @Min(1)
  @Max(5000)
  heightPt: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(-500)
  @Max(500)
  descentPt?: number;
}

export class ExamOptionDto {
  @ApiProperty()
  @IsString()
  @MaxLength(2000)
  text: string;

  @ApiPropertyOptional({ type: [ExamImageDto] })
  @IsArray()
  @ArrayMaxSize(4)
  @ValidateNested({ each: true })
  @Type(() => ExamImageDto)
  @IsOptional()
  images?: ExamImageDto[];
}

export class ExamQuestionDto {
  @ApiProperty({ description: 'The question’s stable key, as read back' })
  @IsString()
  @MaxLength(40)
  key: string;

  @ApiPropertyOptional({ nullable: true, description: 'ພາກ — the part heading, if any' })
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(300)
  @IsOptional()
  section?: string | null;

  @ApiProperty()
  @IsString()
  @MaxLength(4000)
  text: string;

  @ApiPropertyOptional({ type: [ExamImageDto] })
  @IsArray()
  @ArrayMaxSize(6)
  @ValidateNested({ each: true })
  @Type(() => ExamImageDto)
  @IsOptional()
  images?: ExamImageDto[];

  @ApiProperty({ type: [ExamOptionDto] })
  @IsArray()
  @ArrayMaxSize(8)
  @ValidateNested({ each: true })
  @Type(() => ExamOptionDto)
  options: ExamOptionDto[];

  @ApiPropertyOptional({ nullable: true, description: 'Index of the right option' })
  @ValidateIf((_, value) => value !== null)
  @IsInt()
  @Min(0)
  @Max(7)
  @IsOptional()
  correctIndex?: number | null;

  @ApiPropertyOptional({ description: 'Keep the options in this order in every set' })
  @IsBoolean()
  @IsOptional()
  lockOptions?: boolean;
}

export class UpdateExamPaperDto {
  @ApiPropertyOptional()
  @IsString()
  @MaxLength(200)
  @IsOptional()
  title?: string;

  @ApiPropertyOptional({ nullable: true })
  @ValidateIf((_, value) => value !== null)
  @IsMongoId()
  @IsOptional()
  subjectId?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @ValidateIf((_, value) => value !== null)
  @IsMongoId()
  @IsOptional()
  classroomId?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @ValidateIf((_, value) => value !== null)
  @IsMongoId()
  @IsOptional()
  semesterId?: string | null;

  @ApiPropertyOptional({ description: 'The header printed above the questions' })
  @IsString()
  @MaxLength(4000)
  @IsOptional()
  preamble?: string;

  @ApiPropertyOptional({ enum: EXAM_OPTION_LABEL_STYLES })
  @IsIn(EXAM_OPTION_LABEL_STYLES as readonly string[])
  @IsOptional()
  optionLabelStyle?: ExamOptionLabelStyle;

  @ApiPropertyOptional({
    nullable: true,
    description: 'What the paper is out of; every question is worth the same share',
  })
  @ValidateIf((_, value) => value !== null)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(1000)
  @IsOptional()
  totalPoints?: number | null;

  @ApiPropertyOptional({ type: [ExamQuestionDto], description: 'The whole list, in order' })
  @IsArray()
  @ArrayMaxSize(300)
  @ValidateNested({ each: true })
  @Type(() => ExamQuestionDto)
  @IsOptional()
  questions?: ExamQuestionDto[];
}

export class GenerateVariantsDto {
  @ApiProperty({ minimum: 1, maximum: MAX_VARIANTS, example: 4 })
  @IsInt()
  @Min(1)
  @Max(MAX_VARIANTS)
  count: number;

  @ApiPropertyOptional({ default: true, description: 'Shuffle the options too' })
  @IsBoolean()
  @IsOptional()
  shuffleOptions?: boolean;

  @ApiPropertyOptional({
    description: 'Re-draw the same sets from an earlier seed; omitted, a new one is drawn',
  })
  @IsInt()
  @Min(0)
  @IsOptional()
  seed?: number;
}

export class QueryExamPapersDto extends PaginationQueryDto {
  @ApiPropertyOptional()
  @IsMongoId()
  @IsOptional()
  subjectId?: string;

  @ApiPropertyOptional()
  @IsMongoId()
  @IsOptional()
  classroomId?: string;

  @ApiPropertyOptional()
  @IsMongoId()
  @IsOptional()
  semesterId?: string;

  @ApiPropertyOptional({ description: 'Only the office can ask for somebody else’s' })
  @IsMongoId()
  @IsOptional()
  createdById?: string;
}

export class ExportSetsQueryDto {
  @ApiPropertyOptional({ enum: ['pdf', 'docx'], default: 'pdf' })
  @IsIn(['pdf', 'docx'])
  @IsOptional()
  format: 'pdf' | 'docx' = 'pdf';

  @ApiPropertyOptional({
    description: 'One set by its letter, or `all` for every set in one file',
    enum: [...VARIANT_LABELS, 'all'],
    default: 'all',
  })
  @IsIn([...VARIANT_LABELS, 'all'])
  @IsOptional()
  set: string = 'all';
}

export class SeatPlanQueryDto {
  @ApiPropertyOptional({ description: 'Defaults to the paper’s classroom' })
  @IsMongoId()
  @IsOptional()
  classroomId?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 12, default: 4, description: 'Seats per row' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(12)
  @IsOptional()
  columns: number = 4;
}

export class AnswerSheetsQueryDto extends SeatPlanQueryDto {
  @ApiPropertyOptional({
    minimum: 0,
    maximum: 50,
    default: 0,
    description: 'Blank sheets to add after the named ones — spares for the room',
  })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(50)
  @IsOptional()
  blank: number = 0;

  @ApiPropertyOptional({
    description: 'Only blank sheets — no classroom needed',
    default: false,
  })
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  @IsOptional()
  blankOnly: boolean = false;
}

export class ResponsesQueryDto {
  @ApiPropertyOptional({ description: 'Defaults to the paper’s classroom' })
  @IsMongoId()
  @IsOptional()
  classroomId?: string;
}

export class SaveResponseDto {
  @ApiProperty({ description: 'The set the pupil sat — `A`, `B` …' })
  @IsIn([...VARIANT_LABELS])
  setLabel: string;

  @ApiProperty({
    type: [Number],
    description:
      'Per printed question, the letter marked as an index (0 = A), or `null` for a blank. ' +
      'Shorter than the paper is padded with blanks.',
  })
  @IsArray()
  @ArrayMaxSize(300)
  answers: (number | null)[];
}

export class PushToMonthlyMarksDto {
  @ApiPropertyOptional({ description: 'Defaults to the paper’s classroom' })
  @IsMongoId()
  @IsOptional()
  classroomId?: string;

  @ApiProperty({ minimum: 1, maximum: 12, description: 'The month the ກວດກາ column belongs to' })
  @IsInt()
  @Min(1)
  @Max(12)
  month: number;

  @ApiPropertyOptional({ description: 'Required to amend a month already submitted' })
  @IsString()
  @MaxLength(300)
  @IsOptional()
  overrideReason?: string;
}

export class UpdateScanDto {
  @ApiPropertyOptional({ nullable: true })
  @ValidateIf((_, value) => value !== null)
  @IsMongoId()
  @IsOptional()
  studentId?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @ValidateIf((_, value) => value !== null)
  @IsIn([...VARIANT_LABELS])
  @IsOptional()
  setLabel?: string | null;

  @ApiPropertyOptional({
    type: [Number],
    description: 'Per printed question, letter index or null',
  })
  @IsArray()
  @ArrayMaxSize(300)
  @IsOptional()
  answers?: (number | null)[];

  @ApiPropertyOptional({ description: 'Write the sheet as the pupil’s response' })
  @IsBoolean()
  @IsOptional()
  confirm?: boolean;
}

export class ScansQueryDto {
  @ApiPropertyOptional({ enum: ['pending', 'confirmed', 'failed'] })
  @IsIn(['pending', 'confirmed', 'failed'])
  @IsOptional()
  status?: 'pending' | 'confirmed' | 'failed';
}
