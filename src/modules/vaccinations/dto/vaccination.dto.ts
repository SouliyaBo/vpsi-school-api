import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsMongoId,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  CONSENT_STATUSES,
  ConsentStatus,
  GENDERS,
  Gender,
  VACCINATION_CAMPAIGN_STATUSES,
  VACCINATION_STATUSES,
  VACCINES,
  Vaccine,
  VaccinationCampaignStatus,
  VaccinationStatus,
} from 'src/common/constants/enums';
import { PaginationQueryDto } from 'src/common/dto/pagination.dto';

// ── Campaigns ───────────────────────────────────────────────────────────────

/**
 * Narrows the student picker — not the roll.
 *
 * The roll is the explicit `studentIds` on the campaign. This only decides whose
 * names the picker offers, so a girls-only round does not list boys.
 */
export class CampaignEligibilityDto {
  @ApiPropertyOptional({
    enum: GENDERS,
    description: 'Omit to offer every student. This is the only place a round is girls-only.',
  })
  @IsIn(GENDERS)
  @IsOptional()
  gender?: Gender;

  @ApiPropertyOptional({ type: [String], description: 'Omit to cover every grade' })
  @IsArray()
  @IsMongoId({ each: true })
  @IsOptional()
  gradeLevelIds?: string[];

  @ApiPropertyOptional({ description: 'Earliest date of birth the round covers' })
  @IsDateString()
  @IsOptional()
  bornFrom?: string;

  @ApiPropertyOptional({ description: 'Latest date of birth the round covers' })
  @IsDateString()
  @IsOptional()
  bornTo?: string;
}

export class CreateCampaignDto {
  @ApiProperty({ example: 'ວັກແຊງ HPV ເຂັມທີ 1' })
  @IsString()
  @MaxLength(200)
  nameLo: string;

  @ApiProperty({ enum: VACCINES })
  @IsIn(VACCINES)
  vaccine: Vaccine;

  @ApiProperty({ example: 1, description: 'Which dose of the course this round gives' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  doseNumber: number;

  @ApiProperty()
  @IsDateString()
  scheduledDate: string;

  @ApiProperty()
  @IsMongoId()
  schoolYearId: string;

  @ApiPropertyOptional({ type: CampaignEligibilityDto })
  @ValidateNested()
  @Type(() => CampaignEligibilityDto)
  @IsOptional()
  eligibility?: CampaignEligibilityDto;

  @ApiPropertyOptional({ example: 'ສູນສາທາລະນະສຸກເມືອງ' })
  @IsString()
  @IsOptional()
  @MaxLength(200)
  provider?: string;

  @ApiPropertyOptional({ enum: VACCINATION_CAMPAIGN_STATUSES })
  @IsIn(VACCINATION_CAMPAIGN_STATUSES)
  @IsOptional()
  status?: VaccinationCampaignStatus;

  @ApiPropertyOptional() @IsString() @IsOptional() @MaxLength(1000) notes?: string;
}

export class UpdateCampaignDto {
  @ApiPropertyOptional() @IsString() @IsOptional() @MaxLength(200) nameLo?: string;
  @ApiPropertyOptional() @IsDateString() @IsOptional() scheduledDate?: string;

  @ApiPropertyOptional({ type: CampaignEligibilityDto })
  @ValidateNested()
  @Type(() => CampaignEligibilityDto)
  @IsOptional()
  eligibility?: CampaignEligibilityDto;

  @ApiPropertyOptional() @IsString() @IsOptional() @MaxLength(200) provider?: string;

  @ApiPropertyOptional({ enum: VACCINATION_CAMPAIGN_STATUSES })
  @IsIn(VACCINATION_CAMPAIGN_STATUSES)
  @IsOptional()
  status?: VaccinationCampaignStatus;

  @ApiPropertyOptional() @IsString() @IsOptional() @MaxLength(1000) notes?: string;
}

export class QueryCampaignsDto extends PaginationQueryDto {
  @ApiPropertyOptional() @IsMongoId() @IsOptional() schoolYearId?: string;

  @ApiPropertyOptional({ enum: VACCINES })
  @IsIn(VACCINES)
  @IsOptional()
  vaccine?: Vaccine;

  @ApiPropertyOptional({ enum: VACCINATION_CAMPAIGN_STATUSES })
  @IsIn(VACCINATION_CAMPAIGN_STATUSES)
  @IsOptional()
  status?: VaccinationCampaignStatus;
}

/** Which classroom's students the picker is showing. */
export class QueryCandidatesDto {
  @ApiProperty({ description: 'The classroom whose students the picker offers' })
  @IsMongoId()
  classroomId: string;
}

/** Replaces the round's roll wholesale. */
export class SetCampaignStudentsDto {
  @ApiProperty({
    type: [String],
    description:
      'The students this round covers. Replaces the whole list; a student who already has ' +
      'a dose recorded cannot be removed.',
  })
  @IsArray()
  @IsMongoId({ each: true })
  studentIds: string[];
}

// ── Records ─────────────────────────────────────────────────────────────────

export class VaccinationConsentDto {
  @ApiProperty({ enum: CONSENT_STATUSES })
  @IsIn(CONSENT_STATUSES)
  status: ConsentStatus;

  @ApiPropertyOptional({ description: 'The guardian who decided. Must be on the student’s list.' })
  @IsMongoId()
  @IsOptional()
  guardianId?: string;

  @ApiPropertyOptional() @IsDateString() @IsOptional() decidedAt?: string;

  @ApiPropertyOptional({ example: 'ໃບເຊັນ' })
  @IsString()
  @IsOptional()
  @MaxLength(100)
  method?: string;
}

/**
 * One student's outcome for one dose.
 *
 * `vaccine` and `doseNumber` are absent on purpose: when the record belongs to a
 * campaign they come from it, so the roll cannot record a dose the round is not
 * giving. `RecordStandaloneVaccinationDto` carries them for a dose given
 * elsewhere.
 */
export class RecordVaccinationDto {
  @ApiProperty()
  @IsMongoId()
  studentId: string;

  @ApiProperty({ enum: VACCINATION_STATUSES })
  @IsIn(VACCINATION_STATUSES)
  status: VaccinationStatus;

  @ApiPropertyOptional({ description: 'Required when `status` is `administered`' })
  @IsDateString()
  @IsOptional()
  administeredDate?: string;

  @ApiPropertyOptional({ example: 'B2409-17' })
  @IsString()
  @IsOptional()
  @MaxLength(60)
  batchNumber?: string;

  @ApiPropertyOptional() @IsString() @IsOptional() @MaxLength(200) provider?: string;

  @ApiPropertyOptional({ type: VaccinationConsentDto })
  @ValidateNested()
  @Type(() => VaccinationConsentDto)
  @IsOptional()
  consent?: VaccinationConsentDto;

  @ApiPropertyOptional({ description: 'The reason, for a refusal or a contraindication' })
  @IsString()
  @IsOptional()
  @MaxLength(1000)
  notes?: string;
}

/** A dose given away from the school, so it names its own vaccine and dose. */
export class RecordStandaloneVaccinationDto extends RecordVaccinationDto {
  @ApiProperty({ enum: VACCINES })
  @IsIn(VACCINES)
  vaccine: Vaccine;

  @ApiProperty()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  doseNumber: number;
}

/** Campaign day: the whole roll in one request. */
export class RecordCampaignDosesDto {
  @ApiProperty({ type: [RecordVaccinationDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RecordVaccinationDto)
  records: RecordVaccinationDto[];
}

export class QueryVaccinationsDto extends PaginationQueryDto {
  @ApiPropertyOptional() @IsMongoId() @IsOptional() studentId?: string;
  @ApiPropertyOptional() @IsMongoId() @IsOptional() campaignId?: string;

  @ApiPropertyOptional({ enum: VACCINES })
  @IsIn(VACCINES)
  @IsOptional()
  vaccine?: Vaccine;

  @ApiPropertyOptional({ enum: VACCINATION_STATUSES })
  @IsIn(VACCINATION_STATUSES)
  @IsOptional()
  status?: VaccinationStatus;

  @ApiPropertyOptional({
    description: 'Only students a campaign covers who have no `administered` record yet',
  })
  @Type(() => Boolean)
  @IsBoolean()
  @IsOptional()
  outstandingOnly?: boolean;
}
