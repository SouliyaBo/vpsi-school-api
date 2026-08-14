import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsEmail,
  IsIn,
  IsInt,
  IsMongoId,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import {
  GENDERS,
  Gender,
  HOUSING_TYPES,
  HousingType,
  MARITAL_STATUSES,
  MaritalStatus,
  TEACHER_STATUSES,
  TeacherStatus,
} from 'src/common/constants/enums';
import { PaginationQueryDto } from 'src/common/dto/pagination.dto';
import { IsLaoPhone } from 'src/common/utils/phone';

export class PlaceOfBirthDto {
  @ApiPropertyOptional({ example: 'ພັນໝັ້ນ' })
  @IsString()
  @IsOptional()
  @MaxLength(100)
  village?: string;

  @ApiPropertyOptional({ example: 'ສີສັດຕະນາກ' })
  @IsString()
  @IsOptional()
  @MaxLength(100)
  district?: string;

  @ApiPropertyOptional({ example: 'ນະຄອນຫຼວງວຽງຈັນ' })
  @IsString()
  @IsOptional()
  @MaxLength(100)
  province?: string;
}

export class TeacherEducationDto {
  @ApiPropertyOptional({ description: 'Institution attended', example: 'ມ.ຊ' })
  @IsString()
  @IsOptional()
  @MaxLength(150)
  institution?: string;

  @ApiPropertyOptional({ description: 'Academic year completed', example: '2016-2017' })
  @IsString()
  @IsOptional()
  @MaxLength(20)
  graduatedYear?: string;
}

export class TeacherParentDto {
  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  @MaxLength(120)
  fullNameLo?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  @MaxLength(300)
  address?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  @MaxLength(100)
  occupation?: string;
}

export class CreateTeacherDto {
  @ApiPropertyOptional({
    example: 'T-2627-001',
    description:
      'Omit to have one generated for the active school year — T-2627-001 for 2026-2027. ' +
      'Supply one only to preserve a code the school already issued.',
  })
  @IsString()
  @IsOptional()
  @IsNotEmpty()
  @MaxLength(30)
  teacherCode?: string;

  @ApiPropertyOptional({ description: 'Honorific as written', example: 'ນ.' })
  @IsString()
  @IsOptional()
  @MaxLength(20)
  title?: string;

  @ApiProperty({ example: 'ສົມສັກ' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  firstNameLo: string;

  @ApiProperty({ example: 'ພົມມະຈັນ' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  lastNameLo: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  @MaxLength(80)
  firstNameEn?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  @MaxLength(80)
  lastNameEn?: string;

  @ApiProperty({ enum: GENDERS })
  @IsIn(GENDERS)
  gender: Gender;

  @ApiPropertyOptional()
  @IsDateString()
  @IsOptional()
  dateOfBirth?: string;

  @ApiPropertyOptional({ example: 'ລາວລຸ່ມ' })
  @IsString()
  @IsOptional()
  @MaxLength(60)
  ethnicity?: string;

  @ApiPropertyOptional({ type: PlaceOfBirthDto })
  @ValidateNested()
  @Type(() => PlaceOfBirthDto)
  @IsOptional()
  placeOfBirth?: PlaceOfBirthDto;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  @MaxLength(30)
  nationalId?: string;

  @ApiPropertyOptional({ example: '02012345678' })
  @IsOptional()
  @IsLaoPhone()
  phone?: string;

  @ApiPropertyOptional()
  @IsEmail()
  @IsOptional()
  email?: string;

  @ApiPropertyOptional()
  @IsMongoId()
  @IsOptional()
  villageId?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  @MaxLength(300)
  addressDetail?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  @MaxLength(150)
  qualification?: string;

  @ApiPropertyOptional({ description: 'Field of study', example: 'ຄູຄະນິດສາດ' })
  @IsString()
  @IsOptional()
  @MaxLength(150)
  specialization?: string;

  @ApiPropertyOptional({ type: TeacherEducationDto })
  @ValidateNested()
  @Type(() => TeacherEducationDto)
  @IsOptional()
  education?: TeacherEducationDto;

  @ApiPropertyOptional({ type: [String], example: ['ເຄມີສາດ', 'ວິທະຍາສາດທຳມະຊາດ'] })
  @IsArray()
  @IsString({ each: true })
  @MaxLength(80, { each: true })
  @IsOptional()
  teachingSubjects?: string[];

  @ApiPropertyOptional({ description: 'Ministry professional grade', example: 'P' })
  @IsString()
  @IsOptional()
  @MaxLength(20)
  professionalLevel?: string;

  @ApiPropertyOptional()
  @IsDateString()
  @IsOptional()
  hireDate?: string;

  @ApiPropertyOptional({ description: 'Entry into public service' })
  @IsDateString()
  @IsOptional()
  joinedOrgDate?: string;

  @ApiPropertyOptional({ enum: MARITAL_STATUSES })
  @IsIn(MARITAL_STATUSES)
  @IsOptional()
  maritalStatus?: MaritalStatus;

  @ApiPropertyOptional({ minimum: 0, maximum: 30 })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(30)
  @IsOptional()
  childrenCount?: number;

  @ApiPropertyOptional({ enum: HOUSING_TYPES })
  @IsIn(HOUSING_TYPES)
  @IsOptional()
  housingType?: HousingType;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  @MaxLength(300)
  livingWith?: string;

  @ApiPropertyOptional({ description: 'Siblings and where they live' })
  @IsString()
  @IsOptional()
  @MaxLength(1000)
  siblings?: string;

  @ApiPropertyOptional({ type: TeacherParentDto })
  @ValidateNested()
  @Type(() => TeacherParentDto)
  @IsOptional()
  father?: TeacherParentDto;

  @ApiPropertyOptional({ type: TeacherParentDto })
  @ValidateNested()
  @Type(() => TeacherParentDto)
  @IsOptional()
  mother?: TeacherParentDto;

  @ApiPropertyOptional({
    description: 'Academic heads can approve and return lesson plans',
  })
  @IsBoolean()
  @IsOptional()
  isAcademicHead?: boolean;

  @ApiPropertyOptional({ description: 'Department (ສາຍວິຊາ) the teacher belongs to' })
  @IsMongoId()
  @IsOptional()
  subjectGroupId?: string;
}

export class UpdateTeacherDto {
  @ApiPropertyOptional() @IsString() @IsOptional() @MaxLength(20) title?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() @MaxLength(80) firstNameLo?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() @MaxLength(80) lastNameLo?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() @MaxLength(80) firstNameEn?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() @MaxLength(80) lastNameEn?: string;

  @ApiPropertyOptional({ enum: GENDERS })
  @IsIn(GENDERS)
  @IsOptional()
  gender?: Gender;

  @ApiPropertyOptional() @IsDateString() @IsOptional() dateOfBirth?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() @MaxLength(60) ethnicity?: string;

  @ApiPropertyOptional({ type: PlaceOfBirthDto })
  @ValidateNested()
  @Type(() => PlaceOfBirthDto)
  @IsOptional()
  placeOfBirth?: PlaceOfBirthDto;

  @ApiPropertyOptional() @IsString() @IsOptional() @MaxLength(30) nationalId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsLaoPhone()
  phone?: string;

  @ApiPropertyOptional() @IsEmail() @IsOptional() email?: string;
  @ApiPropertyOptional() @IsMongoId() @IsOptional() villageId?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() @MaxLength(300) addressDetail?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() @MaxLength(150) qualification?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() @MaxLength(150) specialization?: string;

  @ApiPropertyOptional({ type: TeacherEducationDto })
  @ValidateNested()
  @Type(() => TeacherEducationDto)
  @IsOptional()
  education?: TeacherEducationDto;

  @ApiPropertyOptional({ type: [String] })
  @IsArray()
  @IsString({ each: true })
  @MaxLength(80, { each: true })
  @IsOptional()
  teachingSubjects?: string[];

  @ApiPropertyOptional() @IsString() @IsOptional() @MaxLength(20) professionalLevel?: string;
  @ApiPropertyOptional() @IsDateString() @IsOptional() hireDate?: string;
  @ApiPropertyOptional() @IsDateString() @IsOptional() joinedOrgDate?: string;

  @ApiPropertyOptional({ enum: MARITAL_STATUSES })
  @IsIn(MARITAL_STATUSES)
  @IsOptional()
  maritalStatus?: MaritalStatus;

  @ApiPropertyOptional({ minimum: 0, maximum: 30 })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(30)
  @IsOptional()
  childrenCount?: number;

  @ApiPropertyOptional({ enum: HOUSING_TYPES })
  @IsIn(HOUSING_TYPES)
  @IsOptional()
  housingType?: HousingType;

  @ApiPropertyOptional() @IsString() @IsOptional() @MaxLength(300) livingWith?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() @MaxLength(1000) siblings?: string;

  @ApiPropertyOptional({ type: TeacherParentDto })
  @ValidateNested()
  @Type(() => TeacherParentDto)
  @IsOptional()
  father?: TeacherParentDto;

  @ApiPropertyOptional({ type: TeacherParentDto })
  @ValidateNested()
  @Type(() => TeacherParentDto)
  @IsOptional()
  mother?: TeacherParentDto;

  @ApiPropertyOptional({ enum: TEACHER_STATUSES })
  @IsIn(TEACHER_STATUSES)
  @IsOptional()
  status?: TeacherStatus;

  @ApiPropertyOptional() @IsBoolean() @IsOptional() isAcademicHead?: boolean;

  /** `null` detaches the teacher from their department. */
  @ApiPropertyOptional({ nullable: true })
  @ValidateIf((_object, value) => value !== null)
  @IsMongoId()
  @IsOptional()
  subjectGroupId?: string | null;
}

export class QueryTeachersDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: TEACHER_STATUSES })
  @IsIn(TEACHER_STATUSES)
  @IsOptional()
  status?: TeacherStatus;

  @ApiPropertyOptional({ description: 'Filter by village' })
  @IsMongoId()
  @IsOptional()
  villageId?: string;

  @ApiPropertyOptional({
    description: 'Filter by any location in the ancestry (district, province)',
  })
  @IsMongoId()
  @IsOptional()
  locationId?: string;

  @ApiPropertyOptional({ description: 'Filter by a subject they teach', example: 'ຄະນິດສາດ' })
  @IsString()
  @IsOptional()
  teachingSubject?: string;

  @ApiPropertyOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  @IsOptional()
  isAcademicHead?: boolean;

  @ApiPropertyOptional({ description: 'Filter by department' })
  @IsMongoId()
  @IsOptional()
  subjectGroupId?: string;
}
