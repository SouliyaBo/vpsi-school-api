import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import { PaginatedResponse } from 'src/common/dto/pagination.dto';
import { AppException } from 'src/common/exceptions/app.exception';
import { CrudContext } from 'src/common/services/base-crud.service';
import { Role, RoleDocument, User, UserDocument } from 'src/database/schemas';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuthService } from '../auth/auth.service';
import { AdminResetPasswordDto, CreateUserDto } from '../auth/dto/auth.dto';
import { QueryUsersDto, UpdateUserDto } from './dto/user.dto';

@Injectable()
export class UsersService {
  constructor(
    @InjectModel(User.name) private readonly model: Model<UserDocument>,
    @InjectModel(Role.name) private readonly roleModel: Model<RoleDocument>,
    private readonly audit: AuditLogsService,
  ) {}

  async findAll(query: QueryUsersDto): Promise<PaginatedResponse<UserDocument>> {
    const filter: Record<string, unknown> = { deletedAt: null };
    if (query.roleId) filter.roleId = new Types.ObjectId(query.roleId);
    if (query.status) filter.status = query.status;
    if (query.personType) filter.personType = query.personType;
    if (query.search) {
      const escaped = escapeRegex(query.search);
      filter.$or = [
        { username: { $regex: escaped, $options: 'i' } },
        { email: { $regex: escaped, $options: 'i' } },
      ];
    }

    const sort = query.toSort(['username', 'createdAt', 'lastLoginAt'], { createdAt: -1 });

    const [data, total] = await Promise.all([
      this.model
        .find(filter)
        .populate('roleId', 'code nameLo nameEn')
        .sort(sort)
        .skip(query.skip)
        .limit(query.limit)
        .exec(),
      this.model.countDocuments(filter).exec(),
    ]);

    return new PaginatedResponse(data, total, query.page, query.limit);
  }

  async findOne(id: string): Promise<UserDocument> {
    if (!Types.ObjectId.isValid(id)) throw AppException.notFound();
    const user = await this.model
      .findOne({ _id: id, deletedAt: null })
      .populate('roleId', 'code nameLo nameEn permissions')
      .exec();
    if (!user) throw AppException.notFound();
    return user;
  }

  /**
   * Creates an account.
   *
   * Accepts a session so it can join the transaction that creates the person
   * this account belongs to — a student and their login must both exist or
   * neither should.
   */
  async create(
    dto: CreateUserDto,
    context: CrudContext & { session?: ClientSession } = {},
  ): Promise<UserDocument> {
    const role = await this.roleModel
      .findOne({ _id: dto.roleId, deletedAt: null })
      .session(context.session ?? null)
      .exec();
    if (!role) throw AppException.badRequest('common.notFound', { field: 'roleId' });

    if (dto.personType !== 'staff' && !dto.personId) {
      throw AppException.badRequest('common.validationFailed', {
        field: 'personId',
        reason: 'personId is required unless personType is "staff"',
      });
    }

    const passwordHash = await AuthService.hashPassword(dto.password);

    const [created] = await this.model.create(
      [
        {
          username: dto.username,
          email: dto.email ?? null,
          passwordHash,
          roleId: new Types.ObjectId(dto.roleId),
          personType: dto.personType,
          personId: dto.personId ? new Types.ObjectId(dto.personId) : null,
          // Default on: an account created by someone else starts with a
          // password that person knows, so it must be replaced at first login.
          mustChangePassword: dto.mustChangePassword ?? true,
        },
      ],
      { session: context.session },
    );

    await this.audit.record(
      {
        action: 'create',
        entityType: 'users',
        entityId: created._id,
        userId: context.actor?.sub,
        username: context.actor?.username,
        newValue: { username: created.username, roleId: dto.roleId, personType: dto.personType },
        ip: context.ip,
      },
      context.session,
    );

    return created;
  }

  async update(id: string, dto: UpdateUserDto, context: CrudContext): Promise<UserDocument> {
    const before = await this.findOne(id);

    if (dto.roleId) {
      const role = await this.roleModel.findOne({ _id: dto.roleId, deletedAt: null }).exec();
      if (!role) throw AppException.badRequest('common.notFound', { field: 'roleId' });
    }

    const updated = await this.model
      .findOneAndUpdate({ _id: id, deletedAt: null }, dto, { new: true, runValidators: true })
      .exec();
    if (!updated) throw AppException.notFound();

    // Suspending an account or changing its role must not leave live sessions
    // running under the old authority.
    if (dto.status && dto.status !== 'active') {
      await this.revokeAllSessions(id);
    }

    await this.audit.record({
      action: 'update',
      entityType: 'users',
      entityId: updated._id,
      userId: context.actor?.sub,
      username: context.actor?.username,
      oldValue: { status: before.status, roleId: before.roleId?.toString() },
      newValue: { status: updated.status, roleId: updated.roleId?.toString() },
      ip: context.ip,
    });

    return updated;
  }

  /** Sets a temporary password and forces a change at next login. */
  async adminResetPassword(
    id: string,
    dto: AdminResetPasswordDto,
    context: CrudContext,
  ): Promise<void> {
    const user = await this.findOne(id);
    user.passwordHash = await AuthService.hashPassword(dto.temporaryPassword);
    user.mustChangePassword = true;
    user.passwordChangedAt = new Date();
    user.failedLoginAttempts = 0;
    user.lockedUntil = null;
    user.refreshTokens = [];
    await user.save();

    await this.audit.record({
      action: 'password_reset',
      entityType: 'users',
      entityId: user._id,
      userId: context.actor?.sub,
      username: context.actor?.username,
      reason: 'administrative reset',
      ip: context.ip,
    });
  }

  /** Clears a lockout ahead of its expiry. */
  async unlock(id: string, context: CrudContext): Promise<void> {
    const user = await this.findOne(id);
    user.lockedUntil = null;
    user.failedLoginAttempts = 0;
    await user.save();

    await this.audit.record({
      action: 'unlock',
      entityType: 'users',
      entityId: user._id,
      userId: context.actor?.sub,
      username: context.actor?.username,
      ip: context.ip,
    });
  }

  async remove(id: string, context: CrudContext): Promise<void> {
    const user = await this.findOne(id);
    user.deletedAt = new Date();
    user.deletedBy = context.actor?.sub ? new Types.ObjectId(context.actor.sub) : null;
    user.refreshTokens = [];
    user.status = 'inactive';
    await user.save();

    await this.audit.record({
      action: 'delete',
      entityType: 'users',
      entityId: user._id,
      userId: context.actor?.sub,
      username: context.actor?.username,
      oldValue: { username: user.username },
      ip: context.ip,
    });
  }

  private async revokeAllSessions(userId: string): Promise<void> {
    await this.model.updateOne({ _id: userId }, { $set: { refreshTokens: [] } }).exec();
  }
}

/** Neutralizes regex metacharacters so user input cannot alter the pattern. */
export function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
