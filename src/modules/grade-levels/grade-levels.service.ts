import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { PaginationQueryDto } from 'src/common/dto/pagination.dto';
import { BaseCrudService, CrudContext } from 'src/common/services/base-crud.service';
import { GradeLevel, GradeLevelDocument } from 'src/database/schemas';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CreateGradeLevelDto, UpdateGradeLevelDto } from './dto/grade-level.dto';

@Injectable()
export class GradeLevelsService extends BaseCrudService<GradeLevelDocument> {
  protected readonly entityType = 'gradeLevels';
  protected readonly sortableFields = ['level', 'code', 'nameLo'] as const;
  protected readonly defaultSort = { level: 1 as const };

  constructor(
    @InjectModel(GradeLevel.name) model: Model<GradeLevelDocument>,
    audit: AuditLogsService,
  ) {
    super(model, audit);
  }

  findAll(query: PaginationQueryDto) {
    return this.findAllPaginated(query);
  }

  findOne(id: string) {
    return this.findOneOrFail(id);
  }

  create(dto: CreateGradeLevelDto, context: CrudContext) {
    return this.createDocument(dto as Partial<GradeLevelDocument>, context);
  }

  update(id: string, dto: UpdateGradeLevelDto, context: CrudContext) {
    return this.updateDocument(id, dto, context);
  }

  remove(id: string, context: CrudContext) {
    return this.softDelete(id, context);
  }

  /** The next level up, used when promoting a cohort. Null at the top level. */
  async findNextLevel(currentLevel: number): Promise<GradeLevelDocument | null> {
    return this.model
      .findOne({ level: { $gt: currentLevel }, deletedAt: null })
      .sort({ level: 1 })
      .exec();
  }
}
