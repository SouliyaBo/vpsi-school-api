import { Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ClientIp, CurrentUser, RequirePermissions } from 'src/common/decorators';
import type { AuthenticatedUser } from 'src/common/interfaces/authenticated-user.interface';
import { ConductDeductionsService } from './conduct-deductions.service';
import {
  QueryConductDeductionsDto,
  RecordConductDeductionDto,
  RevokeConductDeductionDto,
} from './dto/conduct-deduction.dto';

/**
 * ການຕັດຄະແນນກົດລະບຽບ — the discipline ledger.
 *
 * Filed under the `conduct-scores` permission rather than a resource of its own,
 * because it is not a second opinion about conduct: it is how this school
 * arrives at the conduct score, and the mark it publishes is the same one the
 * report card prints. A teacher who may record conduct may take points; putting
 * them back is `delete`, which the office holds — a deduction the child has been
 * told about is withdrawn by the discipline committee, not by whoever filed it.
 */
@ApiTags('conduct-deductions')
@ApiBearerAuth()
@Controller('conduct-deductions')
export class ConductDeductionsController {
  constructor(private readonly service: ConductDeductionsService) {}

  @Get()
  @RequirePermissions({ resource: 'conduct-scores', action: 'read' })
  @ApiOperation({
    summary: 'The ledger as a flat log, newest first',
    description: 'Narrowed per-request for a student or guardian, who see only their own record.',
  })
  findAll(@Query() query: QueryConductDeductionsDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.service.findAll(query, actor);
  }

  @Get('ladder')
  @RequirePermissions({ resource: 'conduct-scores', action: 'read' })
  @ApiOperation({
    summary: "The school's escalation ladder — who must be told at each total",
    description:
      'Served rather than restated on the client, so the sheet and the screen cannot drift.',
  })
  ladder() {
    return this.service.getLadder();
  }

  @Get('summary/classroom/:classroomId/semester/:semesterId')
  @RequirePermissions({ resource: 'conduct-scores', action: 'read' })
  @ApiOperation({
    summary: "One class's standing for a term, worst first",
    description:
      'Every child on the roll comes back, including those with nothing against them — on ' +
      'this page a clean record has to be visible to count as one.',
  })
  classroomSummary(
    @Param('classroomId') classroomId: string,
    @Param('semesterId') semesterId: string,
  ) {
    return this.service.getClassroomSummary(classroomId, semesterId);
  }

  @Get('student/:studentId/semester/:semesterId')
  @RequirePermissions({ resource: 'conduct-scores', action: 'read' })
  @ApiOperation({ summary: "One child's term: every row against them, oldest first" })
  studentLedger(
    @Param('studentId') studentId: string,
    @Param('semesterId') semesterId: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.service.getStudentLedger(studentId, semesterId, actor);
  }

  @Post()
  @RequirePermissions({ resource: 'conduct-scores', action: 'create' })
  @ApiOperation({
    summary: 'Apply one rule to one or more children on one day',
    description:
      'The points come from the rule and the term from the date; the request chooses only ' +
      'who and what. Returns where each child now stands, including the rung reached.',
  })
  record(
    @Body() dto: RecordConductDeductionDto,
    @CurrentUser() actor: AuthenticatedUser,
    @ClientIp() ip: string | null,
  ) {
    return this.service.record(dto, actor, ip);
  }

  @Delete(':id')
  @RequirePermissions({ resource: 'conduct-scores', action: 'delete' })
  @ApiOperation({
    summary: 'Withdraw one deduction, with a reason',
    description:
      'Kept on the record rather than erased, and the term mark is republished from what is ' +
      'left.',
  })
  revoke(
    @Param('id') id: string,
    @Body() dto: RevokeConductDeductionDto,
    @CurrentUser() actor: AuthenticatedUser,
    @ClientIp() ip: string | null,
  ) {
    return this.service.revoke(id, dto, actor, ip);
  }
}
