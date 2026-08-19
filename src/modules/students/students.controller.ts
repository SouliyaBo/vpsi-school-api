import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseFilePipeBuilder,
  Patch,
  Post,
  Put,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ClientIp, CurrentUser, RequirePermissions } from 'src/common/decorators';
import type { AuthenticatedUser } from 'src/common/interfaces/authenticated-user.interface';
import { UPLOAD_RULES } from '../storage/storage.service';
import {
  CreateStudentDto,
  QueryStudentsDto,
  SetStudentGuardiansDto,
  UpdateStudentDto,
} from './dto/student.dto';
import { StudentsService } from './students.service';

@ApiTags('students')
@ApiBearerAuth()
@Controller('students')
export class StudentsController {
  constructor(private readonly service: StudentsService) {}

  @Get()
  @RequirePermissions({ resource: 'students', action: 'read' })
  @ApiOperation({
    summary: 'Search students',
    description:
      'Filterable by status, gender, village, district/province ancestry, grade level, ' +
      'classroom, and guardian. A teacher account sees only the students in the classrooms ' +
      'it is homeroom teacher of.',
  })
  findAll(@Query() query: QueryStudentsDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.service.findAll(query, actor);
  }

  @Get(':id')
  @RequirePermissions({ resource: 'students', action: 'read' })
  @ApiOperation({
    summary: 'One student with guardians resolved and a signed photo URL',
    description:
      'A student account may read only its own record; a guardian account only the records ' +
      'of linked students it is permitted to view.',
  })
  findOne(@Param('id') id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.service.findOneForActor(id, actor);
  }

  @Get(':id/siblings')
  @RequirePermissions({ resource: 'students', action: 'read' })
  @ApiOperation({
    summary: 'Students who share a guardian with this one',
    description:
      'Siblings are derived from the guardian link rather than stored, so they stay correct ' +
      'without a second relationship to maintain. Oldest first, every status included. ' +
      'Same access rules as reading the student.',
  })
  findSiblings(@Param('id') id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.service.findSiblings(id, actor);
  }

  @Post()
  @RequirePermissions({ resource: 'students', action: 'create' })
  @ApiOperation({
    summary: 'Create a student with at least one guardian',
    description:
      'Guardians may be referenced by id or supplied inline to be created. The student, ' +
      'any new guardians, and the links between them are written in one transaction.',
  })
  create(
    @Body() dto: CreateStudentDto,
    @CurrentUser() actor: AuthenticatedUser,
    @ClientIp() ip: string | null,
  ) {
    return this.service.create(dto, { actor, ip });
  }

  @Patch(':id')
  @RequirePermissions({ resource: 'students', action: 'update' })
  @ApiOperation({
    summary: 'Correct a student record',
    description:
      'A teacher account may only edit the students in the classroom it is homeroom teacher ' +
      'of, and may not change their `status` — that stays with the office.',
  })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateStudentDto,
    @CurrentUser() actor: AuthenticatedUser,
    @ClientIp() ip: string | null,
  ) {
    return this.service.update(id, dto, { actor, ip });
  }

  @Put(':id/guardians')
  @RequirePermissions({ resource: 'students', action: 'update' })
  @ApiOperation({
    summary: 'Replace the guardian list',
    description:
      'Exactly one guardian must be primary; if none is flagged, the first is used. Subject to ' +
      'the same homeroom limit as editing the student.',
  })
  setGuardians(
    @Param('id') id: string,
    @Body() dto: SetStudentGuardiansDto,
    @CurrentUser() actor: AuthenticatedUser,
    @ClientIp() ip: string | null,
  ) {
    return this.service.setGuardians(id, dto, { actor, ip });
  }

  @Post(':id/photo')
  @RequirePermissions({ resource: 'students', action: 'update' })
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { file: { type: 'string', format: 'binary' } },
      required: ['file'],
    },
  })
  @ApiOperation({
    summary: 'Upload a student photo (JPEG/PNG/WebP, max 5 MB)',
    description: 'Subject to the same homeroom limit as editing the student.',
  })
  uploadPhoto(
    @Param('id') id: string,
    @UploadedFile(
      new ParseFilePipeBuilder()
        .addFileTypeValidator({ fileType: /^image\/(jpeg|png|webp)$/ })
        .addMaxSizeValidator({ maxSize: UPLOAD_RULES.photo.maxBytes })
        .build({ fileIsRequired: true }),
    )
    file: Express.Multer.File,
    @CurrentUser() actor: AuthenticatedUser,
    @ClientIp() ip: string | null,
  ) {
    return this.service.setPhoto(id, file, { actor, ip });
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions({ resource: 'students', action: 'delete' })
  remove(
    @Param('id') id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @ClientIp() ip: string | null,
  ) {
    return this.service.remove(id, { actor, ip });
  }
}
