import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import {
  CONSENT_STATUSES,
  ConsentStatus,
  GENDERS,
  Gender,
  VACCINATION_CAMPAIGN_STATUSES,
  VACCINATION_STATUSES,
  VACCINES,
  Vaccine,
  VaccinationCampaignStatus,
  VaccinationStatus,
} from 'src/common/constants/enums';
import { baseSchemaOptions, SoftDeletableDocument } from './base.schema';

/**
 * Vaccination is held in its own collections rather than on the student.
 *
 * Two reasons, and the first is access: a child's HPV record is the nurse's, not
 * the office's, and embedding it would mean any reader of the student register
 * reads it too. Its own collection lets the `vaccinations` permission gate it
 * without hiding the register.
 *
 * The second is shape. Memberships are at most three per student and go on the
 * document; doses are unbounded — several vaccines, several doses each, over
 * seven years — and every question the school actually asks is a query across
 * students ("who in ມ.3 still needs dose 2"), not a read of one document.
 */

// ── Campaigns ───────────────────────────────────────────────────────────────

/**
 * Who the round is *offered* to — the filter behind the student picker.
 *
 * Not the roll itself. The roll is `studentIds`, chosen by hand, because a rule
 * that sweeps the whole school is broader than any round the health centre
 * actually runs: it puts children on a sheet nobody decided to vaccinate.
 *
 * This is still where "girls only" lives, and it still earns its place: it keeps
 * a boy out of the picker for an HPV round, so the office narrows a list rather
 * than reading every name. It remains a decision someone recorded — never
 * something derived from a student's gender behind their back.
 */
@Schema({ _id: false })
export class CampaignEligibility {
  /** `null` covers every student, which is the usual case. */
  @Prop({ type: String, default: null, enum: [...GENDERS, null] })
  gender?: Gender | null;

  /** Empty covers every grade. */
  @Prop({ type: [Types.ObjectId], ref: 'GradeLevel', default: [] })
  gradeLevelIds: Types.ObjectId[];

  /**
   * The birth-date window, as the health centre states it.
   *
   * Dates rather than an age range: an age is only true on the day it is read,
   * and a campaign's target cohort has to mean the same thing when the list is
   * rebuilt a month later.
   */
  @Prop({ type: Date, default: null })
  bornFrom?: Date | null;

  @Prop({ type: Date, default: null })
  bornTo?: Date | null;
}

export const CampaignEligibilitySchema = SchemaFactory.createForClass(CampaignEligibility);

export type VaccinationCampaignDocument = HydratedDocument<VaccinationCampaign>;

@Schema({ collection: 'vaccinationCampaigns', ...baseSchemaOptions })
export class VaccinationCampaign extends SoftDeletableDocument {
  /** As the school announces it — `ວັກຊີນ HPV ເຂັມທີ 1, ພະຈິກ 2026`. */
  @Prop({ type: String, required: true, trim: true })
  nameLo: string;

  @Prop({ type: String, required: true, enum: VACCINES })
  vaccine: Vaccine;

  /**
   * Which dose of the course this round gives.
   *
   * Part of the campaign because a second dose is a second visit, months later,
   * with its own consent and its own absentees.
   */
  @Prop({ type: Number, required: true, min: 1 })
  doseNumber: number;

  @Prop({ type: Date, required: true })
  scheduledDate: Date;

  @Prop({ type: Types.ObjectId, ref: 'SchoolYear', required: true, index: true })
  schoolYearId: Types.ObjectId;

  /** Narrows the student picker. See `CampaignEligibility`. */
  @Prop({ type: CampaignEligibilitySchema, default: () => ({}) })
  eligibility: CampaignEligibility;

  /**
   * The students this round covers, chosen one by one.
   *
   * Explicit rather than resolved from `eligibility` on read, because the school
   * decides who is on a round — and the difference matters in both directions: a
   * child the rule would sweep in but nobody selected is not on the sheet, and a
   * child who transferred in last week is added by opening the picker rather
   * than appearing on it unannounced.
   *
   * The cost of that control is that it is a list someone has to maintain: a
   * newcomer is not on the round until the office puts them there.
   */
  @Prop({ type: [Types.ObjectId], ref: 'Student', default: [] })
  studentIds: Types.ObjectId[];

  /** `ໂຮງໝໍ` or `ສູນສາທາລະນະສຸກ` sending the team. */
  @Prop({ type: String, default: null, trim: true })
  provider?: string | null;

  @Prop({
    type: String,
    required: true,
    enum: VACCINATION_CAMPAIGN_STATUSES,
    default: 'planned',
  })
  status: VaccinationCampaignStatus;

  @Prop({ type: String, default: null })
  notes?: string | null;
}

export const VaccinationCampaignSchema = SchemaFactory.createForClass(VaccinationCampaign);

VaccinationCampaignSchema.index({ schoolYearId: 1, scheduledDate: -1 });
VaccinationCampaignSchema.index({ vaccine: 1, doseNumber: 1, scheduledDate: -1 });

// ── Records ─────────────────────────────────────────────────────────────────

/**
 * `ໃບຍິນຍອມ` from the guardian.
 *
 * `guardianId` rather than a name: the consent has to be traceable to a person
 * on file who may be asked about it, and the student's guardian list already
 * holds them. `pending` is the honest default — a dose whose consent was never
 * sought must not read the same as one a parent agreed to.
 */
@Schema({ _id: false })
export class VaccinationConsent {
  @Prop({ type: String, required: true, enum: CONSENT_STATUSES, default: 'pending' })
  status: ConsentStatus;

  @Prop({ type: Types.ObjectId, ref: 'Guardian', default: null })
  guardianId?: Types.ObjectId | null;

  @Prop({ type: Date, default: null })
  decidedAt?: Date | null;

  /** How it was obtained — `ໃບເຊັນ`, `ໂທລະສັບ`, `ປະຊຸມຜູ້ປົກຄອງ`. */
  @Prop({ type: String, default: null, trim: true })
  method?: string | null;
}

export const VaccinationConsentSchema = SchemaFactory.createForClass(VaccinationConsent);

export type VaccinationDocument = HydratedDocument<Vaccination>;

/**
 * One student, one vaccine, one dose.
 *
 * Not a list of doses on a single record: a student misses dose 2, or gets it
 * from a clinic six months late, and each dose carries its own date, batch and
 * consent. One row per dose is also what the unique index can hold, so the same
 * dose cannot be entered twice by two people on campaign day.
 */
@Schema({ collection: 'vaccinations', ...baseSchemaOptions })
export class Vaccination extends SoftDeletableDocument {
  @Prop({ type: Types.ObjectId, ref: 'Student', required: true, index: true })
  studentId: Types.ObjectId;

  /**
   * The campaign this dose belongs to, or `null` for one given elsewhere.
   *
   * Nullable because the school records doses a family had at a clinic, and
   * those count towards the course without belonging to any round held here.
   */
  @Prop({ type: Types.ObjectId, ref: 'VaccinationCampaign', default: null, index: true })
  campaignId?: Types.ObjectId | null;

  /**
   * Copied from the campaign rather than read through it, so a dose stays
   * queryable when it has no campaign, and so amending a campaign cannot
   * silently restate what a child was given.
   */
  @Prop({ type: String, required: true, enum: VACCINES })
  vaccine: Vaccine;

  @Prop({ type: Number, required: true, min: 1 })
  doseNumber: number;

  @Prop({ type: String, required: true, enum: VACCINATION_STATUSES, default: 'scheduled' })
  status: VaccinationStatus;

  /** Set only once `status` is `administered`; null for every other outcome. */
  @Prop({ type: Date, default: null })
  administeredDate?: Date | null;

  /** `ເລກລ໊ອດ` off the vial, which a recall is traced by. */
  @Prop({ type: String, default: null, trim: true })
  batchNumber?: string | null;

  @Prop({ type: String, default: null, trim: true })
  provider?: string | null;

  @Prop({ type: VaccinationConsentSchema, default: () => ({}) })
  consent: VaccinationConsent;

  /**
   * Why, for the outcomes that need one — the reason for a refusal, or the
   * condition behind `contraindicated`. Deliberately the only clinical field
   * here: this collection records vaccination, not a medical history.
   */
  @Prop({ type: String, default: null })
  notes?: string | null;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  recordedBy: Types.ObjectId;
}

export const VaccinationSchema = SchemaFactory.createForClass(Vaccination);

// One row per student per dose. Partial so a soft-deleted correction does not
// block re-entering the dose it was replaced by.
VaccinationSchema.index(
  { studentId: 1, vaccine: 1, doseNumber: 1 },
  { unique: true, partialFilterExpression: { deletedAt: null } },
);
// Drives campaign day: the roll for one round, and the follow-up list off it.
VaccinationSchema.index({ campaignId: 1, status: 1 });
