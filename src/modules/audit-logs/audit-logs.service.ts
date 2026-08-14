import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import { AuditAction } from 'src/common/constants/enums';
import { PaginatedResponse } from 'src/common/dto/pagination.dto';
import { toApiDocuments } from 'src/common/utils/serialize';
import { AuditLog, AuditLogDocument } from 'src/database/schemas';
import { QueryAuditLogsDto } from './dto/query-audit-logs.dto';

/** Never written to the audit trail, even if a caller passes them in. */
const REDACTED_FIELDS = new Set([
  'password',
  'passwordHash',
  'currentPassword',
  'newPassword',
  'confirmPassword',
  'refreshTokens',
  'refreshToken',
  'accessToken',
  'passwordResetTokenHash',
  'token',
  'secret',
]);

export interface AuditEntry {
  userId?: string | Types.ObjectId | null;
  username?: string | null;
  action: AuditAction;
  entityType: string;
  entityId?: string | Types.ObjectId | null;
  oldValue?: Record<string, unknown> | null;
  newValue?: Record<string, unknown> | null;
  ip?: string | null;
  userAgent?: string | null;
  reason?: string | null;
}

@Injectable()
export class AuditLogsService {
  private readonly logger = new Logger(AuditLogsService.name);

  constructor(@InjectModel(AuditLog.name) private readonly model: Model<AuditLogDocument>) {}

  /**
   * Records an entry.
   *
   * Pass `session` when the audited write is part of a transaction so the log
   * and the change commit or roll back together — an audit row describing a
   * change that was rolled back is worse than no row.
   *
   * Without a session, a failure here is logged and swallowed: audit logging
   * must not turn a successful business operation into a 500.
   */
  async record(entry: AuditEntry, session?: ClientSession): Promise<void> {
    const doc = {
      userId: this.toObjectId(entry.userId),
      username: entry.username ?? null,
      action: entry.action,
      entityType: entry.entityType,
      entityId: this.toObjectId(entry.entityId),
      oldValue: entry.oldValue ? redactSensitive(entry.oldValue) : null,
      newValue: entry.newValue ? redactSensitive(entry.newValue) : null,
      ip: entry.ip ?? null,
      userAgent: entry.userAgent ?? null,
      reason: entry.reason ?? null,
    };

    if (session) {
      await this.model.create([doc], { session });
      return;
    }

    try {
      await this.model.create(doc);
    } catch (error) {
      this.logger.error(
        `Failed to write audit log for ${entry.action} on ${entry.entityType}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  async findAll(query: QueryAuditLogsDto): Promise<PaginatedResponse<AuditLogDocument>> {
    const filter: Record<string, unknown> = {};
    if (query.userId) filter.userId = new Types.ObjectId(query.userId);
    if (query.entityType) filter.entityType = query.entityType;
    if (query.entityId) filter.entityId = new Types.ObjectId(query.entityId);
    if (query.action) filter.action = query.action;
    if (query.from || query.to) {
      filter.createdAt = {
        ...(query.from ? { $gte: new Date(query.from) } : {}),
        ...(query.to ? { $lte: new Date(query.to) } : {}),
      };
    }

    const [data, total] = await Promise.all([
      this.model
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(query.skip)
        .limit(query.limit)
        .lean()
        .exec(),
      this.model.countDocuments(filter).exec(),
    ]);

    // Lean read, so `_id` is normalized to `id` for response consistency.
    return new PaginatedResponse(
      toApiDocuments(data as { _id?: unknown }[]) as unknown as AuditLogDocument[],
      total,
      query.page,
      query.limit,
    );
  }

  private toObjectId(value?: string | Types.ObjectId | null): Types.ObjectId | null {
    if (!value) return null;
    return typeof value === 'string' ? new Types.ObjectId(value) : value;
  }
}

/**
 * Strips secrets from an object before it is persisted.
 *
 * Recurses into nested objects and arrays, since a DTO can nest a credential
 * one level down (e.g. `{ user: { password } }`).
 */
export function redactSensitive(value: unknown): Record<string, unknown> {
  const walk = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map(walk);
    if (input instanceof Date || input instanceof Types.ObjectId) return input;
    if (input && typeof input === 'object') {
      return Object.fromEntries(
        Object.entries(input as Record<string, unknown>).map(([key, val]) =>
          REDACTED_FIELDS.has(key) ? [key, '[REDACTED]'] : [key, walk(val)],
        ),
      );
    }
    return input;
  };

  return walk(value) as Record<string, unknown>;
}

/**
 * Field-level diff between two states.
 *
 * Storing only what changed keeps the audit collection small and makes the log
 * readable — a full before/after snapshot of a student document buries the one
 * field that actually moved.
 */
export function diffFields(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): { oldValue: Record<string, unknown>; newValue: Record<string, unknown> } {
  const oldValue: Record<string, unknown> = {};
  const newValue: Record<string, unknown> = {};

  for (const key of Object.keys(after)) {
    if (key === 'updatedAt' || key === '_id' || key === 'id') continue;
    const a = before[key];
    const b = after[key];
    if (JSON.stringify(a) !== JSON.stringify(b)) {
      oldValue[key] = a ?? null;
      newValue[key] = b ?? null;
    }
  }

  return { oldValue, newValue };
}
