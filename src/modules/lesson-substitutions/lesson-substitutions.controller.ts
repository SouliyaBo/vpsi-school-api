import { Body, Controller, Delete, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { ClientIp, CurrentUser, RequirePermissions } from 'src/common/decorators';
import type { AuthenticatedUser } from 'src/common/interfaces/authenticated-user.interface';
import {
  CreateLessonSubstitutionDto,
  QueryLessonSubstitutionsDto,
} from './dto/lesson-substitution.dto';
import { LessonSubstitutionsService } from './lesson-substitutions.service';

@ApiTags('Lesson substitutions')
@Controller('lesson-substitutions')
export class LessonSubstitutionsController {
  constructor(private readonly service: LessonSubstitutionsService) {}

  @Get()
  @RequirePermissions({ resource: 'lesson-substitutions', action: 'read' })
  @ApiOperation({
    summary: 'ການມອບໝາຍສອນແທນ — cover that has been claimed',
    description:
      'A teacher sees only the claims they are a party to: the lessons they covered, and the ' +
      'lessons of their own somebody else covered. `manage` reads the school.',
  })
  findAll(@Query() query: QueryLessonSubstitutionsDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.service.findAll(query, actor);
  }

  @Get('claimability')
  @RequirePermissions({ resource: 'lesson-substitutions', action: 'read' })
  @ApiQuery({ name: 'teachingAssignmentId', required: true })
  @ApiQuery({ name: 'date', required: true, example: '2026-09-30' })
  @ApiOperation({
    summary: 'Whether the caller may record this lesson, or claim cover for it',
    description:
      'What the roll-call sheet asks before choosing between a save button and a ' +
      '“ຂ້ອຍສອນແທນຄາບນີ້” one. Every part of the answer is a server-side fact — the timetable, ' +
      'the live claim, and a deadline that depends on which days the school is open — so the ' +
      'client is told rather than left to work it out and be wrong on holidays.',
  })
  claimability(
    @Query('teachingAssignmentId') teachingAssignmentId: string,
    @Query('date') date: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.service.claimability(teachingAssignmentId, date, actor);
  }

  @Post()
  @RequirePermissions({ resource: 'lesson-substitutions', action: 'create' })
  @ApiOperation({
    summary: 'ຮັບສອນແທນ — claim one day of a colleague’s lesson',
    description:
      'Grants the caller the roll call and the behaviour register for that lesson on that date, ' +
      'and moves the coverage and punctuality reports’ expectation onto them — so the teacher ' +
      'who was away is not reported for a register they could not have written. Grants nothing ' +
      'about marking: scores and monthly marks stay with the timetabled teacher. Allowed up to ' +
      'the lesson’s own paperwork deadline, noon of the next working day; the office may file ' +
      'one later, and may file one under another teacher’s name.',
  })
  create(
    @Body() dto: CreateLessonSubstitutionDto,
    @CurrentUser() actor: AuthenticatedUser,
    @ClientIp() ip: string | null,
  ) {
    return this.service.create(dto, actor, ip);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions({ resource: 'lesson-substitutions', action: 'delete' })
  @ApiOperation({
    summary: 'ຖອນການສອນແທນ — withdraw a claim',
    description:
      'The stand-in may withdraw their own; `manage` may withdraw anyone’s. Responsibility for ' +
      'the lesson returns to the timetabled teacher, who is notified — a claim taken and ' +
      'dropped would otherwise put a gap back on the row of somebody who was never there.',
  })
  remove(
    @Param('id') id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @ClientIp() ip: string | null,
  ) {
    return this.service.remove(id, actor, ip);
  }
}
