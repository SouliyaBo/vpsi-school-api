import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsMongoId,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { CERTIFICATE_TYPES, CertificateType } from 'src/common/constants/enums';
import { PaginationQueryDto } from 'src/common/dto/pagination.dto';

export class IssueCertificateDto {
  @ApiProperty()
  @IsMongoId()
  studentId: string;

  @ApiProperty({ enum: CERTIFICATE_TYPES })
  @IsIn(CERTIFICATE_TYPES)
  type: CertificateType;

  @ApiPropertyOptional({ description: 'Defaults to the active school year' })
  @IsMongoId()
  @IsOptional()
  schoolYearId?: string;

  @ApiPropertyOptional()
  @IsMongoId()
  @IsOptional()
  gradeLevelId?: string;

  @ApiPropertyOptional({
    description: 'Semester whose marks appear on the certificate, when relevant',
  })
  @IsMongoId()
  @IsOptional()
  semesterId?: string;

  @ApiPropertyOptional({ example: 'ໃບຢັ້ງຢືນຈົບຊັ້ນມັດທະຍົມ' })
  @IsString()
  @IsOptional()
  @MaxLength(200)
  titleLo?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  @MaxLength(1000)
  descriptionLo?: string;

  @ApiPropertyOptional({ description: 'Defaults to today' })
  @IsDateString()
  @IsOptional()
  issuedDate?: string;

  @ApiPropertyOptional({
    description: 'Report template to render with; defaults to the active one',
  })
  @IsMongoId()
  @IsOptional()
  templateId?: string;
}

/**
 * The editable body of a `ໃບຢັ້ງຢືນການສຶກສາ`.
 *
 * Every field is optional and every omitted field falls back to what the
 * register holds. That asymmetry is the point: the office types only what the
 * register cannot answer — which for a birthplace is almost always — and a
 * caller that sends nothing still gets a correctly filled letter for a pupil
 * whose record happens to be complete.
 *
 * An explicitly empty string is not the same as an omitted field: it clears the
 * value, and the letter prints a dotted run to be completed by hand.
 */
export class StudyCertificateFieldsDto {
  @ApiPropertyOptional({ example: 'ບ້ານ ດອນແດງ ເມືອງ ຈັນທະບູລີ ແຂວງ ນະຄອນຫຼວງວຽງຈັນ' })
  @IsString()
  @IsOptional()
  @MaxLength(200)
  birthPlaceLo?: string;

  @ApiPropertyOptional({ example: 'ທ້າວ ສະຫງ່ວນ ປອງປັນຍາ' })
  @IsString()
  @IsOptional()
  @MaxLength(120)
  fatherNameLo?: string;

  @ApiPropertyOptional({ example: 'ນາງ ສົມໄທຍ ວົງສາ' })
  @IsString()
  @IsOptional()
  @MaxLength(120)
  motherNameLo?: string;

  @ApiPropertyOptional({ example: 'ບ້ານ ດອນແດງ ເມືອງ ຈັນທະບູລີ ແຂວງ ນະຄອນຫຼວງວຽງຈັນ' })
  @IsString()
  @IsOptional()
  @MaxLength(200)
  currentAddressLo?: string;

  @ApiPropertyOptional({
    example: '2022-2023',
    description:
      'First school year attended. Defaults to the earliest enrollment on file, which ' +
      'understates the truth for a pupil who was here before the system was.',
  })
  @IsString()
  @IsOptional()
  @MaxLength(20)
  studyFromYearCode?: string;

  @ApiPropertyOptional({ example: '2025-2026' })
  @IsString()
  @IsOptional()
  @MaxLength(20)
  studyToYearCode?: string;

  @ApiPropertyOptional({ example: 'ມ.4' })
  @IsString()
  @IsOptional()
  @MaxLength(30)
  classLabelLo?: string;
}

export class IssueStudyCertificateDto extends StudyCertificateFieldsDto {
  @ApiProperty()
  @IsMongoId()
  studentId: string;

  @ApiPropertyOptional({ description: 'Defaults to today' })
  @IsDateString()
  @IsOptional()
  issuedDate?: string;

  @ApiPropertyOptional({ description: 'Defaults to the active school year' })
  @IsMongoId()
  @IsOptional()
  schoolYearId?: string;
}

export class StudyCertificatePrefillDto extends StudyCertificateFieldsDto {
  @ApiProperty() studentId: string;
  @ApiProperty() studentCode: string;
  @ApiProperty({ example: 'ທ້າວ' }) titleLo: string;
  @ApiProperty() fullNameLo: string;
  @ApiPropertyOptional({ nullable: true }) dateOfBirth: Date | null;

  @ApiProperty({
    isArray: true,
    type: String,
    description: 'Fields the register could not supply; the office must type these.',
  })
  missing: string[];
}

/**
 * The editable body of a `ບົດບັນທຶກ ຂໍໂຈະການຮຽນ`. Same contract as the study
 * letter's fields: omitted falls back to the register, empty clears.
 */
export class StudySuspensionFieldsDto {
  @ApiPropertyOptional({ example: 'ທ້າວ ສະຫງ່ວນ ປອງປັນຍາ', description: 'The guardian who signs' })
  @IsString()
  @IsOptional()
  @MaxLength(120)
  guardianNameLo?: string;

  @ApiPropertyOptional({ example: '020 55512345' })
  @IsString()
  @IsOptional()
  @MaxLength(40)
  guardianPhone?: string;

  @ApiPropertyOptional({ example: 'ດອນແດງ', description: 'Bare name; the form prints ບ້ານ' })
  @IsString()
  @IsOptional()
  @MaxLength(120)
  villageLo?: string;

  @ApiPropertyOptional({ example: 'ຈັນທະບູລີ' })
  @IsString()
  @IsOptional()
  @MaxLength(120)
  districtLo?: string;

  @ApiPropertyOptional({ example: 'ນະຄອນຫຼວງວຽງຈັນ' })
  @IsString()
  @IsOptional()
  @MaxLength(120)
  provinceLo?: string;

  @ApiPropertyOptional({ example: 'ມ.1/ກ' })
  @IsString()
  @IsOptional()
  @MaxLength(30)
  classLabelLo?: string;

  @ApiPropertyOptional({ example: '2026-2027' })
  @IsString()
  @IsOptional()
  @MaxLength(20)
  schoolYearCode?: string;

  @ApiPropertyOptional({
    description: 'First day off the roll. Defaults to the issue date.',
    example: '2026-10-01',
  })
  // A date input left blank submits `''`, which `@IsOptional` does not skip.
  @Transform(({ value }) => (value === '' ? undefined : value))
  @IsDateString()
  @IsOptional()
  suspendedFrom?: string;

  @ApiPropertyOptional({
    example: 'ສຸມໃສ່ການຮຽນພາກພາສາອັງກິດ',
    description: 'Printed as given. Omitted or empty prints ruled lines to be filled by hand.',
  })
  @IsString()
  @IsOptional()
  @MaxLength(300)
  reasonLo?: string;

  @ApiPropertyOptional({
    type: [String],
    example: ['ປຶ້ມຕິດຕາມມັດທະຍົມ', 'ໃບຄະແນນ report card ຊັ້ນ ມ.3'],
    description: 'One entry per line. Omitted or empty prints ruled lines to be filled by hand.',
  })
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @MaxLength(200, { each: true })
  @IsOptional()
  documentsLo?: string[];
}

export class IssueStudySuspensionDto extends StudySuspensionFieldsDto {
  @ApiProperty()
  @IsMongoId()
  studentId: string;

  @ApiPropertyOptional({ description: 'Defaults to today' })
  @IsDateString()
  @IsOptional()
  issuedDate?: string;

  @ApiPropertyOptional({ description: 'Defaults to the active school year' })
  @IsMongoId()
  @IsOptional()
  schoolYearId?: string;
}

export class StudySuspensionPrefillDto extends StudySuspensionFieldsDto {
  @ApiProperty() studentId: string;
  @ApiProperty() studentCode: string;
  @ApiProperty({ example: 'ທ້າວ' }) titleLo: string;
  @ApiProperty() fullNameLo: string;

  @ApiProperty({
    isArray: true,
    type: String,
    description: 'Fields the register could not supply; the office must type these.',
  })
  missing: string[];
}

export class RevokeCertificateDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MinLength(10)
  @MaxLength(500)
  reason: string;
}

export class QueryCertificatesDto extends PaginationQueryDto {
  @ApiPropertyOptional() @IsMongoId() @IsOptional() studentId?: string;
  @ApiPropertyOptional() @IsMongoId() @IsOptional() schoolYearId?: string;

  @ApiPropertyOptional({ enum: CERTIFICATE_TYPES })
  @IsIn(CERTIFICATE_TYPES)
  @IsOptional()
  type?: CertificateType;

  @ApiPropertyOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  @IsOptional()
  isRevoked?: boolean;
}

export class CertificateVerificationDto {
  @ApiProperty() isValid: boolean;
  @ApiProperty() certificateNumber: string;
  @ApiPropertyOptional({ nullable: true }) studentNameLo: string | null;
  @ApiPropertyOptional({ nullable: true }) type: string | null;
  @ApiPropertyOptional({ nullable: true }) issuedDate: Date | null;
  @ApiProperty() isRevoked: boolean;
}
