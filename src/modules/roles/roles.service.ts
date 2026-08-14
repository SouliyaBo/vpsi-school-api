import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { PaginationQueryDto } from 'src/common/dto/pagination.dto';
import { AppException } from 'src/common/exceptions/app.exception';
import { BaseCrudService, CrudContext } from 'src/common/services/base-crud.service';
import { Role, RoleDocument } from 'src/database/schemas';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CreateRoleDto, UpdateRoleDto } from './dto/role.dto';

@Injectable()
export class RolesService extends BaseCrudService<RoleDocument> {
  protected readonly entityType = 'roles';
  protected readonly sortableFields = ['code', 'nameLo', 'nameEn', 'createdAt'] as const;
  protected readonly defaultSort = { code: 1 as const };

  constructor(@InjectModel(Role.name) model: Model<RoleDocument>, audit: AuditLogsService) {
    super(model, audit);
  }

  findAll(query: PaginationQueryDto) {
    return this.findAllPaginated(query);
  }

  findOne(id: string) {
    return this.findOneOrFail(id);
  }

  findByCode(code: string) {
    return this.model.findOne({ code, deletedAt: null }).exec();
  }

  create(dto: CreateRoleDto, context: CrudContext) {
    return this.createDocument(dto as Partial<RoleDocument>, context);
  }

  async update(id: string, dto: UpdateRoleDto, context: CrudContext) {
    const role = await this.findOneOrFail(id);
    // System roles keep their identity and permission set: editing `admin` out
    // of its permissions would lock every administrator out with no way back.
    if (role.isSystem && dto.permissions) {
      throw AppException.forbidden('auth.forbidden', {
        reason: 'permissions of a system role cannot be modified',
      });
    }
    return this.updateDocument(id, dto, context);
  }

  async remove(id: string, context: CrudContext) {
    const role = await this.findOneOrFail(id);
    if (role.isSystem) {
      throw AppException.forbidden('auth.forbidden', {
        reason: 'system roles cannot be deleted',
      });
    }
    await this.softDelete(id, context);
  }
}
