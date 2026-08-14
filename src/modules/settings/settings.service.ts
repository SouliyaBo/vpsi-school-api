import { Inject, Injectable, Logger } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { InjectModel } from '@nestjs/mongoose';
import type { Cache } from 'cache-manager';
import { Model, Types } from 'mongoose';
import { AppException } from 'src/common/exceptions/app.exception';
import type { AuthenticatedUser } from 'src/common/interfaces/authenticated-user.interface';
import { Setting, SettingDocument } from 'src/database/schemas';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { UpsertSettingDto } from './dto/setting.dto';

const CACHE_PREFIX = 'setting:';
const CACHE_TTL_MS = 300_000;

@Injectable()
export class SettingsService {
  private readonly logger = new Logger(SettingsService.name);

  constructor(
    @InjectModel(Setting.name) private readonly model: Model<SettingDocument>,
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
    private readonly audit: AuditLogsService,
  ) {}

  /**
   * Reads a setting's value, cached.
   *
   * Settings are read on hot paths — the grading scale is consulted for every
   * term result — and change rarely, so caching is worth the invalidation cost.
   * Returns null when absent so callers can fall back to their own default.
   */
  async getValue<T>(key: string): Promise<T | null> {
    const cacheKey = `${CACHE_PREFIX}${key}`;
    const cached = await this.cache.get<{ value: T }>(cacheKey);
    if (cached) return cached.value;

    const setting = await this.model.findOne({ key, deletedAt: null }).lean().exec();
    if (!setting) return null;

    // Wrapped in an object so a legitimately falsy value (0, false, '') is not
    // mistaken for a cache miss.
    await this.cache.set(cacheKey, { value: setting.value }, CACHE_TTL_MS);
    return setting.value as T;
  }

  async findAll(category?: string, publicOnly = false) {
    const filter: Record<string, unknown> = { deletedAt: null };
    if (category) filter.category = category;
    if (publicOnly) filter.isPublic = true;
    return this.model.find(filter).sort({ category: 1, key: 1 }).exec();
  }

  async findOne(key: string) {
    const setting = await this.model.findOne({ key, deletedAt: null }).exec();
    if (!setting) throw AppException.notFound();
    return setting;
  }

  async upsert(
    dto: UpsertSettingDto,
    actor: AuthenticatedUser,
    ip: string | null,
  ): Promise<SettingDocument> {
    const existing = await this.model.findOne({ key: dto.key, deletedAt: null }).exec();

    const updated = await this.model
      .findOneAndUpdate(
        { key: dto.key },
        {
          $set: {
            value: dto.value,
            category: dto.category ?? existing?.category ?? 'general',
            description: dto.description ?? existing?.description ?? null,
            isPublic: dto.isPublic ?? existing?.isPublic ?? false,
            updatedBy: new Types.ObjectId(actor.sub),
            deletedAt: null,
          },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      )
      .exec();

    await this.cache.del(`${CACHE_PREFIX}${dto.key}`);

    await this.audit.record({
      action: existing ? 'update' : 'create',
      entityType: 'settings',
      entityId: updated._id,
      userId: actor.sub,
      username: actor.username,
      oldValue: existing ? { value: existing.value } : null,
      newValue: { value: dto.value },
      ip,
    });

    return updated;
  }

  async remove(key: string, actor: AuthenticatedUser, ip: string | null): Promise<void> {
    const setting = await this.findOne(key);
    if (setting.isSystem) {
      throw AppException.forbidden('auth.forbidden', {
        reason: 'system settings cannot be deleted',
      });
    }

    setting.deletedAt = new Date();
    setting.deletedBy = new Types.ObjectId(actor.sub);
    await setting.save();
    await this.cache.del(`${CACHE_PREFIX}${key}`);

    await this.audit.record({
      action: 'delete',
      entityType: 'settings',
      entityId: setting._id,
      userId: actor.sub,
      username: actor.username,
      oldValue: { key, value: setting.value },
      ip,
    });
  }
}
