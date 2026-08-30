import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { baseSchemaOptions, SoftDeletableDocument } from './base.schema';

/**
 * ການຕັດຄະແນນອຸປະນິໄສ — the discipline ledger.
 *
 * The school publishes a rule sheet each year: every child starts a term on 100
 * conduct points and loses 5, 10, 15 or 20 of them per occurrence against a
 * numbered rule. What is stored here is that act — this child, this rule, this
 * day — and never the balance, which is a sum and so can only ever be right if
 * it is recomputed. `ConductScore` in `assessment.schema.ts` is where the
 * resulting term mark is published, because that is what the report card prints.
 *
 * Two collections rather than one: the rule sheet is reissued and reworded every
 * year, and a ledger row must keep saying what it was written for. Hence the
 * snapshot fields on the row alongside the reference.
 */

// ── Rule (ລະບຽບ) ────────────────────────────────────────────────────────────

export type ConductRuleDocument = HydratedDocument<ConductRule>;

@Schema({ collection: 'conductRules', ...baseSchemaOptions })
export class ConductRule extends SoftDeletableDocument {
  /**
   * The number the sheet gives it — `2.3` for the third rule in the 10-point
   * column.
   *
   * Kept as the school writes it rather than generated, because this is what a
   * teacher reads off the printed sheet and what a report back to a guardian
   * cites.
   */
  @Prop({ type: String, required: true, trim: true })
  code: string;

  /** ຕັດ N ຄະແນນ/ຄັ້ງ — what one occurrence costs. */
  @Prop({ type: Number, required: true, min: 1, max: 100 })
  points: number;

  @Prop({ type: String, required: true, trim: true })
  nameLo: string;

  @Prop({ type: String, default: null, trim: true })
  nameEn?: string | null;

  /**
   * Withdrawn rather than deleted when the sheet is reissued without it: the
   * ledger rows written under it stay valid, and the picker stops offering it.
   */
  @Prop({ type: Boolean, default: true, index: true })
  isActive: boolean;

  /** Position within its points column; ties fall back to `code`. */
  @Prop({ type: Number, default: 0 })
  sortOrder: number;
}

export const ConductRuleSchema = SchemaFactory.createForClass(ConductRule);
ConductRuleSchema.index(
  { code: 1 },
  { unique: true, partialFilterExpression: { deletedAt: null } },
);
// The picker, which reads the sheet in its printed order: columns left to right.
ConductRuleSchema.index({ isActive: 1, points: 1, sortOrder: 1 });

// ── Deduction (ການຕັດຄະແນນ) ─────────────────────────────────────────────────

export type ConductDeductionDocument = HydratedDocument<ConductDeduction>;

@Schema({ collection: 'conductDeductions', ...baseSchemaOptions })
export class ConductDeduction extends SoftDeletableDocument {
  @Prop({ type: Types.ObjectId, ref: 'Student', required: true, index: true })
  studentId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Classroom', required: true, index: true })
  classroomId: Types.ObjectId;

  /**
   * The term the balance is counted within.
   *
   * Resolved server-side from `date` rather than accepted from the client, so a
   * deduction cannot be filed into a term it did not happen in.
   */
  @Prop({ type: Types.ObjectId, ref: 'Semester', required: true, index: true })
  semesterId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'SchoolYear', required: true })
  schoolYearId: Types.ObjectId;

  /** Normalized to UTC midnight so a day is one exact value, never a range. */
  @Prop({ type: Date, required: true })
  date: Date;

  @Prop({ type: Types.ObjectId, ref: 'ConductRule', required: true, index: true })
  ruleId: Types.ObjectId;

  /**
   * The rule as it read on the day, copied at write time.
   *
   * Next year's sheet renumbers and rewords; a deduction that then displayed the
   * new text would be a quiet rewriting of what the child was told they did.
   */
  @Prop({ type: String, required: true })
  ruleCode: string;

  @Prop({ type: String, required: true })
  ruleNameLo: string;

  /** What this occurrence actually cost — the rule's points on the day. */
  @Prop({ type: Number, required: true, min: 1, max: 100 })
  points: number;

  /** ໝາຍເຫດ — the circumstances, where the rule alone does not say enough. */
  @Prop({ type: String, default: null, trim: true })
  note?: string | null;

  /**
   * Why it was taken back, set when the row is withdrawn.
   *
   * Kept apart from `note` rather than replacing it: the note says what the
   * child was told they did, and an appeal is read by comparing the two. A
   * withdrawal that overwrote the accusation would leave a record that cannot be
   * checked.
   */
  @Prop({ type: String, default: null, trim: true })
  revokeReason?: string | null;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  recordedBy: Types.ObjectId;
}

export const ConductDeductionSchema = SchemaFactory.createForClass(ConductDeduction);
// The two reads the screens make: one class's term, and one child's term.
ConductDeductionSchema.index({ classroomId: 1, semesterId: 1, date: -1 });
ConductDeductionSchema.index({ studentId: 1, semesterId: 1, date: -1 });
