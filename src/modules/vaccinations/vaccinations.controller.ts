import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ClientIp, CurrentUser, RequirePermissions } from 'src/common/decorators';
import type { AuthenticatedUser } from 'src/common/interfaces/authenticated-user.interface';
import {
  CreateCampaignDto,
  QueryCampaignsDto,
  QueryCandidatesDto,
  QueryVaccinationsDto,
  RecordCampaignDosesDto,
  RecordStandaloneVaccinationDto,
  SetCampaignStudentsDto,
  UpdateCampaignDto,
} from './dto/vaccination.dto';
import { VaccinationsService } from './vaccinations.service';

/**
 * Every route here needs the `vaccinations` permission, which no role holds by
 * default apart from the administrator and the registrar. Health data does not
 * ride on `students`: the office maintains the register without seeing a child's
 * HPV record.
 */
@ApiTags('vaccinations')
@ApiBearerAuth()
@Controller('vaccinations')
export class VaccinationsController {
  constructor(private readonly service: VaccinationsService) {}

  // ── Campaigns ─────────────────────────────────────────────────────────────

  @Get('campaigns')
  @RequirePermissions({ resource: 'vaccinations', action: 'read' })
  findAllCampaigns(@Query() query: QueryCampaignsDto) {
    return this.service.findAllCampaigns(query);
  }

  @Post('campaigns')
  @RequirePermissions({ resource: 'vaccinations', action: 'create' })
  @ApiOperation({
    summary: 'Plan a vaccination round',
    description:
      'The eligibility rule is what makes a round girls-only or grade-only. It is never ' +
      'derived from a student’s gender: the member count of a girls-only round and the ' +
      'female student count are different figures.',
  })
  createCampaign(
    @Body() dto: CreateCampaignDto,
    @CurrentUser() actor: AuthenticatedUser,
    @ClientIp() ip: string | null,
  ) {
    return this.service.createCampaign(dto, actor, ip);
  }

  @Get('campaigns/:id/roll')
  @RequirePermissions({ resource: 'vaccinations', action: 'read' })
  @ApiOperation({
    summary: 'The students picked for a campaign, with what is recorded for each',
    description:
      'The round’s own list, not a sweep of everyone the eligibility rule matches. ' +
      '`classroomId` narrows the view without changing who is on the round; ' +
      '`outstandingOnly=true` gives the follow-up list.',
  })
  campaignRoll(
    @Param('id') id: string,
    @Query('outstandingOnly') outstandingOnly?: string,
    @Query('classroomId') classroomId?: string,
  ) {
    return this.service.campaignRoll(id, {
      outstandingOnly: outstandingOnly === 'true',
      classroomId,
    });
  }

  @Get('campaigns/:id/candidates')
  @RequirePermissions({ resource: 'vaccinations', action: 'read' })
  @ApiOperation({
    summary: 'One classroom’s students, as the picker offers them',
    description:
      'Every student in the class, each flagged `eligible` and `selected`. A name the round ' +
      'does not cover is returned rather than omitted, so the office can see the list is ' +
      'complete instead of suspecting a missing enrolment.',
  })
  campaignCandidates(@Param('id') id: string, @Query() query: QueryCandidatesDto) {
    return this.service.campaignCandidates(id, query.classroomId);
  }

  @Put('campaigns/:id/students')
  @RequirePermissions({ resource: 'vaccinations', action: 'update' })
  @ApiOperation({
    summary: 'Set which students the round covers',
    description:
      'Replaces the whole list. A student whose dose is already recorded cannot be dropped, ' +
      'and every student added must meet the eligibility rule.',
  })
  setCampaignStudents(
    @Param('id') id: string,
    @Body() dto: SetCampaignStudentsDto,
    @CurrentUser() actor: AuthenticatedUser,
    @ClientIp() ip: string | null,
  ) {
    return this.service.setCampaignStudents(id, dto.studentIds, actor, ip);
  }

  @Post('campaigns/:id/records')
  @RequirePermissions({ resource: 'vaccinations', action: 'create' })
  @ApiOperation({
    summary: 'Record the outcome for every student on a roll',
    description:
      'One transaction for the whole sheet. A refusal or an absence is recorded as an outcome, ' +
      'not left as a missing row — the follow-up list is built from that difference. A dose ' +
      'marked given must carry a date and a guardian’s consent.',
  })
  recordCampaignDoses(
    @Param('id') id: string,
    @Body() dto: RecordCampaignDosesDto,
    @CurrentUser() actor: AuthenticatedUser,
    @ClientIp() ip: string | null,
  ) {
    return this.service.recordCampaignDoses(id, dto, actor, ip);
  }

  @Patch('campaigns/:id')
  @RequirePermissions({ resource: 'vaccinations', action: 'update' })
  updateCampaign(
    @Param('id') id: string,
    @Body() dto: UpdateCampaignDto,
    @CurrentUser() actor: AuthenticatedUser,
    @ClientIp() ip: string | null,
  ) {
    return this.service.updateCampaign(id, dto, actor, ip);
  }

  @Delete('campaigns/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions({ resource: 'vaccinations', action: 'delete' })
  removeCampaign(
    @Param('id') id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @ClientIp() ip: string | null,
  ) {
    return this.service.removeCampaign(id, actor, ip);
  }

  // ── Records ───────────────────────────────────────────────────────────────

  @Get()
  @RequirePermissions({ resource: 'vaccinations', action: 'read' })
  @ApiOperation({
    summary: 'Vaccination records',
    description: 'A read filtered to one student is audited; a campaign-wide list is not.',
  })
  findAll(
    @Query() query: QueryVaccinationsDto,
    @CurrentUser() actor: AuthenticatedUser,
    @ClientIp() ip: string | null,
  ) {
    return this.service.findAll(query, actor, ip);
  }

  @Post()
  @RequirePermissions({ resource: 'vaccinations', action: 'create' })
  @ApiOperation({
    summary: 'Record a dose given away from the school',
    description:
      'For a dose from a clinic or another programme. It counts towards the course, so it ' +
      'names its own vaccine and dose and belongs to no campaign.',
  })
  recordStandalone(
    @Body() dto: RecordStandaloneVaccinationDto,
    @CurrentUser() actor: AuthenticatedUser,
    @ClientIp() ip: string | null,
  ) {
    return this.service.recordStandalone(dto, actor, ip);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions({ resource: 'vaccinations', action: 'delete' })
  remove(
    @Param('id') id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @ClientIp() ip: string | null,
  ) {
    return this.service.remove(id, actor, ip);
  }
}
