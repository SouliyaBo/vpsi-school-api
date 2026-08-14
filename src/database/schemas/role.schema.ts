import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import {
  PERMISSION_ACTIONS,
  PERMISSION_RESOURCES,
  PermissionAction,
  PermissionResource,
} from 'src/common/constants/enums';
import { baseSchemaOptions, SoftDeletableDocument } from './base.schema';

/**
 * One row of the permission matrix: what a role may do to one resource.
 *
 * Embedded rather than referenced — the matrix is read on every authorization
 * check and is meaningless apart from its role.
 */
@Schema({ _id: false })
export class Permission {
  @Prop({ type: String, required: true, enum: PERMISSION_RESOURCES })
  resource: PermissionResource;

  @Prop({ type: [String], required: true, enum: PERMISSION_ACTIONS, default: [] })
  actions: PermissionAction[];
}

export const PermissionSchema = SchemaFactory.createForClass(Permission);

export type RoleDocument = HydratedDocument<Role>;

@Schema({ collection: 'roles', ...baseSchemaOptions })
export class Role extends SoftDeletableDocument {
  /** Stable machine key used in code and seeds, e.g. `admin`, `teacher`. */
  @Prop({ type: String, required: true, trim: true })
  code: string;

  @Prop({ type: String, required: true, trim: true })
  nameLo: string;

  @Prop({ type: String, required: true, trim: true })
  nameEn: string;

  @Prop({ type: String, default: null })
  description?: string | null;

  @Prop({ type: [PermissionSchema], default: [] })
  permissions: Permission[];

  /**
   * System roles cannot be deleted or have their `code` changed — deleting
   * `admin` would lock everyone out.
   */
  @Prop({ type: Boolean, default: false })
  isSystem: boolean;
}

export const RoleSchema = SchemaFactory.createForClass(Role);

RoleSchema.index({ code: 1 }, { unique: true });
