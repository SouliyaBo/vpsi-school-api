import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model } from 'mongoose';
import { AppException } from 'src/common/exceptions/app.exception';
import { BaseCrudService, CrudContext } from 'src/common/services/base-crud.service';
import { TransactionHelper } from 'src/database/transaction.helper';
import { SchoolYear, SchoolYearDocument } from 'src/database/schemas';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import {
  CreateSchoolYearDto,
  QuerySchoolYearsDto,
  UpdateSchoolYearDto,
} from './dto/school-year.dto';

@Injectable()
export class SchoolYearsService extends BaseCrudService<SchoolYearDocument> {
  protected readonly entityType = 'schoolYears';
  protected readonly sortableFields = ['code', 'startDate', 'createdAt'] as const;
  protected readonly defaultSort = { startDate: -1 as const };

  constructor(
    @InjectModel(SchoolYear.name) model: Model<SchoolYearDocument>,
    audit: AuditLogsService,
    private readonly tx: TransactionHelper,
  ) {
    super(model, audit);
  }

  protected buildFilter(query: QuerySchoolYearsDto) {
    return query.isActive === undefined ? {} : { isActive: query.isActive };
  }

  findAll(query: QuerySchoolYearsDto) {
    return this.findAllPaginated(query);
  }

  findOne(id: string) {
    return this.findOneOrFail(id);
  }

  /** The year everything defaults to. Null when no year has been activated. */
  async findActive(session?: ClientSession): Promise<SchoolYearDocument | null> {
    return this.model
      .findOne({ isActive: true, deletedAt: null })
      .session(session ?? null)
      .exec();
  }

  async getActiveOrFail(session?: ClientSession): Promise<SchoolYearDocument> {
    const active = await this.findActive(session);
    if (!active) throw AppException.badRequest('schoolYear.notActive');
    return active;
  }

  async create(dto: CreateSchoolYearDto, context: CrudContext) {
    const startDate = new Date(dto.startDate);
    const endDate = new Date(dto.endDate);
    this.assertValidRange(startDate, endDate);
    await this.assertNoOverlap(startDate, endDate);

    return this.createDocument(
      { ...dto, startDate, endDate } as Partial<SchoolYearDocument>,
      context,
    );
  }

  async update(id: string, dto: UpdateSchoolYearDto, context: CrudContext) {
    const current = await this.findOneOrFail(id);
    const startDate = dto.startDate ? new Date(dto.startDate) : current.startDate;
    const endDate = dto.endDate ? new Date(dto.endDate) : current.endDate;

    if (dto.startDate || dto.endDate) {
      this.assertValidRange(startDate, endDate);
      await this.assertNoOverlap(startDate, endDate, id);
    }

    return this.updateDocument(id, { ...dto, startDate, endDate }, context);
  }

  /**
   * Makes one year the active one.
   *
   * Deactivating the previous year and activating the new one happen in a
   * single transaction; a window where two years are active — or none is —
   * would make "the current year" ambiguous for every other module.
   */
  async setActive(id: string, context: CrudContext): Promise<SchoolYearDocument> {
    return this.tx.run(async (session) => {
      const target = await this.findOneOrFail(id, session);

      await this.model
        .updateMany(
          { _id: { $ne: target._id }, isActive: true },
          { $set: { isActive: false } },
          { session },
        )
        .exec();

      return this.updateDocument(id, { isActive: true }, { ...context, session });
    });
  }

  /** Closing a year does not delete it — historical records still reference it. */
  async close(id: string, context: CrudContext): Promise<SchoolYearDocument> {
    return this.updateDocument(id, { isActive: false }, context);
  }

  async remove(id: string, context: CrudContext): Promise<void> {
    const year = await this.findOneOrFail(id);
    if (year.isActive) {
      throw AppException.conflict('common.inUse', {
        reason: 'the active school year cannot be deleted; activate another year first',
      });
    }
    await this.softDelete(id, context);
  }

  private assertValidRange(start: Date, end: Date): void {
    if (start >= end) {
      throw AppException.badRequest('common.validationFailed', {
        reason: 'startDate must be before endDate',
      });
    }
  }

  private async assertNoOverlap(start: Date, end: Date, excludeId?: string): Promise<void> {
    // Two ranges overlap when each starts before the other ends.
    const overlapping = await this.model
      .findOne({
        ...(excludeId ? { _id: { $ne: excludeId } } : {}),
        deletedAt: null,
        startDate: { $lt: end },
        endDate: { $gt: start },
      })
      .exec();

    if (overlapping) {
      throw AppException.conflict('schoolYear.overlappingDates', {
        conflictsWith: overlapping.code,
      });
    }
  }
}
