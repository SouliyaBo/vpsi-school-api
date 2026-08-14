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
import { DocumentsService } from './documents.service';
import { QueryDocumentsDto, UpdateDocumentDto, UploadDocumentDto } from './dto/document.dto';

@ApiTags('documents')
@ApiBearerAuth()
@Controller('documents')
export class DocumentsController {
  constructor(private readonly service: DocumentsService) {}

  @Get()
  @RequirePermissions({ resource: 'documents', action: 'read' })
  @ApiOperation({
    summary: 'List documents you are allowed to see',
    description:
      'Visibility is applied inside the query, so the pagination total reflects what you can ' +
      'actually access.',
  })
  findAll(@Query() query: QueryDocumentsDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.service.findAll(query, actor);
  }

  @Get('categories')
  @RequirePermissions({ resource: 'documents', action: 'read' })
  @ApiOperation({ summary: 'Distinct categories available to you' })
  categories(@CurrentUser() actor: AuthenticatedUser) {
    return this.service.listCategories(actor);
  }

  @Get(':id')
  @RequirePermissions({ resource: 'documents', action: 'read' })
  @ApiOperation({
    summary: 'One document',
    description: 'Returns 404 rather than 403 when it exists but is not visible to you.',
  })
  findOne(@Param('id') id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.service.findOne(id, actor);
  }

  @Get(':id/download')
  @RequirePermissions({ resource: 'documents', action: 'read' })
  @ApiOperation({ summary: 'Signed download URL; increments the download count' })
  download(@Param('id') id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.service.getDownloadUrl(id, actor);
  }

  @Post()
  @RequirePermissions({ resource: 'documents', action: 'create' })
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
        title: { type: 'string' },
        description: { type: 'string' },
        category: { type: 'string' },
        tags: { type: 'string', description: 'Comma-separated' },
        visibility: { type: 'string', enum: ['staff', 'all', 'teachers', 'guardians'] },
      },
      required: ['file', 'title', 'category'],
    },
  })
  @ApiOperation({ summary: 'Upload a document (max 20 MB); defaults to staff-only visibility' })
  upload(
    @Body() dto: UploadDocumentDto,
    @UploadedFile(
      new ParseFilePipeBuilder()
        .addMaxSizeValidator({ maxSize: UPLOAD_RULES.document.maxBytes })
        .build({ fileIsRequired: true }),
    )
    file: Express.Multer.File,
    @CurrentUser() actor: AuthenticatedUser,
    @ClientIp() ip: string | null,
  ) {
    return this.service.upload(dto, file, actor, ip);
  }

  @Patch(':id')
  @RequirePermissions({ resource: 'documents', action: 'update' })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateDocumentDto,
    @CurrentUser() actor: AuthenticatedUser,
    @ClientIp() ip: string | null,
  ) {
    return this.service.update(id, dto, actor, ip);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions({ resource: 'documents', action: 'delete' })
  @ApiOperation({ summary: 'Delete a document and its stored file' })
  remove(
    @Param('id') id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @ClientIp() ip: string | null,
  ) {
    return this.service.remove(id, actor, ip);
  }
}
