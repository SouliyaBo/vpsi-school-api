import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { SchoolDocument, SchoolDocumentSchema } from 'src/database/schemas';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: SchoolDocument.name, schema: SchoolDocumentSchema }]),
  ],
  controllers: [DocumentsController],
  providers: [DocumentsService],
  exports: [DocumentsService],
})
export class DocumentsModule {}
