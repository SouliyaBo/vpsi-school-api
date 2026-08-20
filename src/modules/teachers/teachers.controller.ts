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
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ClientIp, CurrentUser, RequirePermissions } from 'src/common/decorators';
import type { AuthenticatedUser } from 'src/common/interfaces/authenticated-user.interface';
import { UPLOAD_RULES } from '../storage/storage.service';
import { CreateTeacherDto, QueryTeachersDto, UpdateTeacherDto } from './dto/teacher.dto';
import { TeachersService } from './teachers.service';

@ApiTags('teachers')
@ApiBearerAuth()
@Controller('teachers')
export class TeachersController {
  constructor(private readonly service: TeachersService) {}

  /**
   * Declared before `:id` so the literal path wins the route match — otherwise
   * "me" would be parsed as an id.
   *
   * The two self-service routes carry no `@RequirePermissions`: a teacher holds
   * `teachers:read` but not `teachers:update`, and updating one's own portrait is
   * not an office action. Being signed in and linked to a teacher record is the
   * whole authorisation — see `TeachersService.findOwnWithPhotoUrl`.
   */
  @Get('me')
  @ApiOperation({ summary: 'Your own teacher record, including a signed photo URL' })
  findMe(@CurrentUser() actor: AuthenticatedUser) {
    return this.service.findOwnWithPhotoUrl(actor);
  }

  @Post('me/photo')
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { file: { type: 'string', format: 'binary' } },
      required: ['file'],
    },
  })
  @ApiOperation({ summary: 'Upload your own photo (JPEG/PNG/WebP, max 5 MB)' })
  uploadMyPhoto(
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
    return this.service.setOwnPhoto(actor, file, { actor, ip });
  }

  @Get()
  @RequirePermissions({ resource: 'teachers', action: 'read' })
  @ApiOperation({ summary: 'Search teachers by name, code, village or district/province' })
  findAll(@Query() query: QueryTeachersDto) {
    return this.service.findAll(query);
  }

  @Get('next-code')
  @RequirePermissions({ resource: 'teachers', action: 'create' })
  @ApiOperation({
    summary: 'The code a new teacher would be given',
    description:
      'A preview for the create form, not a reservation — the code is only taken when a teacher is saved.',
  })
  nextCode() {
    return this.service.peekNextCode();
  }

  @Get(':id')
  @RequirePermissions({ resource: 'teachers', action: 'read' })
  @ApiOperation({ summary: 'One teacher, including a signed photo URL' })
  findOne(@Param('id') id: string) {
    return this.service.findOneWithPhotoUrl(id);
  }

  @Post()
  @RequirePermissions({ resource: 'teachers', action: 'create' })
  create(
    @Body() dto: CreateTeacherDto,
    @CurrentUser() actor: AuthenticatedUser,
    @ClientIp() ip: string | null,
  ) {
    return this.service.create(dto, { actor, ip });
  }

  @Patch(':id')
  @RequirePermissions({ resource: 'teachers', action: 'update' })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateTeacherDto,
    @CurrentUser() actor: AuthenticatedUser,
    @ClientIp() ip: string | null,
  ) {
    return this.service.update(id, dto, { actor, ip });
  }

  @Post(':id/photo')
  @RequirePermissions({ resource: 'teachers', action: 'update' })
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { file: { type: 'string', format: 'binary' } },
      required: ['file'],
    },
  })
  @ApiOperation({ summary: 'Upload a photo (JPEG/PNG/WebP, max 5 MB)' })
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
  @RequirePermissions({ resource: 'teachers', action: 'delete' })
  remove(
    @Param('id') id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @ClientIp() ip: string | null,
  ) {
    return this.service.remove(id, { actor, ip });
  }
}
