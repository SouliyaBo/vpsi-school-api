import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
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
