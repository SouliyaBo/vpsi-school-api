import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import { PaginatedResponse } from 'src/common/dto/pagination.dto';
import { AppException } from 'src/common/exceptions/app.exception';
import { BaseCrudService, CrudContext } from 'src/common/services/base-crud.service';
import { Guardian, GuardianDocument, Student, StudentDocument } from 'src/database/schemas';
import { TransactionHelper } from 'src/database/transaction.helper';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { escapeRegex } from '../users/users.service';
import { CreateGuardianDto, QueryGuardiansDto, UpdateGuardianDto } from './dto/guardian.dto';

@Injectable()
export class GuardiansService extends BaseCrudService<GuardianDocument> {
  protected readonly entityType = 'guardians';
  protected readonly sortableFields = ['lastNameLo', 'firstNameLo', 'createdAt'] as const;
  protected readonly defaultSort = { lastNameLo: 1 as const };

  constructor(
    @InjectModel(Guardian.name) model: Model<GuardianDocument>,
    @InjectModel(Student.name) private readonly studentModel: Model<StudentDocument>,
    audit: AuditLogsService,
    private readonly tx: TransactionHelper,
  ) {
    super(model, audit);
  }

  async findAll(query: QueryGuardiansDto): Promise<PaginatedResponse<GuardianDocument>> {
    const filter: Record<string, unknown> = { deletedAt: null };
    if (query.villageId) filter.villageId = new Types.ObjectId(query.villageId);
    if (query.search) {
      const escaped = escapeRegex(query.search);
      filter.$or = [
        { firstNameLo: { $regex: escaped, $options: 'i' } },
        { lastNameLo: { $regex: escaped, $options: 'i' } },
        { phone: { $regex: escaped, $options: 'i' } },
      ];
    }

    const sort = query.toSort(this.sortableFields, this.defaultSort);
    const [data, total] = await Promise.all([
      this.model
        .find(filter)
        .populate('villageId', 'nameLo nameEn')
        .sort(sort)
        .skip(query.skip)
        .limit(query.limit)
        .collation({ locale: 'lo', strength: 2 })
        .exec(),
      this.model.countDocuments(filter).exec(),
    ]);

    return new PaginatedResponse(data, total, query.page, query.limit);
  }

  async findOne(id: string) {
    if (!Types.ObjectId.isValid(id)) throw AppException.notFound();
    const guardian = await this.model
      .findOne({ _id: id, deletedAt: null })
      .populate('villageId', 'nameLo nameEn')
      .exec();
    if (!guardian) throw AppException.notFound();
    return guardian;
  }

  /**
   * The students this guardian is linked to.
   *
   * Queried from the student side via the `guardians.guardianId` index — the
   * relationship is embedded there, so there is no join table to consult.
   */
  async findChildren(id: string) {
    await this.assertExists(id);
    return this.studentModel
      .find({ 'guardians.guardianId': new Types.ObjectId(id), deletedAt: null })
      .select('studentCode firstNameLo lastNameLo status guardians')
      .exec();
  }

  create(dto: CreateGuardianDto, context: CrudContext) {
    return this.createDocument(
      {
        ...dto,
        villageId: dto.villageId ? new Types.ObjectId(dto.villageId) : null,
        dateOfBirth: dto.dateOfBirth ? new Date(dto.dateOfBirth) : null,
      } as Partial<GuardianDocument>,
      context,
    );
  }

  /**
   * Updates a guardian and re-syncs the fields denormalized onto students.
   *
   * `students.guardians[]` carries a copy of `fullNameLo` and `phone` so class
   * lists and report cards can show a contact without a lookup. This method is
   * the single place those copies are refreshed, and it does so in the same
   * transaction as the guardian write — see docs/schema-design.md §3.1.
   */
  async update(id: string, dto: UpdateGuardianDto, context: CrudContext) {
    return this.tx.run(async (session) => {
      const before = await this.findOneOrFail(id, session);

      const patch: Record<string, unknown> = { ...dto };
      if (dto.villageId) patch.villageId = new Types.ObjectId(dto.villageId);
      if (dto.dateOfBirth) patch.dateOfBirth = new Date(dto.dateOfBirth);

      const updated = await this.updateDocument(id, patch, { ...context, session });

      const nameChanged = dto.firstNameLo !== undefined || dto.lastNameLo !== undefined;
      const phoneChanged = dto.phone !== undefined && dto.phone !== before.phone;

      if (nameChanged || phoneChanged) {
        await this.syncDenormalizedFields(updated, session);
      }

      return updated;
    });
  }

  async remove(id: string, context: CrudContext): Promise<void> {
    // Guardians are referenced from students; removing one that is still linked
    // would leave a student with a dangling contact.
    const linked = await this.studentModel
      .exists({ 'guardians.guardianId': new Types.ObjectId(id), deletedAt: null })
      .exec();
    if (linked) {
      throw AppException.conflict('common.inUse', {
        reason: 'guardian is still linked to one or more students',
      });
    }
    await this.softDelete(id, context);
  }

  /** Pushes the current name and phone into every student that links this guardian. */
  private async syncDenormalizedFields(
    guardian: GuardianDocument,
    session: ClientSession,
  ): Promise<void> {
    await this.studentModel
      .updateMany(
        { 'guardians.guardianId': guardian._id },
        {
          $set: {
            // The positional filter updates only the matching array element.
            'guardians.$[link].fullNameLo': `${guardian.firstNameLo} ${guardian.lastNameLo}`,
            'guardians.$[link].phone': guardian.phone,
          },
        },
        {
          arrayFilters: [{ 'link.guardianId': guardian._id }],
          session,
        },
      )
      .exec();
  }
}
