import { ConsentStatus, Gender, VaccinationStatus } from 'src/common/constants/enums';

/**
 * The rules governing what may be recorded for one dose.
 *
 * Kept pure and apart from the service for the same reason exam eligibility is:
 * these decide whether the school states that a child was vaccinated, which is
 * the last thing that should be buried inside a query method.
 */

/** The eligibility rule as a campaign holds it. */
export interface EligibilityRule {
  gender?: Gender | null;
  gradeLevelIds?: unknown[];
  bornFrom?: Date | null;
  bornTo?: Date | null;
}

/** What a student must offer to be matched against a rule. */
export interface EligibleStudent {
  gender: Gender;
  dateOfBirth: Date;
}

/**
 * Whether a campaign's rule covers a student.
 *
 * The gender test compares against the *campaign's* stated target, never the
 * other way round: a girls-only round covers the girls at the school, but being
 * a girl is not itself a membership of the round. That distinction is what keeps
 * the dose count and the female student count two separate figures.
 *
 * The grade test is not here — enrolment is what places a student in a grade,
 * and that is a query the caller has already run.
 */
export function matchesEligibility(student: EligibleStudent, rule: EligibilityRule): boolean {
  if (rule.gender && student.gender !== rule.gender) return false;
  if (rule.bornFrom && student.dateOfBirth < rule.bornFrom) return false;
  if (rule.bornTo && student.dateOfBirth > rule.bornTo) return false;
  return true;
}

/** Why a dose may not be recorded as the request asks. */
export type DoseViolation =
  'administered_date_required' | 'consent_required' | 'guardian_not_on_file';

export interface DoseRequest {
  status: VaccinationStatus;
  administeredDate?: string | null;
  consent?: { status: ConsentStatus; guardianId?: string | null } | null;
}

export interface DoseContext {
  /** Guardian ids on the student's own list. */
  guardianIds: string[];
  /** The consent already on file for this dose, if any. */
  storedConsent?: ConsentStatus | null;
}

/**
 * What stops this dose being recorded, or `null` when nothing does.
 *
 * Only `administered` is constrained. A refusal, an absence or a
 * contraindication is an outcome the school is recording rather than an act it
 * is performing, and demanding consent for one would mean the honest answer
 * could not be filed at all — which is how "no record" becomes ambiguous again.
 *
 * Consent is read from the request first and the stored value second, so a nurse
 * filling in only the outcome for a child whose parent signed last week is not
 * blocked, while a child whose parent was never asked is.
 */
export function violationFor(request: DoseRequest, context: DoseContext): DoseViolation | null {
  const consentingGuardian = request.consent?.guardianId;
  if (consentingGuardian && !context.guardianIds.includes(consentingGuardian)) {
    return 'guardian_not_on_file';
  }

  if (request.status !== 'administered') return null;

  if (!request.administeredDate) return 'administered_date_required';

  const consent = request.consent?.status ?? context.storedConsent ?? 'pending';
  if (consent !== 'given') return 'consent_required';

  return null;
}

/**
 * Whether an outcome keeps the clinical details of a dose that was given.
 *
 * Correcting a record to `absent` must not leave behind the date and the vial of
 * a dose nobody received — the batch number is what a recall is traced by, and a
 * stale one points the trace at the wrong child.
 */
export function keepsAdministrationDetails(status: VaccinationStatus): boolean {
  return status === 'administered';
}
