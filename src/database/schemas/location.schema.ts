import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, SchemaTypes, Types } from 'mongoose';
import { LOCATION_TYPES, LocationType } from 'src/common/constants/enums';
import { baseSchemaOptions, LAO_COLLATION, SoftDeletableDocument } from './base.schema';

export type LocationDocument = HydratedDocument<Location>;

/**
 * province → district → village, stored with a materialized path.
 *
 * `ancestors` holds every id from the root down to the direct parent, which turns
 * "every village in this province" into a single indexed equality match instead of
 * a `$graphLookup`. See docs/schema-design.md §3.2.
 */
@Schema({ collection: 'locations', ...baseSchemaOptions })
export class Location extends SoftDeletableDocument {
  @Prop({ type: String, required: true, trim: true })
  nameLo: string;

  @Prop({ type: String, default: null, trim: true })
  nameEn?: string | null;

  @Prop({ type: String, default: null, trim: true })
  code?: string | null;

  @Prop({ type: String, required: true, enum: LOCATION_TYPES })
  type: LocationType;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'Location', default: null })
  parentId?: Types.ObjectId | null;

  /** Root-first: `[provinceId, districtId]` for a village. */
  @Prop({ type: [SchemaTypes.ObjectId], ref: 'Location', default: [] })
  ancestors: Types.ObjectId[];

  /** 0 = province, 1 = district, 2 = village. Kept for cheap level filtering. */
  @Prop({ type: Number, default: 0 })
  depth: number;
}

export const LocationSchema = SchemaFactory.createForClass(Location);

LocationSchema.index({ ancestors: 1 });
LocationSchema.index({ parentId: 1, type: 1 });
LocationSchema.index({ type: 1, nameLo: 1 }, { collation: LAO_COLLATION });
