import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';
import { AppException } from 'src/common/exceptions/app.exception';
import { BaseCrudService, CrudContext } from 'src/common/services/base-crud.service';
import { ConductDeduction, ConductRule, ConductRuleDocument } from 'src/database/schemas';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import {
  CreateConductRuleDto,
  QueryConductRulesDto,
  UpdateConductRuleDto,
} from './dto/conduct-deduction.dto';

/**
 * Where a rule sits in its column, read off the number the school gave it.
 *
 * Without this every rule the office adds would default to 0 and so appear
 * *above* 2.1 in the 10-point column — a sheet that reorders itself as it is
 * filled in is not the sheet on the wall. The trailing digits are what the
 * numbering counts with: `2.3` is the third item, `2.10` the tenth. A code with
 * no digits in it sorts first, which is as good a guess as any.
 */
export function sortOrderFromCode(code: string): number {
  const trailing = code.match(/(\d+)\s*$/);
  return trailing ? Number(trailing[1]) : 0;
}

/**
 * ລະບຽບການຕັດຄະແນນ — the published rule sheet, as data.
 *
 * Master data rather than a constant, because the sheet is reissued: the
 * director signs a new one each year, items are reworded, and a school that
 * cannot add "ຫ້າມ..." itself would be back to asking for a release. The ledger
 * copies what it needs at write time, so editing a rule never rewrites history.
 */
@Injectable()
export class ConductRulesService extends BaseCrudService<ConductRuleDocument> {
  protected readonly entityType = 'conductRules';
  protected readonly sortableFields = ['points', 'sortOrder', 'code'] as const;
  // The printed sheet's own order: cheapest column first, then down the column.
  protected readonly defaultSort = { points: 1 as const, sortOrder: 1 as const, code: 1 as const };

  constructor(
    @InjectModel(ConductRule.name) model: Model<ConductRuleDocument>,
    @InjectModel(ConductDeduction.name)
    private readonly deductionModel: Model<ConductDeduction>,
    audit: AuditLogsService,
  ) {
    super(model, audit);
  }

  protected buildFilter(query: QueryConductRulesDto): FilterQuery<ConductRuleDocument> {
    const filter: FilterQuery<ConductRuleDocument> = {};
    if (query.points !== undefined) filter.points = query.points;
    // The default is the sheet in force. Withdrawn rules are still readable, so
    // the office can put one back, but they are not what a teacher is offered.
    if (!query.includeWithdrawn) filter.isActive = true;
    return filter;
  }

  findAll(query: QueryConductRulesDto) {
    return this.findAllPaginated(query);
  }

  findOne(id: string) {
    return this.findOneOrFail(id);
  }

  async create(dto: CreateConductRuleDto, context: CrudContext) {
    await this.assertCodeIsFree(dto.code);
    return this.createDocument(
      {
        ...dto,
        sortOrder: dto.sortOrder ?? sortOrderFromCode(dto.code),
      } as Partial<ConductRuleDocument>,
      context,
    );
  }

  /**
   * Renumbering a rule moves it, unless a position is given outright.
   *
   * The sheet's numbering *is* its order, so an item renumbered from 2.9 to 2.2
   * that stayed at the bottom of the column would leave the screen disagreeing
   * with the paper. A patch that does not touch `code` leaves the position
   * alone.
   */
  async update(id: string, dto: UpdateConductRuleDto, context: CrudContext) {
    if (dto.code !== undefined) await this.assertCodeIsFree(dto.code, id);
    const positioned =
      dto.sortOrder === undefined && dto.code !== undefined
        ? { ...dto, sortOrder: sortOrderFromCode(dto.code) }
        : dto;
    return this.updateDocument(id, positioned, context);
  }

  /**
   * Removes a rule nobody has been deducted under; withdraw the rest.
   *
   * A rule that has been applied is part of what a child was told, so deleting
   * it would leave the ledger citing a number that no longer exists. The sheet's
   * own way of retiring an item is to stop printing it, which is `isActive`.
   */
  async remove(id: string, context: CrudContext) {
    // The id is converted rather than passed through: `@Prop({ type: Types.ObjectId })`
    // leaves the path as Mixed in this codebase, and Mixed does not cast — a
    // string filter silently matches nothing, which here would read as "no
    // deduction has ever cited this rule" and delete it out from under them.
    const used = await this.deductionModel
      .exists({ ruleId: new Types.ObjectId(id), deletedAt: null })
      .session(context.session ?? null)
      .exec();
    if (used) throw AppException.conflict('conductRule.inUse');
    return this.softDelete(id, context);
  }

  private async assertCodeIsFree(code: string, exceptId?: string): Promise<void> {
    const filter: FilterQuery<ConductRuleDocument> = { code, deletedAt: null };
    if (exceptId) filter._id = { $ne: exceptId };
    const clash = await this.model.exists(filter).exec();
    if (clash) throw AppException.conflict('conductRule.duplicateCode', { code });
  }
}
