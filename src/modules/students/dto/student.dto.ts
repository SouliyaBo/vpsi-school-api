import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsMongoId,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import {
  GENDERS,
  GUARDIAN_RELATIONSHIPS,
  Gender,
  GuardianRelationship,
  STUDENT_STATUSES,
  StudentStatus,
} from 'src/common/constants/enums';
import { PaginationQueryDto } from 'src/common/dto/pagination.dto';
import { IsLaoPhone } from 'src/common/utils/phone';
import { CreateGuardianDto } from 'src/modules/guardians/dto/guardian.dto';

/**
 * Links a student to a guardian.
 *
 * Either references an existing guardian by id, or supplies a full guardian to
 * create alongside the student — both paths run in the same transaction.
 */
export class StudentGuardianInputDto {
  @ApiPropertyOptional({ description: 'Existing guardian. Omit to create one from `guardian`.' })
  @IsMongoId()
  @IsOptional()
  guardianId?: string;

  @ApiPropertyOptional({
    type: CreateGuardianDto,
    description: 'New guardian to create. Ignored when `guardianId` is given.',
  })
  @ValidateNested()
  @Type(() => CreateGuardianDto)
  @IsOptional()
  guardian?: CreateGuardianDto;

  @ApiProperty({ enum: GUARDIAN_RELATIONSHIPS })
  @IsIn(GUARDIAN_RELATIONSHIPS)
  relationship: GuardianRelationship;

  @ApiPropertyOptional({ description: 'Exactly one guardian per student must be primary' })
  @IsBoolean()
  @IsOptional()
  isPrimary?: boolean;

  @ApiPropertyOptional()
  @IsBoolean()
  @IsOptional()
  isEmergencyContact?: boolean;

  @ApiPropertyOptional({ default: true, description: 'May this guardian view academic records?' })
  @IsBoolean()
  @IsOptional()
  canViewRecords?: boolean;
}

export class CreateStudentDto {
  @ApiProperty({ example: 'S-2025-0001' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(30)
  studentCode: string;

  @ApiPropertyOptional({ example: 'ນ.', description: 'Honorific, kept out of the given name' })
  @IsString()
  @IsOptional()
  @MaxLength(20)
  title?: string;

  @ApiProperty({ example: 'ນາງ' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  firstNameLo: string;

  @ApiProperty({ example: 'ວົງສະຫວັນ' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  lastNameLo: string;

  @ApiPropertyOptional() @IsString() @IsOptional() @MaxLength(80) firstNameEn?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() @MaxLength(80) lastNameEn?: string;

  @ApiPropertyOptional({ example: 'ລິຕ້າ' })
  @IsString()
  @IsOptional()
  @MaxLength(60)
  nickname?: string;

  @ApiPropertyOptional({ example: 'RITA' })
  @IsString()
  @IsOptional()
  @MaxLength(60)
  nicknameEn?: string;

  @ApiProperty({ enum: GENDERS })
  @IsIn(GENDERS)
  gender: Gender;

  @ApiProperty({ example: '2010-05-14' })
  @IsDateString()
  dateOfBirth: string;

  @ApiPropertyOptional() @IsString() @IsOptional() @MaxLength(150) placeOfBirth?: string;
  @ApiPropertyOptional({ example: 'ລາວ' })
  @IsString()
  @IsOptional()
  @MaxLength(60)
  nationality?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() @MaxLength(60) ethnicity?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() @MaxLength(30) nationalId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsLaoPhone()
  phone?: string;

  @ApiPropertyOptional({ description: 'The number the office rings about this child' })
  @IsOptional()
  @IsLaoPhone()
  contactPhone?: string;

  @ApiPropertyOptional({ example: 'ເອື້ອຍລ້ຽງ', description: 'Who `contactPhone` reaches' })
  @IsString()
  @IsOptional()
  @MaxLength(120)
  contactName?: string;

  @ApiPropertyOptional() @IsMongoId() @IsOptional() villageId?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() @MaxLength(300) addressDetail?: string;
  @ApiPropertyOptional() @IsDateString() @IsOptional() admissionDate?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() @MaxLength(1000) notes?: string;

  @ApiPropertyOptional({
    enum: STUDENT_STATUSES,
    default: 'active',
    description: 'Defaults to `active`. Send `new` for an intake not yet placed in a class.',
  })
  @IsIn(STUDENT_STATUSES)
  @IsOptional()
  status?: StudentStatus;

  @ApiProperty({
    type: [StudentGuardianInputDto],
    description: 'At least one guardian is required',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => StudentGuardianInputDto)
  guardians: StudentGuardianInputDto[];
}

export class UpdateStudentDto {
  @ApiPropertyOptional() @IsString() @IsOptional() @MaxLength(20) title?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() @MaxLength(80) firstNameLo?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() @MaxLength(80) lastNameLo?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() @MaxLength(80) firstNameEn?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() @MaxLength(80) lastNameEn?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() @MaxLength(60) nickname?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() @MaxLength(60) nicknameEn?: string;

  @ApiPropertyOptional({ enum: GENDERS })
  @IsIn(GENDERS)
  @IsOptional()
  gender?: Gender;

  @ApiPropertyOptional() @IsDateString() @IsOptional() dateOfBirth?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() @MaxLength(150) placeOfBirth?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() @MaxLength(60) nationality?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() @MaxLength(60) ethnicity?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() @MaxLength(30) nationalId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsLaoPhone()
  phone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsLaoPhone()
  contactPhone?: string;

  @ApiPropertyOptional() @IsString() @IsOptional() @MaxLength(120) contactName?: string;

  @ApiPropertyOptional() @IsMongoId() @IsOptional() villageId?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() @MaxLength(300) addressDetail?: string;
  @ApiPropertyOptional() @IsDateString() @IsOptional() admissionDate?: string;

  @ApiPropertyOptional({ enum: STUDENT_STATUSES })
  @IsIn(STUDENT_STATUSES)
  @IsOptional()
  status?: StudentStatus;

  @ApiPropertyOptional() @IsString() @IsOptional() @MaxLength(1000) notes?: string;
}

/** Replaces the whole guardian list — simpler and safer than per-element patching. */
export class SetStudentGuardiansDto {
  @ApiProperty({ type: [StudentGuardianInputDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => StudentGuardianInputDto)
  guardians: StudentGuardianInputDto[];
}

export class QueryStudentsDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: STUDENT_STATUSES })
  @IsIn(STUDENT_STATUSES)
  @IsOptional()
  status?: StudentStatus;

  @ApiPropertyOptional({ enum: GENDERS })
  @IsIn(GENDERS)
  @IsOptional()
  gender?: Gender;

  @ApiPropertyOptional({ description: 'Exact village' })
  @IsMongoId()
  @IsOptional()
  villageId?: string;

  @ApiPropertyOptional({ description: 'Any location in the ancestry (district or province)' })
  @IsMongoId()
  @IsOptional()
  locationId?: string;

  @ApiPropertyOptional({ description: 'Students enrolled in this grade level for the active year' })
  @IsMongoId()
  @IsOptional()
  gradeLevelId?: string;

  @ApiPropertyOptional({ description: 'Students enrolled in this classroom' })
  @IsMongoId()
  @IsOptional()
  classroomId?: string;

  @ApiPropertyOptional({ description: 'Students linked to this guardian' })
  @IsMongoId()
  @IsOptional()
  guardianId?: string;

  @ApiPropertyOptional({
    description:
      'Placement filter. `false` returns only students with no active enrollment — the ' +
      'queue to place at the start of a term. `true` returns only placed students. ' +
      'Scoped to `schoolYearId`, or to the active school year when that is omitted.',
  })
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  @IsOptional()
  enrolled?: boolean;

  @ApiPropertyOptional({
    description: 'School year the placement filters apply to. Defaults to the active year.',
  })
  @IsMongoId()
  @IsOptional()
  schoolYearId?: string;
}
