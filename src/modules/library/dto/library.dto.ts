import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsMongoId,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import {
  BOOK_BORROWER_TYPES,
  BOOK_COUNT_CATEGORIES,
  BOOK_TITLE_CATEGORIES,
  BookBorrowerType,
  BookCountCategory,
  BookTitleCategory,
} from 'src/common/constants/enums';
import { PaginationQueryDto } from 'src/common/dto/pagination.dto';

// ── Counts (ຄູ່ມືຄູ / ແບບຮຽນ) ─────────────────────────────────────────────────

export class BookCountQueryDto {
  @ApiProperty({ enum: BOOK_COUNT_CATEGORIES })
  @IsIn(BOOK_COUNT_CATEGORIES)
  category: BookCountCategory;

  @ApiPropertyOptional({ description: 'Defaults to the active school year' })
  @IsMongoId()
  @IsOptional()
  schoolYearId?: string;
}

export class BookGradeCountDto {
  @ApiProperty()
  @IsMongoId()
  gradeLevelId: string;

  @ApiProperty()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  quantity: number;
}

export class BookCountRowDto {
  @ApiPropertyOptional({
    description: 'The row’s id as read; absent for a new row. Keeps its loans attached.',
  })
  @IsMongoId()
  @IsOptional()
  rowId?: string;

  @ApiProperty({ example: 'ວິຊາ ພາສາລາວ' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name: string;

  @ApiProperty({ type: [BookGradeCountDto] })
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => BookGradeCountDto)
  counts: BookGradeCountDto[];
}

/** The whole sheet, sent whole: a save replaces every row. */
export class SaveBookCountDto extends BookCountQueryDto {
  @ApiProperty({ type: [BookCountRowDto] })
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => BookCountRowDto)
  rows: BookCountRowDto[];

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  @MaxLength(2000)
  note?: string;
}

// ── Titles (ປື້ມອຸປະຖຳ / ເອກະສານອ້າງອີງ) ───────────────────────────────────────

export class QueryBookTitlesDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: BOOK_TITLE_CATEGORIES })
  @IsIn(BOOK_TITLE_CATEGORIES)
  @IsOptional()
  category?: BookTitleCategory;

  @ApiPropertyOptional({ description: 'Exact source, e.g. `Book Festival 2026`' })
  @IsString()
  @IsOptional()
  @MaxLength(200)
  source?: string;

  @ApiPropertyOptional({ description: 'Only titles with copies out on loan' })
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  @IsOptional()
  onLoan?: boolean;
}

export class CreateBookTitleDto {
  @ApiProperty({ enum: BOOK_TITLE_CATEGORIES })
  @IsIn(BOOK_TITLE_CATEGORIES)
  category: BookTitleCategory;

  @ApiProperty({ example: 'ຈົນກວ່າຟ້າຈະສົດໃສ' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(300)
  title: string;

  @ApiProperty()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  quantity: number;

  @ApiPropertyOptional({ description: 'ລາຄາ/ຫົວ, ກີບ' })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @IsOptional()
  unitPrice?: number;

  @ApiPropertyOptional({ example: 'Book Festival 2026' })
  @IsString()
  @IsOptional()
  @MaxLength(200)
  source?: string;

  @ApiPropertyOptional({ example: '2026-03-15' })
  @IsDateString()
  @IsOptional()
  acquiredOn?: string;

  @ApiPropertyOptional({ example: '2019-2020' })
  @IsString()
  @IsOptional()
  @MaxLength(20)
  academicYear?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  @MaxLength(1000)
  note?: string;
}

/** Every field optional; `null` clears a price, source, date, year or note. */
export class UpdateBookTitleDto {
  @ApiPropertyOptional({ enum: BOOK_TITLE_CATEGORIES })
  @IsIn(BOOK_TITLE_CATEGORIES)
  @IsOptional()
  category?: BookTitleCategory;

  @ApiPropertyOptional() @IsString() @IsNotEmpty() @IsOptional() @MaxLength(300) title?: string;

  @ApiPropertyOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @IsOptional()
  quantity?: number;

  @ApiPropertyOptional({ nullable: true })
  @ValidateIf((_object, value) => value !== null)
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @IsOptional()
  unitPrice?: number | null;

  @ApiPropertyOptional({ nullable: true })
  @ValidateIf((_object, value) => value !== null)
  @IsString()
  @IsOptional()
  @MaxLength(200)
  source?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @ValidateIf((_object, value) => value !== null)
  @IsDateString()
  @IsOptional()
  acquiredOn?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @ValidateIf((_object, value) => value !== null)
  @IsString()
  @IsOptional()
  @MaxLength(20)
  academicYear?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @ValidateIf((_object, value) => value !== null)
  @IsString()
  @IsOptional()
  @MaxLength(1000)
  note?: string | null;
}

// ── Loans ───────────────────────────────────────────────────────────────────

export class QueryBookLoansDto extends PaginationQueryDto {
  @ApiPropertyOptional()
  @IsMongoId()
  @IsOptional()
  bookTitleId?: string;

  @ApiPropertyOptional({ description: '`true`: still out. `false`: returned.' })
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  @IsOptional()
  outstanding?: boolean;
}

/**
 * A loan names its book one of two ways: `bookTitleId` for a title, or
 * `countSheetId` + `rowId` + `gradeLevelId` for one cell of a ຄູ່ມືຄູ / ແບບຮຽນ
 * sheet. Exactly one.
 */
export class CreateBookLoanDto {
  @ApiPropertyOptional({ description: 'A ປື້ມອຸປະຖຳ / ເອກະສານອ້າງອີງ title' })
  @IsMongoId()
  @IsOptional()
  bookTitleId?: string;

  @ApiPropertyOptional({ description: 'A ຄູ່ມືຄູ / ແບບຮຽນ sheet' })
  @IsMongoId()
  @IsOptional()
  countSheetId?: string;

  @ApiPropertyOptional({ description: 'The row on that sheet' })
  @IsMongoId()
  @IsOptional()
  rowId?: string;

  @ApiPropertyOptional({ description: 'The grade column of that row' })
  @IsMongoId()
  @IsOptional()
  gradeLevelId?: string;

  @ApiProperty({ enum: BOOK_BORROWER_TYPES })
  @IsIn(BOOK_BORROWER_TYPES)
  borrowerType: BookBorrowerType;

  @ApiPropertyOptional({ description: 'Required when `borrowerType` is `teacher`' })
  @IsMongoId()
  @IsOptional()
  teacherId?: string;

  @ApiPropertyOptional({ description: 'Required when `borrowerType` is `student`' })
  @IsMongoId()
  @IsOptional()
  studentId?: string;

  @ApiPropertyOptional({ description: 'Required when `borrowerType` is `other`' })
  @IsString()
  @IsOptional()
  @MaxLength(200)
  borrowerName?: string;

  @ApiPropertyOptional({ default: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  quantity?: number;

  @ApiProperty({ example: '2026-10-12' })
  @IsDateString()
  loanedOn: string;

  @ApiPropertyOptional()
  @IsDateString()
  @IsOptional()
  dueOn?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  @MaxLength(500)
  note?: string;
}

export class LendablesQueryDto {
  @ApiPropertyOptional({ description: 'Title or subject, any part of it' })
  @IsString()
  @IsOptional()
  @MaxLength(200)
  search?: string;
}

export class ReturnBookLoanDto {
  @ApiPropertyOptional({ description: 'Defaults to today' })
  @IsDateString()
  @IsOptional()
  returnedOn?: string;
}

// ── Workbook sales ──────────────────────────────────────────────────────────

export class WorkbookSaleQueryDto {
  @ApiPropertyOptional({ description: 'Defaults to the active school year' })
  @IsMongoId()
  @IsOptional()
  schoolYearId?: string;
}

export class WorkbookSaleLineDto {
  @ApiProperty()
  @IsMongoId()
  gradeLevelId: string;

  @ApiPropertyOptional({ example: 'ພາສາລາວ-ວັນນະຄະດີ, ເຄມີ, ຟີຊິກ, ຊີວະ, ເລກ' })
  @IsString()
  @IsOptional()
  @MaxLength(500)
  subjects?: string;

  @ApiProperty() @Type(() => Number) @IsInt() @Min(0) booksPerSet: number;
  @ApiProperty() @Type(() => Number) @IsInt() @Min(0) setsProduced: number;
  @ApiProperty() @Type(() => Number) @IsInt() @Min(0) pricePerSet: number;
}

export class WorkbookExtraSaleDto {
  @ApiPropertyOptional()
  @IsDateString()
  @IsOptional()
  date?: string;

  @ApiPropertyOptional()
  @IsMongoId()
  @IsOptional()
  gradeLevelId?: string;

  @ApiProperty({ example: 'ຂາຍເພີ່ມຕື່ມ' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(300)
  description: string;

  @ApiPropertyOptional({ description: 'Whole sets sold; 0 or absent for single books' })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @IsOptional()
  sets?: number;

  @ApiProperty({ description: 'Books handed over, a set’s books included' })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  books: number;

  @ApiProperty() @Type(() => Number) @IsInt() @Min(0) amount: number;
}

/** The whole year's sheet, sent whole. */
export class SaveWorkbookSaleDto extends WorkbookSaleQueryDto {
  @ApiProperty({ type: [WorkbookSaleLineDto] })
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => WorkbookSaleLineDto)
  lines: WorkbookSaleLineDto[];

  @ApiProperty({ type: [WorkbookExtraSaleDto] })
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => WorkbookExtraSaleDto)
  extraSales: WorkbookExtraSaleDto[];

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  @MaxLength(2000)
  note?: string;
}
