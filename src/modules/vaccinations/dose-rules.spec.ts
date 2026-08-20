import { keepsAdministrationDetails, matchesEligibility, violationFor } from './dose-rules';

describe('matchesEligibility', () => {
  const girl = { gender: 'female' as const, dateOfBirth: new Date('2014-06-15T00:00:00Z') };
  const boy = { gender: 'male' as const, dateOfBirth: new Date('2014-06-15T00:00:00Z') };

  it('covers every student when the rule states nothing', () => {
    expect(matchesEligibility(girl, {})).toBe(true);
    expect(matchesEligibility(boy, {})).toBe(true);
  });

  it('covers only girls for a girls-only round', () => {
    expect(matchesEligibility(girl, { gender: 'female' })).toBe(true);
    expect(matchesEligibility(boy, { gender: 'female' })).toBe(false);
  });

  it('covers whole cohorts for a round that names no gender', () => {
    // The next MR round is not a second schema — it is a campaign with no gender.
    expect(matchesEligibility(boy, { gender: null })).toBe(true);
  });

  it('applies the birth window inclusively at both ends', () => {
    const rule = {
      bornFrom: new Date('2014-01-01T00:00:00Z'),
      bornTo: new Date('2014-12-31T00:00:00Z'),
    };
    expect(matchesEligibility(girl, rule)).toBe(true);
    expect(
      matchesEligibility({ ...girl, dateOfBirth: new Date('2014-01-01T00:00:00Z') }, rule),
    ).toBe(true);
    expect(
      matchesEligibility({ ...girl, dateOfBirth: new Date('2014-12-31T00:00:00Z') }, rule),
    ).toBe(true);
    expect(
      matchesEligibility({ ...girl, dateOfBirth: new Date('2013-12-31T00:00:00Z') }, rule),
    ).toBe(false);
    expect(
      matchesEligibility({ ...girl, dateOfBirth: new Date('2015-01-01T00:00:00Z') }, rule),
    ).toBe(false);
  });

  it('takes both halves of the rule together', () => {
    const rule = { gender: 'female' as const, bornTo: new Date('2014-12-31T00:00:00Z') };
    expect(matchesEligibility(girl, rule)).toBe(true);
    expect(matchesEligibility(boy, rule)).toBe(false);
    expect(
      matchesEligibility({ ...girl, dateOfBirth: new Date('2016-01-01T00:00:00Z') }, rule),
    ).toBe(false);
  });
});

describe('violationFor', () => {
  const guardians = { guardianIds: ['g1', 'g2'] };

  it('lets a dose through when it is dated and consented', () => {
    expect(
      violationFor(
        {
          status: 'administered',
          administeredDate: '2026-11-03',
          consent: { status: 'given', guardianId: 'g1' },
        },
        guardians,
      ),
    ).toBeNull();
  });

  it('refuses a dose marked given with no date', () => {
    expect(
      violationFor(
        { status: 'administered', consent: { status: 'given', guardianId: 'g1' } },
        guardians,
      ),
    ).toBe('administered_date_required');
  });

  it('refuses a dose whose guardian was never asked', () => {
    expect(
      violationFor({ status: 'administered', administeredDate: '2026-11-03' }, guardians),
    ).toBe('consent_required');
  });

  it('refuses a dose the guardian declined', () => {
    expect(
      violationFor(
        {
          status: 'administered',
          administeredDate: '2026-11-03',
          consent: { status: 'refused', guardianId: 'g1' },
        },
        guardians,
      ),
    ).toBe('consent_required');
  });

  it('accepts consent already on file, so only the outcome need be filled in', () => {
    expect(
      violationFor(
        { status: 'administered', administeredDate: '2026-11-03' },
        { ...guardians, storedConsent: 'given' },
      ),
    ).toBeNull();
  });

  it('prefers the consent in the request over the one on file', () => {
    // A parent who withdrew consent on the day overrides last week's signature.
    expect(
      violationFor(
        {
          status: 'administered',
          administeredDate: '2026-11-03',
          consent: { status: 'refused' },
        },
        { ...guardians, storedConsent: 'given' },
      ),
    ).toBe('consent_required');
  });

  it('refuses a consent attributed to someone not on the student’s list', () => {
    expect(
      violationFor(
        {
          status: 'administered',
          administeredDate: '2026-11-03',
          consent: { status: 'given', guardianId: 'stranger' },
        },
        guardians,
      ),
    ).toBe('guardian_not_on_file');
  });

  it('records a refusal, an absence and a contraindication without consent', () => {
    // The honest answer has to be filable, or "no record" means both "not
    // vaccinated" and "never asked" again — and the follow-up list is built from
    // exactly that difference.
    for (const status of ['refused', 'absent', 'contraindicated'] as const) {
      expect(violationFor({ status }, guardians)).toBeNull();
    }
  });

  it('does not demand a date for an outcome that is not a dose given', () => {
    expect(violationFor({ status: 'scheduled' }, guardians)).toBeNull();
  });

  it('still checks the named guardian on a refusal', () => {
    expect(
      violationFor(
        { status: 'refused', consent: { status: 'refused', guardianId: 'x' } },
        guardians,
      ),
    ).toBe('guardian_not_on_file');
  });
});

describe('keepsAdministrationDetails', () => {
  it('keeps the date and vial only for a dose actually given', () => {
    expect(keepsAdministrationDetails('administered')).toBe(true);
    for (const status of ['scheduled', 'refused', 'absent', 'contraindicated'] as const) {
      expect(keepsAdministrationDetails(status)).toBe(false);
    }
  });
});
