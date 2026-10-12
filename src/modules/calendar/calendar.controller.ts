import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ClientIp, CurrentUser, RequirePermissions } from 'src/common/decorators';
import type { AuthenticatedUser } from 'src/common/interfaces/authenticated-user.interface';
import { CalendarService } from './calendar.service';
import {
  CreateCalendarEventDto,
  QueryCalendarEventsDto,
  QuerySchoolDaysDto,
  UpdateCalendarEventDto,
} from './dto/calendar.dto';

@ApiTags('calendar')
@ApiBearerAuth()
@Controller('calendar')
export class CalendarController {
  constructor(private readonly service: CalendarService) {}

  @Get()
  @ApiOperation({
    summary: 'List events',
    description:
      '`from`/`to` match events that *overlap* the range, so a multi-day holiday appears in a ' +
      'query for any day it covers.',
  })
  findAll(@Query() query: QueryCalendarEventsDto) {
    return this.service.findAll(query);
  }

  @Get('month/:year/:month')
  @ApiOperation({
    summary: 'Events for a calendar grid',
    description: 'Includes a week either side, since a month grid shows adjacent days.',
  })
  findForMonth(
    @Param('year', ParseIntPipe) year: number,
    @Param('month', ParseIntPipe) month: number,
  ) {
    return this.service.findForMonth(year, month);
  }

  @Get('school-days')
  @ApiOperation({
    summary: 'Every day of a range, classified as the school works it',
    description:
      'The one read the rest of the system makes of the calendar: whether each day is ' +
      '`teaching` (the timetable runs and the roll call is owed), `no_classes` (staff in, ' +
      'timetable suspended — a PD day or an exam period), `closed`, or a `weekend`. Each day ' +
      'carries the events that made it so, so a report can say why a day was not counted.',
  })
  async schoolDays(@Query() query: QuerySchoolDaysDto) {
    // The room is resolved to its grade level first: a day off written against
    // `ມ.1` closes `ມ.1/ກ`, and the room id alone does not say which year it is.
    const forClass = await this.service.classRefFor(query.classroomId);
    return this.service.schoolDays(new Date(query.from), new Date(query.to), forClass);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  @RequirePermissions({ resource: 'calendar', action: 'create' })
  create(
    @Body() dto: CreateCalendarEventDto,
    @CurrentUser() actor: AuthenticatedUser,
    @ClientIp() ip: string | null,
  ) {
    return this.service.create(dto, { actor, ip });
  }

  @Patch(':id')
  @RequirePermissions({ resource: 'calendar', action: 'update' })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateCalendarEventDto,
    @CurrentUser() actor: AuthenticatedUser,
    @ClientIp() ip: string | null,
  ) {
    return this.service.update(id, dto, { actor, ip });
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions({ resource: 'calendar', action: 'delete' })
  remove(
    @Param('id') id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @ClientIp() ip: string | null,
  ) {
    return this.service.remove(id, { actor, ip });
  }
}
