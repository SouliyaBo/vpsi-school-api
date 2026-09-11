import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ClientIp, CurrentUser, Public, RequirePermissions } from 'src/common/decorators';
import type { AuthenticatedUser } from 'src/common/interfaces/authenticated-user.interface';
import {
  CreateTeachingObservationDto,
  ObservationSummaryQueryDto,
  QueryTeachingObservationsDto,
  UpdateTeachingObservationDto,
} from './dto/teaching-observation.dto';
import { TeachingObservationsService } from './teaching-observations.service';

/**
 * ຕິດຕາມການສອນຂອງຄູ — the classroom-observation sheet.
 *
 * The school's paper form scores six criteria out of ten each, and heads the
 * page with the teacher observed, the department, the subject, the room, the
 * date and the visit number. It does not say who did the observing; that is
 * `observerId`, it is required, and it defaults to the signed-in teacher.
 *
 * Filed under a resource of its own rather than under `teachers`: reading the
 * staff register and reading the judgements colleagues have written about each
 * other are different permissions, and one should not imply the other. A
 * teacher's `read` is narrowed again in the service to the sheets they wrote and
 * the sheets written about them.
 */
@ApiTags('teaching-observations')
@ApiBearerAuth()
@Controller('teaching-observations')
export class TeachingObservationsController {
  constructor(private readonly service: TeachingObservationsService) {}

  @Get('rubric')
  @Public()
  @ApiOperation({
    summary: 'The six criteria, as the paper form prints them',
    description:
      'Public and unauthenticated: it is the blank form, identical for everybody, and the ' +
      'login screen’s bundle should not have to hold a copy of the school’s wording.',
  })
  rubric() {
    return this.service.rubric();
  }

  @Get()
  @RequirePermissions({ resource: 'teaching-observations', action: 'read' })
  @ApiOperation({
    summary: 'Filed and drafted sheets',
    description:
      'A teacher sees the sheets they wrote and the sheets written about them — the latter ' +
      'only once filed. The academic office sees the school’s.',
  })
  findAll(@Query() query: QueryTeachingObservationsDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.service.findAll(query, actor);
  }

  @Get('summary')
  @RequirePermissions({ resource: 'teaching-observations', action: 'read' })
  @ApiOperation({
    summary: 'ສະຫຼຸບການຕິດຕາມ — a term’s visits per teacher, averaged',
    description:
      'Counts filed sheets only, and orders the weakest average first: the summary exists to ' +
      'find who needs support.',
  })
  summary(@Query() query: ObservationSummaryQueryDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.service.summary(query, actor);
  }

  @Get(':id')
  @RequirePermissions({ resource: 'teaching-observations', action: 'read' })
  @ApiOperation({ summary: 'One sheet' })
  findOne(@Param('id') id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.service.findOne(id, actor);
  }

  @Post()
  @RequirePermissions({ resource: 'teaching-observations', action: 'create' })
  @ApiOperation({
    summary: 'Start a sheet',
    description:
      'Created as a draft, so it can be part-filled at the back of the room. `visitNumber` is ' +
      'derived as the teacher’s next visit of the term unless one is given.',
  })
  create(
    @Body() dto: CreateTeachingObservationDto,
    @CurrentUser() actor: AuthenticatedUser,
    @ClientIp() ip: string | null,
  ) {
    return this.service.create(dto, actor, ip);
  }

  @Patch(':id')
  @RequirePermissions({ resource: 'teaching-observations', action: 'update' })
  @ApiOperation({
    summary: 'Correct a draft',
    description:
      'Drafts only, and by their observer. A criterion left out of `scores` keeps its mark; ' +
      'sent as `null` it is cleared back to unmarked.',
  })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateTeachingObservationDto,
    @CurrentUser() actor: AuthenticatedUser,
    @ClientIp() ip: string | null,
  ) {
    return this.service.update(id, dto, actor, ip);
  }

  @Post(':id/submit')
  @RequirePermissions({ resource: 'teaching-observations', action: 'update' })
  @ApiOperation({
    summary: 'File the sheet',
    description: 'Refused unless all six criteria carry a mark. One-way.',
  })
  submit(
    @Param('id') id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @ClientIp() ip: string | null,
  ) {
    return this.service.submit(id, actor, ip);
  }

  @Post(':id/acknowledge')
  @RequirePermissions({ resource: 'teaching-observations', action: 'read' })
  @ApiOperation({
    summary: 'The observed teacher confirms they have read it',
    description:
      'Only that teacher, never the office — it is the one line on the sheet nobody can fill ' +
      'in on their behalf. Needs `read` alone, since it is their own record.',
  })
  acknowledge(
    @Param('id') id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @ClientIp() ip: string | null,
  ) {
    return this.service.acknowledge(id, actor, ip);
  }

  @Delete(':id')
  @RequirePermissions({ resource: 'teaching-observations', action: 'delete' })
  @ApiOperation({
    summary: 'Withdraw a sheet',
    description: 'Soft-deleted. A filed sheet may be withdrawn by the academic office only.',
  })
  remove(
    @Param('id') id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @ClientIp() ip: string | null,
  ) {
    return this.service.remove(id, actor, ip);
  }
}
