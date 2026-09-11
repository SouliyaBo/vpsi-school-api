import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { AppException } from 'src/common/exceptions/app.exception';
import { BaseCrudService, CrudContext } from 'src/common/services/base-crud.service';
import { DEFAULT_DAY_EFFECT, SchoolDayEffect } from 'src/common/constants/enums';
import {
  SchoolDay,
  SchoolDayCalendar,
  type SchoolDayEvent,
} from 'src/common/school-days/school-days';
import { CalendarEvent, CalendarEventDocument } from 'src/database/schemas';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { SchoolYearsService } from '../school-years/school-years.service';
import {
  CreateCalendarEventDto,
  QueryCalendarEventsDto,
  UpdateCalendarEventDto,
} from './dto/calendar.dto';

@Injectable()
export class CalendarService extends BaseCrudService<CalendarEventDocument> {
  protected readonly entityType = 'calendarEvents';
  protected readonly sortableFields = ['startDate', 'endDate', 'type', 'titleLo'] as const;
  protected readonly defaultSort = { startDate: 1 as const };

  constructor(
    @InjectModel(CalendarEvent.name) model: Model<CalendarEventDocument>,
    audit: AuditLogsService,
    private readonly schoolYears: SchoolYearsService,
  ) {
    super(model, audit);
  }

  protected buildFilter(query: QueryCalendarEventsDto) {
    const filter: Record<string, unknown> = {};
    if (query.type) filter.type = query.type;
    if (query.dayEffect) filter.dayEffect = query.dayEffect;
    if (query.schoolYearId) filter.schoolYearId = new Types.ObjectId(query.schoolYearId);

    // Overlap, not containment: an event running 1–7 November must appear in a
    // query for 3–4 November even though neither endpoint falls inside it.
    if (query.from || query.to) {
      if (query.to) filter.startDate = { $lte: new Date(query.to) };
      if (query.from) filter.endDate = { $gte: new Date(query.from) };
    }

    return filter;
  }

  findAll(query: QueryCalendarEventsDto) {
    return this.findAllPaginated(query);
  }

  findOne(id: string) {
    return this.findOneOrFail(id);
  }

  /** Events in a month, for a calendar grid. */
  async findForMonth(year: number, month: number): Promise<CalendarEventDocument[]> {
    if (month < 1 || month > 12) {
      throw AppException.badRequest('common.validationFailed', {
        field: 'month',
        reason: 'must be 1–12',
      });
    }

    // A grid shows leading and trailing days of adjacent months, so widen the
    // window by a week on each side.
    const start = new Date(Date.UTC(year, month - 1, 1));
    const end = new Date(Date.UTC(year, month, 0, 23, 59, 59));
    const padded = {
      from: new Date(start.getTime() - 7 * 86_400_000),
      to: new Date(end.getTime() + 7 * 86_400_000),
    };

    return this.model
      .find({
        startDate: { $lte: padded.to },
        endDate: { $gte: padded.from },
        deletedAt: null,
      })
      .sort({ startDate: 1 })
      .exec();
  }

  async create(dto: CreateCalendarEventDto, context: CrudContext) {
    const startDate = new Date(dto.startDate);
    const endDate = new Date(dto.endDate);
    if (startDate > endDate) {
      throw AppException.badRequest('common.validationFailed', {
        reason: 'startDate must not be after endDate',
      });
    }

    const schoolYearId = dto.schoolYearId
      ? new Types.ObjectId(dto.schoolYearId)
      : ((await this.schoolYears.findActive())?._id ?? null);

    return this.createDocument(
      {
        ...dto,
        dayEffect: dto.dayEffect ?? DEFAULT_DAY_EFFECT[dto.type],
        startDate,
        endDate,
        schoolYearId,
        createdBy: context.actor?.sub ? new Types.ObjectId(context.actor.sub) : undefined,
        targets: (dto.targets ?? []).map((target) => ({
          targetType: target.targetType,
          targetId: target.targetId ? new Types.ObjectId(target.targetId) : null,
        })),
      } as unknown as Partial<CalendarEventDocument>,
      context,
    );
  }

  async update(id: string, dto: UpdateCalendarEventDto, context: CrudContext) {
    const current = await this.findOneOrFail(id);

    const startDate = dto.startDate ? new Date(dto.startDate) : current.startDate;
    const endDate = dto.endDate ? new Date(dto.endDate) : current.endDate;
    if (startDate > endDate) {
      throw AppException.badRequest('common.validationFailed', {
        reason: 'startDate must not be after endDate',
      });
    }

    const patch: Record<string, unknown> = { ...dto, startDate, endDate };

    // Retyping an event without saying what it does to the day re-derives the
    // effect: an event moved from `celebration` to `holiday` has to start closing
    // the school, or the picker would show one thing and the reports count another.
    if (dto.type && !dto.dayEffect) patch.dayEffect = DEFAULT_DAY_EFFECT[dto.type];

    if (dto.targets) {
      patch.targets = dto.targets.map((target) => ({
        targetType: target.targetType,
        targetId: target.targetId ? new Types.ObjectId(target.targetId) : null,
      }));
    }

    return this.updateDocument(id, patch, context);
  }

  remove(id: string, context: CrudContext) {
    return this.softDelete(id, context);
  }

  // ── The working-day calendar ──────────────────────────────────────────────

  /**
   * The calendar over a range, as the rest of the system asks it.
   *
   * One read per report rather than a query per day: the reports ask about a term
   * at a time, and the events overlapping a term are a handful of rows.
   *
   * `endDate: { $gte: from }` with `startDate: { $lte: to }` is overlap and not
   * containment — the twenty days of ບຸນປີໃໝ່ have to close a week that only
   * touches them.
   */
  async calendarFor(from: Date, to: Date): Promise<SchoolDayCalendar> {
    const events = await this.model
      .find({ startDate: { $lte: to }, endDate: { $gte: from }, deletedAt: null })
      .select('titleLo titleEn type dayEffect startDate endDate isHalfDay')
      .sort({ startDate: 1 })
      .lean()
      .exec();

    return new SchoolDayCalendar(
      events.map<SchoolDayEvent>((event) => ({
        id: String(event._id),
        titleLo: event.titleLo,
        titleEn: event.titleEn ?? null,
        type: event.type,
        // Rows written before the field existed fall back to their type's effect.
        dayEffect: (event.dayEffect ?? null) as SchoolDayEffect | null,
        startDate: event.startDate,
        endDate: event.endDate,
        isHalfDay: event.isHalfDay ?? false,
      })),
      // Deliberately without school-year bounds: a report reaches this for a
      // window it has already chosen, and marking those days `out_of_year`
      // against whichever year happens to be active would silently empty a
      // report about last year.
      {},
    );
  }

  /** Every day of a range, classified — what the calendar screen paints. */
  async schoolDays(from: Date, to: Date): Promise<SchoolDay[]> {
    const calendar = await this.calendarFor(from, to);
    return calendar.range(from, to);
  }
}
