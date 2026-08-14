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
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { ClientIp, CurrentUser, RequirePermissions } from 'src/common/decorators';
import type { AuthenticatedUser } from 'src/common/interfaces/authenticated-user.interface';
import { UPLOAD_RULES } from '../storage/storage.service';
import { AnnouncementsService } from './announcements.service';
import {
  CreateAnnouncementDto,
  PublishResultDto,
  QueryAnnouncementsDto,
  UpdateAnnouncementDto,
} from './dto/announcement.dto';

@ApiTags('announcements')
@ApiBearerAuth()
@Controller('announcements')
export class AnnouncementsController {
  constructor(private readonly service: AnnouncementsService) {}

  @Get()
  @ApiOperation({
    summary: 'Your announcement feed',
    description:
      'Filtered to announcements actually aimed at you — a classroom notice does not appear ' +
      'school-wide. Holders of `announcements:manage` get the editorial view, drafts included.',
  })
  findFeed(@Query() query: QueryAnnouncementsDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.service.findFeed(query, actor);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Read one announcement (increments its view count)' })
  view(@Param('id') id: string) {
    return this.service.view(id);
  }

  @Get(':id/attachments')
  @ApiOperation({ summary: 'Signed download URLs for the attachments' })
  attachments(@Param('id') id: string) {
    return this.service.getAttachmentUrls(id);
  }

  @Post()
  @RequirePermissions({ resource: 'announcements', action: 'create' })
  @ApiOperation({
    summary: 'Create an announcement as a draft',
    description:
      'Created unpublished. Publishing is a separate call because it fans out notifications ' +
      'that cannot be recalled.',
  })
  create(
    @Body() dto: CreateAnnouncementDto,
    @CurrentUser() actor: AuthenticatedUser,
    @ClientIp() ip: string | null,
  ) {
    return this.service.create(dto, actor, ip);
  }

  @Patch(':id')
  @RequirePermissions({ resource: 'announcements', action: 'update' })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateAnnouncementDto,
    @CurrentUser() actor: AuthenticatedUser,
    @ClientIp() ip: string | null,
  ) {
    return this.service.update(id, dto, actor, ip);
  }

  @Post(':id/publish')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions({ resource: 'announcements', action: 'update' })
  @ApiOperation({
    summary: 'Publish and notify the target audience',
    description:
      'Resolves the targets into a deduplicated recipient list, so overlapping targets do ' +
      'not notify anyone twice. Refuses if already published, so nobody is notified twice.',
  })
  @ApiResponse({ status: 200, type: PublishResultDto })
  @ApiResponse({ status: 409, description: 'Already published' })
  publish(
    @Param('id') id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @ClientIp() ip: string | null,
  ) {
    return this.service.publish(id, actor, ip);
  }

  @Post(':id/attachments')
  @RequirePermissions({ resource: 'announcements', action: 'update' })
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { file: { type: 'string', format: 'binary' } },
      required: ['file'],
    },
  })
  @ApiOperation({ summary: 'Attach a file (max 20 MB)' })
  addAttachment(
    @Param('id') id: string,
    @UploadedFile(
      new ParseFilePipeBuilder()
        .addMaxSizeValidator({ maxSize: UPLOAD_RULES.document.maxBytes })
        .build({ fileIsRequired: true }),
    )
    file: Express.Multer.File,
  ) {
    return this.service.addAttachment(id, file);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions({ resource: 'announcements', action: 'delete' })
  remove(
    @Param('id') id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @ClientIp() ip: string | null,
  ) {
    return this.service.remove(id, actor, ip);
  }
}
