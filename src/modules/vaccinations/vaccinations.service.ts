import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { PaginatedResponse } from 'src/common/dto/pagination.dto';
import { AppException } from 'src/common/exceptions/app.exception';
import type { MessageKey } from 'src/common/i18n/messages';
import type { AuthenticatedUser } from 'src/common/interfaces/authenticated-user.interface';
import { RecordScopeService } from 'src/common/services/record-scope.service';
import {
  Enrollment,
  EnrollmentDocument,
  Student,
  StudentDocument,
  Vaccination,
  VaccinationCampaign,
  VaccinationCampaignDocument,
  VaccinationDocument,
} from 'src/database/schemas';
import { TransactionHelper } from 'src/database/transaction.helper';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import {
  DoseViolation,
  keepsAdministrationDetails,
  matchesEligibility,
  violationFor,
} from './dose-rules';
import {
  CreateCampaignDto,
  QueryCampaignsDto,
  QueryVaccinationsDto,
  RecordCampaignDosesDto,
  RecordStandaloneVaccinationDto,
  RecordVaccinationDto,
  UpdateCampaignDto,
} from './dto/vaccination.dto';

/** The fields a roll or a follow-up list needs off the student. */
const ROLL_SELECT = 'studentCode firstNameLo lastNameLo nickname gender dateOfBirth guardians';

/** A classroom as the roll shows it. */
export interface ClassroomRef {
  _id: Types.ObjectId;
  name: string;
}

/** One student on a campaign's roll, with whatever is already recorded for them. */
export interface CampaignRollEntry {
  student: StudentDocument;
  record: VaccinationDocument | null;
  /** Where they sit this year — `null` when the placement has gone. */
  classroom: ClassroomRef | null;
}

/** One name the picker offers, and whether it may be picked or dropped. */
export interface CampaignCandidate {
  student: StudentDocument;
  /** False for a name the round does not cover — shown, but not pickable. */
  eligible: boolean;
  selected: boolean;
  /** Set once a dose is recorded, after which the student cannot be dropped. */
  record: VaccinationDocument | null;
}

@Injectable()
export class VaccinationsService {
  constructor(
    @InjectModel(VaccinationCampaign.name)
    private readonly campaigns: Model<VaccinationCampaignDocument>,
    @InjectModel(Vaccination.name) private readonly records: Model<VaccinationDocument>,
    @InjectModel(Student.name) private readonly students: Model<StudentDocument>,
    @InjectModel(Enrollment.name) private readonly enrollments: Model<EnrollmentDocument>,
    private readonly audit: AuditLogsService,
    private readonly scope: RecordScopeService,
    private readonly tx: TransactionHelper,
  ) {}

  // ── Campaigns ─────────────────────────────────────────────────────────────

  async findAllCampaigns(
    query: QueryCampaignsDto,
  ): Promise<PaginatedResponse<VaccinationCampaignDocument>> {
    const filter: Record<string, unknown> = { deletedAt: null };
    if (query.schoolYearId) filter.schoolYearId = new Types.ObjectId(query.schoolYearId);
    if (query.vaccine) filter.vaccine = query.vaccine;
    if (query.status) filter.status = query.status;

    const [data, total] = await Promise.all([
      this.campaigns
        .find(filter)
        .sort({ scheduledDate: -1 })
        .skip(query.skip)
        .limit(query.limit)
        .exec(),
      this.campaigns.countDocuments(filter).exec(),
    ]);

    return new PaginatedResponse(data, total, query.page, query.limit);
  }

  async findCampaignOrFail(id: string): Promise<VaccinationCampaignDocument> {
    const campaign = await this.campaigns.findOne({ _id: id, deletedAt: null }).exec();
    if (!campaign) throw AppException.notFound();
    return campaign;
  }

  async createCampaign(
    dto: CreateCampaignDto,
    actor: AuthenticatedUser,
    ip: string | null,
  ): Promise<VaccinationCampaignDocument> {
    const created = await this.campaigns.create({
      ...dto,
      scheduledDate: new Date(dto.scheduledDate),
      schoolYearId: new Types.ObjectId(dto.schoolYearId),
      // A new round starts empty. The picker fills it, so a campaign never
      // begins life covering children nobody chose.
      studentIds: [],
      eligibility: {
        gender: dto.eligibility?.gender ?? null,
        gradeLevelIds: (dto.eligibility?.gradeLevelIds ?? []).map((id) => new Types.ObjectId(id)),
        bornFrom: dto.eligibility?.bornFrom ? new Date(dto.eligibility.bornFrom) : null,
        bornTo: dto.eligibility?.bornTo ? new Date(dto.eligibility.bornTo) : null,
      },
    });

    await this.audit.record({
      action: 'create',
      entityType: 'vaccinationCampaigns',
      entityId: created._id,
      userId: actor.sub,
      username: actor.username,
      newValue: { nameLo: created.nameLo, vaccine: created.vaccine, dose: created.doseNumber },
      ip,
    });

    return created;
  }

  async updateCampaign(
    id: string,
    dto: UpdateCampaignDto,
    actor: AuthenticatedUser,
    ip: string | null,
  ): Promise<VaccinationCampaignDocument> {
    const campaign = await this.findCampaignOrFail(id);

    const patch: Record<string, unknown> = { ...dto };
    if (dto.scheduledDate) patch.scheduledDate = new Date(dto.scheduledDate);
    if (dto.eligibility) {
      patch.eligibility = {
        gender: dto.eligibility.gender ?? null,
        gradeLevelIds: (dto.eligibility.gradeLevelIds ?? []).map((gid) => new Types.ObjectId(gid)),
        bornFrom: dto.eligibility.bornFrom ? new Date(dto.eligibility.bornFrom) : null,
        bornTo: dto.eligibility.bornTo ? new Date(dto.eligibility.bornTo) : null,
      };
    }

    const updated = await this.campaigns
      .findOneAndUpdate({ _id: campaign._id }, { $set: patch }, { new: true })
      .exec();

    await this.audit.record({
      action: 'update',
      entityType: 'vaccinationCampaigns',
      entityId: campaign._id,
      userId: actor.sub,
      username: actor.username,
      oldValue: { status: campaign.status, scheduledDate: campaign.scheduledDate },
      newValue: { status: updated!.status, scheduledDate: updated!.scheduledDate },
      ip,
    });

    return updated!;
  }

  /**
   * Soft-deletes a campaign, unless doses were already given under it.
   *
   * A round that happened is a fact about the children who attended it; removing
   * it would orphan their records from the reason they exist. Cancelling is what
   * `status` is for.
   */
  async removeCampaign(id: string, actor: AuthenticatedUser, ip: string | null): Promise<void> {
    const campaign = await this.findCampaignOrFail(id);

    const given = await this.records
      .countDocuments({ campaignId: campaign._id, status: 'administered', deletedAt: null })
      .exec();
    if (given > 0) {
      throw AppException.badRequest('vaccination.campaignHasDoses', { count: given });
    }

    campaign.deletedAt = new Date();
    campaign.deletedBy = new Types.ObjectId(actor.sub);
    await campaign.save();

    await this.audit.record({
      action: 'delete',
      entityType: 'vaccinationCampaigns',
      entityId: campaign._id,
      userId: actor.sub,
      username: actor.username,
      oldValue: { nameLo: campaign.nameLo },
      ip,
    });
  }

  // ── The roll ──────────────────────────────────────────────────────────────

  /**
   * Who a campaign covers, with whatever has been recorded for each of them.
   *
   * Read from the campaign's own `studentIds` — the list the office picked — not
   * resolved from the eligibility rule. A rule-swept roll put children on the
   * sheet nobody had decided to vaccinate, which is broader than any round the
   * health centre runs.
   *
   * `classroomId` narrows the view for a round spanning several classes; it does
   * not change who is on the round. `outstandingOnly` drops everyone with a dose
   * already recorded — the follow-up list, which works only because a refusal and
   * an absence are recorded outcomes rather than gaps.
   */
  async campaignRoll(
    id: string,
    options: { outstandingOnly?: boolean; classroomId?: string } = {},
  ): Promise<CampaignRollEntry[]> {
    const campaign = await this.findCampaignOrFail(id);
    if (campaign.studentIds.length === 0) return [];

    const placements = await this.placementsOf(campaign, options.classroomId);

    const students = await this.students
      .find({
        _id: { $in: campaign.studentIds.filter((sid) => placements.has(String(sid))) },
        deletedAt: null,
      })
      .select(ROLL_SELECT)
      .sort({ lastNameLo: 1 })
      .exec();

    const existing = await this.records
      .find({
        studentId: { $in: students.map((student) => student._id) },
        vaccine: campaign.vaccine,
        doseNumber: campaign.doseNumber,
        deletedAt: null,
      })
      .exec();

    const byStudent = new Map(existing.map((record) => [String(record.studentId), record]));

    return students
      .map((student) => ({
        student,
        record: byStudent.get(String(student._id)) ?? null,
        classroom: placements.get(String(student._id)) ?? null,
      }))
      .filter((entry) => !options.outstandingOnly || entry.record === null);
  }

  /**
   * The students of one classroom, as the picker offers them.
   *
   * Everyone in the class is returned rather than only the eligible: a name the
   * round does not cover is shown greyed out and unpickable, which tells the
   * office the list is complete. Silently omitting them looks like a missing
   * enrolment.
   *
   * `record` comes along so the picker can refuse to drop a student whose dose is
   * already recorded.
   */
  async campaignCandidates(id: string, classroomId: string): Promise<CampaignCandidate[]> {
    const campaign = await this.findCampaignOrFail(id);

    const enrolled = await this.enrollments
      .find({
        classroomId: new Types.ObjectId(classroomId),
        schoolYearId: campaign.schoolYearId,
        status: 'active',
        deletedAt: null,
      })
      .select('studentId')
      .exec();

    const students = await this.students
      .find({ _id: { $in: enrolled.map((e) => e.studentId) }, deletedAt: null })
      .select(ROLL_SELECT)
      .sort({ lastNameLo: 1 })
      .exec();

    const existing = await this.records
      .find({
        studentId: { $in: students.map((student) => student._id) },
        vaccine: campaign.vaccine,
        doseNumber: campaign.doseNumber,
        deletedAt: null,
      })
      .exec();
    const byStudent = new Map(existing.map((record) => [String(record.studentId), record]));

    const selected = new Set(campaign.studentIds.map(String));

    return students.map((student) => ({
      student,
      eligible: matchesEligibility(student, campaign.eligibility),
      selected: selected.has(String(student._id)),
      record: byStudent.get(String(student._id)) ?? null,
    }));
  }

  /**
   * Replaces the round's roll.
   *
   * A student whose dose is already recorded cannot be dropped: the record is a
   * fact about a child who attended, and removing them from the round would
   * orphan it from the reason it exists — the same rule that stops a campaign
   * with doses being deleted.
   *
   * Everyone put on the round must be eligible for it, so the rule that narrows
   * the picker is enforced on write too rather than trusted from the client.
   */
  async setCampaignStudents(
    id: string,
    studentIds: string[],
    actor: AuthenticatedUser,
    ip: string | null,
  ): Promise<VaccinationCampaignDocument> {
    const campaign = await this.findCampaignOrFail(id);
    const wanted = [...new Set(studentIds)];

    const recorded = await this.records
      .find({
        campaignId: campaign._id,
        studentId: { $nin: wanted.map((sid) => new Types.ObjectId(sid)) },
        deletedAt: null,
      })
      .select('studentId')
      .exec();

    if (recorded.length > 0) {
      throw AppException.badRequest('vaccination.studentHasRecord', {
        count: recorded.length,
      });
    }

    if (wanted.length > 0) {
      const students = await this.loadStudents(wanted);
      const ineligible = [...students.values()].filter(
        (student) => !matchesEligibility(student, campaign.eligibility),
      );
      if (ineligible.length > 0) {
        throw AppException.badRequest('vaccination.studentNotEligible', {
          studentIds: ineligible.map((student) => student.studentCode).join(', '),
        });
      }
    }

    const updated = await this.campaigns
      .findOneAndUpdate(
        { _id: campaign._id },
        { $set: { studentIds: wanted.map((sid) => new Types.ObjectId(sid)) } },
        { new: true },
      )
      .exec();

    await this.audit.record({
      action: 'update',
      entityType: 'vaccinationCampaigns',
      entityId: campaign._id,
      userId: actor.sub,
      username: actor.username,
      oldValue: { students: campaign.studentIds.length },
      newValue: { students: wanted.length },
      ip,
    });

    return updated!;
  }

  /**
   * Each student's classroom for this campaign's school year.
   *
   * Also the classroom filter: passing one narrows the map, so a student outside
   * it drops off the roll view without being taken off the round.
   */
  private async placementsOf(
    campaign: VaccinationCampaignDocument,
    classroomId?: string,
  ): Promise<Map<string, ClassroomRef>> {
    const filter: Record<string, unknown> = {
      studentId: { $in: campaign.studentIds },
      schoolYearId: campaign.schoolYearId,
      status: 'active',
      deletedAt: null,
    };
    if (classroomId) filter.classroomId = new Types.ObjectId(classroomId);

    const placements = await this.enrollments
      .find(filter)
      .select('studentId classroomId')
      .populate<{ classroomId: ClassroomRef }>('classroomId', 'name gradeLevelId')
      .exec();

    return new Map(
      placements.map((placement) => [String(placement.studentId), placement.classroomId]),
    );
  }

  // ── Records ───────────────────────────────────────────────────────────────

  /**
   * Vaccination records, scoped to what the caller may see.
   *
   * A single-student read is audited: looking up one child's history is the
   * sensitive act, and the trail is the reason this lives behind its own
   * permission. A campaign-wide list is not — it is the nurse's working roll,
   * and logging every page of it would bury the lookups that matter.
   */
  async findAll(
    query: QueryVaccinationsDto,
    actor: AuthenticatedUser,
    ip: string | null,
  ): Promise<PaginatedResponse<VaccinationDocument>> {
    const filter: Record<string, unknown> = { deletedAt: null };
    if (query.studentId) filter.studentId = new Types.ObjectId(query.studentId);
    if (query.campaignId) filter.campaignId = new Types.ObjectId(query.campaignId);
    if (query.vaccine) filter.vaccine = query.vaccine;
    if (query.status) filter.status = query.status;

    await this.scope.applyStudentScope(filter, actor);

    const [data, total] = await Promise.all([
      this.records
        .find(filter)
        .sort({ vaccine: 1, doseNumber: 1 })
        .skip(query.skip)
        .limit(query.limit)
        .exec(),
      this.records.countDocuments(filter).exec(),
    ]);

    if (query.studentId) {
      await this.audit.record({
        action: 'read',
        entityType: 'vaccinations',
        entityId: query.studentId,
        userId: actor.sub,
        username: actor.username,
        ip,
      });
    }

    return new PaginatedResponse(data, total, query.page, query.limit);
  }

  /**
   * Records the outcome for every student on a campaign roll, in one request.
   *
   * Campaign day produces one sheet, not one form per child, and the whole sheet
   * is one transaction: half a roll saved is a follow-up list that quietly omits
   * the other half.
   *
   * Upsert per student, because the nurse corrects the sheet — an absentee who
   * turns up later is the same dose, not a second one, which the unique index on
   * (student, vaccine, dose) says too.
   */
  async recordCampaignDoses(
    campaignId: string,
    dto: RecordCampaignDosesDto,
    actor: AuthenticatedUser,
    ip: string | null,
  ): Promise<{ recorded: number }> {
    const campaign = await this.findCampaignOrFail(campaignId);
    if (dto.records.length === 0) return { recorded: 0 };

    // Membership is the picked list, not the eligibility rule: the sheet may only
    // record outcomes for children the office actually put on this round.
    const onRound = new Set(campaign.studentIds.map(String));
    const strangers = dto.records.filter((record) => !onRound.has(record.studentId));
    if (strangers.length > 0) {
      throw AppException.badRequest('vaccination.studentNotOnRound', {
        studentIds: strangers.map((record) => record.studentId).join(', '),
      });
    }

    const students = await this.loadStudents(dto.records.map((record) => record.studentId));
    const existing = await this.records
      .find({
        studentId: { $in: dto.records.map((record) => new Types.ObjectId(record.studentId)) },
        vaccine: campaign.vaccine,
        doseNumber: campaign.doseNumber,
        deletedAt: null,
      })
      .exec();
    const byStudent = new Map(existing.map((record) => [String(record.studentId), record]));

    for (const record of dto.records) {
      this.assertRecordable(record, students, byStudent.get(record.studentId) ?? null);
    }

    await this.tx.run(async (session) => {
      await this.records.bulkWrite(
        dto.records.map((record) => ({
          updateOne: {
            filter: {
              studentId: new Types.ObjectId(record.studentId),
              vaccine: campaign.vaccine,
              doseNumber: campaign.doseNumber,
              deletedAt: null,
            },
            update: {
              $set: {
                campaignId: campaign._id,
                provider: record.provider ?? campaign.provider ?? null,
                recordedBy: new Types.ObjectId(actor.sub),
                ...this.outcomeOf(record, byStudent.get(record.studentId) ?? null),
              },
              $setOnInsert: {
                studentId: new Types.ObjectId(record.studentId),
                vaccine: campaign.vaccine,
                doseNumber: campaign.doseNumber,
              },
            },
            upsert: true,
          },
        })),
        { session },
      );

      await this.audit.record(
        {
          action: 'create',
          entityType: 'vaccinations',
          entityId: campaign._id,
          userId: actor.sub,
          username: actor.username,
          newValue: {
            campaign: campaign.nameLo,
            vaccine: campaign.vaccine,
            dose: campaign.doseNumber,
            records: dto.records.length,
          },
          ip,
        },
        session,
      );
    });

    return { recorded: dto.records.length };
  }

  /**
   * Records a dose given away from the school — at a clinic, or in a campaign
   * the school did not run.
   *
   * It counts towards the course, so it belongs on the record; it has no
   * campaign, which is why `campaignId` is nullable.
   */
  async recordStandalone(
    dto: RecordStandaloneVaccinationDto,
    actor: AuthenticatedUser,
    ip: string | null,
  ): Promise<VaccinationDocument> {
    const students = await this.loadStudents([dto.studentId]);
    const existing = await this.records
      .findOne({
        studentId: new Types.ObjectId(dto.studentId),
        vaccine: dto.vaccine,
        doseNumber: dto.doseNumber,
        deletedAt: null,
      })
      .exec();

    this.assertRecordable(dto, students, existing);

    const values = {
      studentId: new Types.ObjectId(dto.studentId),
      campaignId: null,
      vaccine: dto.vaccine,
      doseNumber: dto.doseNumber,
      provider: dto.provider ?? null,
      recordedBy: new Types.ObjectId(actor.sub),
      ...this.outcomeOf(dto, existing),
    };

    const saved = existing
      ? (await this.records
          .findOneAndUpdate({ _id: existing._id }, { $set: values }, { new: true })
          .exec())!
      : await this.records.create(values);

    await this.audit.record({
      action: existing ? 'update' : 'create',
      entityType: 'vaccinations',
      entityId: saved._id,
      userId: actor.sub,
      username: actor.username,
      oldValue: existing ? { status: existing.status } : null,
      newValue: { vaccine: saved.vaccine, dose: saved.doseNumber, status: saved.status },
      ip,
    });

    return saved;
  }

  async remove(id: string, actor: AuthenticatedUser, ip: string | null): Promise<void> {
    const record = await this.records.findOne({ _id: id, deletedAt: null }).exec();
    if (!record) throw AppException.notFound();

    record.deletedAt = new Date();
    record.deletedBy = new Types.ObjectId(actor.sub);
    await record.save();

    await this.audit.record({
      action: 'delete',
      entityType: 'vaccinations',
      entityId: record._id,
      userId: actor.sub,
      username: actor.username,
      oldValue: { vaccine: record.vaccine, dose: record.doseNumber, status: record.status },
      ip,
    });
  }

  // ── Rules ─────────────────────────────────────────────────────────────────

  private async loadStudents(ids: string[]): Promise<Map<string, StudentDocument>> {
    const students = await this.students
      .find({ _id: { $in: ids.map((id) => new Types.ObjectId(id)) }, deletedAt: null })
      .select(ROLL_SELECT)
      .exec();

    if (students.length !== new Set(ids).size) {
      const found = new Set(students.map((student) => String(student._id)));
      throw AppException.badRequest('common.notFound', {
        field: 'studentId',
        reason: `unknown student(s): ${ids.filter((id) => !found.has(id)).join(', ')}`,
      });
    }

    return new Map(students.map((student) => [String(student._id), student]));
  }

  /** The message each rule violation is reported as. */
  private static readonly VIOLATION_MESSAGES: Record<DoseViolation, MessageKey> = {
    administered_date_required: 'vaccination.administeredDateRequired',
    consent_required: 'vaccination.consentRequired',
    guardian_not_on_file: 'vaccination.guardianNotOnFile',
  };

  /** Applies `violationFor` to one student, as a rejection the office can read. */
  private assertRecordable(
    record: RecordVaccinationDto,
    students: Map<string, StudentDocument>,
    existing: VaccinationDocument | null,
  ): void {
    const student = students.get(record.studentId);
    if (!student) throw AppException.notFound();

    const violation = violationFor(record, {
      guardianIds: student.guardians.map((link) => String(link.guardianId)),
      storedConsent: existing?.consent?.status ?? null,
    });

    if (violation) {
      throw AppException.badRequest(VaccinationsService.VIOLATION_MESSAGES[violation], {
        studentCode: student.studentCode,
      });
    }
  }

  /** The outcome fields for one student, per `keepsAdministrationDetails`. */
  private outcomeOf(
    record: RecordVaccinationDto,
    existing: VaccinationDocument | null,
  ): Record<string, unknown> {
    const given = keepsAdministrationDetails(record.status);
    const consent = record.consent ?? existing?.consent;

    return {
      status: record.status,
      administeredDate: given ? new Date(record.administeredDate!) : null,
      batchNumber: given ? (record.batchNumber ?? null) : null,
      notes: record.notes ?? null,
      consent: {
        status: consent?.status ?? 'pending',
        guardianId: consent?.guardianId ? new Types.ObjectId(String(consent.guardianId)) : null,
        decidedAt: consent?.decidedAt ? new Date(consent.decidedAt) : null,
        method: consent?.method ?? null,
      },
    };
  }
}
