import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ClientIp, CurrentUser, RequirePermissions } from 'src/common/decorators';
import type { AuthenticatedUser } from 'src/common/interfaces/authenticated-user.interface';
import { TeachersService } from '../teachers/teachers.service';
import { TeacherHandoverDto } from './dto/teacher-handover.dto';
import { TeacherHandoverService } from './teacher-handover.service';

/**
 * Two routes under `/teachers`, in a controller of their own.
 *
 * Not on `TeachersController` because a handover writes the timetable and the
 * classrooms, so its service reaches for `TeachingAssignmentsService`'s models and
 * `ClassroomsService` — and both of those modules import `TeachersModule`. An
 * import edge back would close a cycle, so the work lives in its own module and
 * keeps the URL the office would expect.
 */
@ApiTags('Teachers')
@Controller('teachers')
export class TeacherHandoverController {
  constructor(
    private readonly handover: TeacherHandoverService,
    private readonly teachers: TeachersService,
  ) {}

  @Get(':id/commitments')
  @RequirePermissions({ resource: 'teachers', action: 'read' })
  @ApiOperation({
    summary: 'What this teacher still holds that somebody would have to take on',
    description:
      'The posts, not the history: active lessons, ຄູປະຈຳຫ້ອງ rooms and any ສາຍວິຊາ headship, ' +
      'plus whether they can still sign in. Their registers, marks and reviews keep their name ' +
      'and are not listed, because nothing needs to be done about them. This is what the ' +
      'delete guard refuses on and what a handover moves, so the office is never told a ' +
      'teacher is still responsible for something without being shown what.',
  })
  commitments(@Param('id') id: string) {
    return this.teachers.commitments(id);
  }

  @Post(':id/handover')
  @RequirePermissions(
    { resource: 'teachers', action: 'update' },
    // It writes the timetable and the rooms, so it asks for those too rather than
    // letting `teachers:update` quietly carry authority over both.
    { resource: 'teaching-assignments', action: 'manage' },
    { resource: 'classrooms', action: 'manage' },
  )
  @ApiOperation({
    summary: 'ສົ່ງມອບການສອນ — hand this teacher’s posts to another',
    description:
      'In one transaction: closes each live lesson and reopens it under the incoming teacher ' +
      'with the same subject, class, term and periods; moves every ຄູປະຈຳຫ້ອງ post and records ' +
      'the spell in the room’s history; optionally moves a ສາຍວິຊາ headship; and sets the ' +
      'outgoing teacher to `resigned`. Touches no history — registers, marks and reviews keep ' +
      'the name of whoever wrote them, and a closed term is left alone. Refused whole if the ' +
      'incoming teacher would be double-booked or already takes that subject with that class.',
  })
  handOver(
    @Param('id') id: string,
    @Body() dto: TeacherHandoverDto,
    @CurrentUser() actor: AuthenticatedUser,
    @ClientIp() ip: string | null,
  ) {
    return this.handover.handOver(id, dto, { actor, ip });
  }
}
