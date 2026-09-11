import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import { AppException } from 'src/common/exceptions/app.exception';
import { BaseCrudService, CrudContext } from 'src/common/services/base-crud.service';
import { Semester, SemesterDocument } from 'src/database/schemas';
import { TransactionHelper } from 'src/database/transaction.helper';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { SchoolYearsService } from '../school-years/school-years.service';
import { CreateSemesterDto, QuerySemestersDto, UpdateSemesterDto } from './dto/semester.dto';

@Injectable()
export class SemestersService extends BaseCrudService<SemesterDocument> {
  protected readonly entityType = 'semesters';
  protected readonly sortableFields = ['number', 'startDate', 'createdAt'] as const;
  protected readonly defaultSort = { startDate: -1 as const };

  constructor(
    @InjectModel(Semester.name) model: Model<SemesterDocument>,
    audit: AuditLogsService,
    private readonly schoolYears: SchoolYearsService,
    private readonly tx: TransactionHelper,
  ) {
    super(model, audit);
  }

  protected buildFilter(query: QuerySemestersDto) {
    const filter: Record<string, unknown> = {};
    if (query.schoolYearId) filter.schoolYearId = new Types.ObjectId(query.schoolYearId);
    if (query.status) filter.status = query.status;
    return filter;
  }

  findAll(query: QuerySemestersDto) {
    return this.findAllPaginated(query);
  }

  findOne(id: string) {
    return this.findOneOrFail(id);
  }

  async findActive(session?: ClientSession): Promise<SemesterDocument | null> {
    return this.model
      .findOne({ isActive: true, deletedAt: null })
      .session(session ?? null)
      .exec();
  }

  /**
   * The term running at some point between `from` and `to`.
   *
   * For reports read by picking a date: the term a past week belongs to is a
   * property of that week, not of which term happens to be active today. Asked
   * as an overlap rather than "contains this date" so a week straddling the end
   * of one term and the start of the next still resolves to one of them; the
   * later of the two wins, which in that week is the term being taught into.
   */
  async findForRange(from: Date, to: Date): Promise<SemesterDocument | null> {
    return this.model
      .findOne({ deletedAt: null, startDate: { $lte: to }, endDate: { $gte: from } })
      .sort({ startDate: -1 })
      .exec();
  }

  /**
   * Every term of one school year, in the order they are taught.
   *
   * For the counts the school keeps per year rather than per term — the conduct
   * balance above all — which have to be published back into each term's row.
   */
  async findForYear(schoolYearId: Types.ObjectId | string): Promise<SemesterDocument[]> {
    return this.model
      .find({ schoolYearId: new Types.ObjectId(schoolYearId), deletedAt: null })
      .sort({ number: 1 })
      .exec();
  }

  async getActiveOrFail(): Promise<SemesterDocument> {
    const active = await this.findActive();
    if (!active) throw AppException.badRequest('schoolYear.notActive');
    return active;
  }

  /**
   * Loads a semester and refuses if it is closed.
   *
   * Every write that belongs to a term — scores, attendance, enrollment —
   * routes through here so "closed means closed" is enforced in one place.
   */
  async getWritableOrFail(id: string, session?: ClientSession): Promise<SemesterDocument> {
    const semester = await this.findOneOrFail(id, session);
    if (semester.status === 'closed') throw AppException.conflict('semester.closed');
    return semester;
  }

  async create(dto: CreateSemesterDto, context: CrudContext) {
    const schoolYear = await this.schoolYears.findOneOrFail(dto.schoolYearId);
    const startDate = new Date(dto.startDate);
    const endDate = new Date(dto.endDate);

    if (startDate >= endDate) {
      throw AppException.badRequest('common.validationFailed', {
        reason: 'startDate must be before endDate',
      });
    }
    // A semester outside its own school year would break every date-scoped query.
    if (startDate < schoolYear.startDate || endDate > schoolYear.endDate) {
      throw AppException.badRequest('semester.outsideSchoolYear', {
        schoolYearRange: [schoolYear.startDate, schoolYear.endDate],
      });
    }

    return this.createDocument(
      {
        ...dto,
        schoolYearId: new Types.ObjectId(dto.schoolYearId),
        startDate,
        endDate,
      } as Partial<SemesterDocument>,
      context,
    );
  }

  async update(id: string, dto: UpdateSemesterDto, context: CrudContext) {
    const current = await this.findOneOrFail(id);
    const patch: Record<string, unknown> = { ...dto };

    if (dto.startDate || dto.endDate) {
      const schoolYear = await this.schoolYears.findOneOrFail(current.schoolYearId.toString());
      const startDate = dto.startDate ? new Date(dto.startDate) : current.startDate;
      const endDate = dto.endDate ? new Date(dto.endDate) : current.endDate;

      if (startDate >= endDate) {
        throw AppException.badRequest('common.validationFailed', {
          reason: 'startDate must be before endDate',
        });
      }
      if (startDate < schoolYear.startDate || endDate > schoolYear.endDate) {
        throw AppException.badRequest('semester.outsideSchoolYear');
      }
      patch.startDate = startDate;
      patch.endDate = endDate;
    }

    return this.updateDocument(id, patch, context);
  }

  /** Exactly one semester is active at a time, for the same reason as school years. */
  async setActive(id: string, context: CrudContext): Promise<SemesterDocument> {
    return this.tx.run(async (session) => {
      const target = await this.findOneOrFail(id, session);

      await this.model
        .updateMany(
          { _id: { $ne: target._id }, isActive: true },
          { $set: { isActive: false } },
          { session },
        )
        .exec();

      return this.updateDocument(id, { isActive: true, status: 'active' }, { ...context, session });
    });
  }

  async remove(id: string, context: CrudContext): Promise<void> {
    const semester = await this.findOneOrFail(id);
    if (semester.isActive) {
      throw AppException.conflict('common.inUse', {
        reason: 'the active semester cannot be deleted',
      });
    }
    await this.softDelete(id, context);
  }
}
