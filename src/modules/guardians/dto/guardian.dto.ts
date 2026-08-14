import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsEmail,
  IsIn,
  IsMongoId,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { GENDERS, Gender } from 'src/common/constants/enums';
import { PaginationQueryDto } from 'src/common/dto/pagination.dto';
import { IsLaoPhone } from 'src/common/utils/phone';

export class CreateGuardianDto {
  @ApiProperty({ example: 'ບຸນມີ' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  firstNameLo: string;

  @ApiProperty({ example: 'ສີສຸວັນ' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  lastNameLo: string;

  @ApiPropertyOptional({ enum: GENDERS })
  @IsIn(GENDERS)
  @IsOptional()
  gender?: Gender;

  @ApiPropertyOptional()
  @IsDateString()
  @IsOptional()
  dateOfBirth?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  @MaxLength(30)
  nationalId?: string;

  @ApiProperty({ example: '02012345678' })
  @IsLaoPhone()
  phone: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsLaoPhone()
  alternatePhone?: string;

  @ApiPropertyOptional()
  @IsEmail()
  @IsOptional()
  email?: string;

  @ApiPropertyOptional({ example: 'ຊາວກະສິກອນ' })
  @IsString()
  @IsOptional()
  @MaxLength(120)
  occupation?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  @MaxLength(150)
  workplace?: string;

  @ApiPropertyOptional()
  @IsMongoId()
  @IsOptional()
  villageId?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  @MaxLength(300)
  addressDetail?: string;
}

export class UpdateGuardianDto {
  @ApiPropertyOptional() @IsString() @IsOptional() @MaxLength(80) firstNameLo?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() @MaxLength(80) lastNameLo?: string;

  @ApiPropertyOptional({ enum: GENDERS })
  @IsIn(GENDERS)
  @IsOptional()
  gender?: Gender;

  @ApiPropertyOptional() @IsDateString() @IsOptional() dateOfBirth?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() @MaxLength(30) nationalId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsLaoPhone()
  phone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsLaoPhone()
  alternatePhone?: string;

  @ApiPropertyOptional() @IsEmail() @IsOptional() email?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() @MaxLength(120) occupation?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() @MaxLength(150) workplace?: string;
  @ApiPropertyOptional() @IsMongoId() @IsOptional() villageId?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() @MaxLength(300) addressDetail?: string;
}

export class QueryGuardiansDto extends PaginationQueryDto {
  @ApiPropertyOptional()
  @IsMongoId()
  @IsOptional()
  villageId?: string;
}
