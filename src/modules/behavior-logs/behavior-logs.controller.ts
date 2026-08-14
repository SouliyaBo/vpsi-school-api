import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { ClientIp, CurrentUser, RequirePermissions } from 'src/common/decorators';
import type { AuthenticatedUser } from 'src/common/interfaces/authenticated-user.interface';
import { BehaviorLogsService } from './behavior-logs.service';
import {
  CreateBehaviorLogDto,
  MonthlySheetQueryDto,
  QueryBehaviorLogsDto,
  UpdateBehaviorLogDto,
} from './dto/behavior-log.dto';

/**
 * The homeroom behaviour register (ການຕິດຕາມ ແລະ ບັນທຶກພຶດຕິກຳຂອງນັກຮຽນ).
 *
 * The unit of writing is a *row* of the paper sheet, not a record: a row names
 * several students at once, and the id in the write paths is therefore a
 * `groupId`. Reads come in two shapes because the register answers two
 * questions — the month as a class sheet, and the term as one student's history.
 */
@ApiTags('behavior-logs')
@ApiBearerAuth()
@Controller('behavior-logs')
export class BehaviorLogsController {
  constructor(private readonly service: BehaviorLogsService) {}

  @Get()
  @RequirePermissions({ resource: 'behavior-logs', action: 'read' })
  @ApiOperation({
    summary: 'The register as a flat log, newest first — one record per student',
  })
  findAll(@Query() query: QueryBehaviorLogsDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.service.findAll(query, actor);
  }

  @Get('monthly-sheet')
  @RequirePermissions({ resource: 'behavior-logs', action: 'read' })
  @ApiOperation({
    summary: 'The monthly sheet for one class, laid out as the paper form',
    description:
      'Rows are reassembled from the group each set of records was written with, so several ' +
      'students named in one entry come back on one row. Chronological, and printable.',
  })
  monthlySheet(@Query() query: MonthlySheetQueryDto) {
    return this.service.getMonthlySheet(query);
  }

  @Get('entry-context')
  @RequirePermissions({ resource: 'behavior-logs', action: 'read' })
  @ApiQuery({ name: 'classroomId', required: true })
  @ApiQuery({ name: 'date', required: true, example: '2025-11-06' })
  @ApiOperation({
    summary: "The class's lessons on one date, plus its roster",
    description: 'What the entry form offers: a row must be filed against a timetabled lesson.',
  })
  entryContext(@Query('classroomId') classroomId: string, @Query('date') date: string) {
    return this.service.getEntryContext(classroomId, date);
  }

  @Get('tally/classroom/:classroomId/semester/:semesterId')
  @RequirePermissions({ resource: 'behavior-logs', action: 'read' })
  @ApiOperation({
    summary: 'Entry counts per student for one class over a semester, most-flagged first',
  })
  classroomTally(
    @Param('classroomId') classroomId: string,
    @Param('semesterId') semesterId: string,
  ) {
    return this.service.getClassroomTally(classroomId, semesterId);
  }

  @Post()
  @RequirePermissions({ resource: 'behavior-logs', action: 'create' })
  @ApiOperation({
    summary: 'File one row of the register',
    description:
      'Classroom, semester, subject, teacher and period are read off the lesson, never from ' +
      'the body. `entries` may be empty for a row that only records the state of the class, ' +
      'but a row that is empty on both counts is refused.',
  })
  create(
    @Body() dto: CreateBehaviorLogDto,
    @CurrentUser() actor: AuthenticatedUser,
    @ClientIp() ip: string | null,
  ) {
    return this.service.create(dto, actor, ip);
  }

  @Put(':groupId')
  @RequirePermissions({ resource: 'behavior-logs', action: 'update' })
  @ApiOperation({
    summary: 'Replace one row, keeping its identity',
    description:
      'Omitted fields keep what the row already says. The lesson and the date are not ' +
      'editable — changing either invalidates every field copied from the timetable.',
  })
  replace(
    @Param('groupId') groupId: string,
    @Body() dto: UpdateBehaviorLogDto,
    @CurrentUser() actor: AuthenticatedUser,
    @ClientIp() ip: string | null,
  ) {
    return this.service.replaceGroup(groupId, dto, actor, ip);
  }

  @Delete(':groupId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions({ resource: 'behavior-logs', action: 'delete' })
  @ApiOperation({ summary: 'Soft-delete one row and every record in it' })
  remove(
    @Param('groupId') groupId: string,
    @CurrentUser() actor: AuthenticatedUser,
    @ClientIp() ip: string | null,
  ) {
    return this.service.removeGroup(groupId, actor, ip);
  }
}
