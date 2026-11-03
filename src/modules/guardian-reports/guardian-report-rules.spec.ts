import {
  DEFAULT_LINK_DAYS,
  hashToken,
  isWellFormedToken,
  issueToken,
  linkExpiry,
  monthWindow,
  normalizeLinkDays,
  phonePin,
  pinMatches,
  reportState,
} from './guardian-report-rules';

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const iso = (date: Date) => date.toISOString().slice(0, 10);

describe('issueToken', () => {
  it('hands out a 43-character base64url token and stores only its hash', () => {
    const { token, tokenHash } = issueToken();
    expect(isWellFormedToken(token)).toBe(true);
    expect(tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(tokenHash).toBe(hashToken(token));
    expect(tokenHash).not.toContain(token);
  });

  it('never hands out the same token twice', () => {
    const seen = new Set(Array.from({ length: 200 }, () => issueToken().token));
    expect(seen.size).toBe(200);
  });
});

describe('isWellFormedToken', () => {
  it('turns away anything that could not have been issued', () => {
    expect(isWellFormedToken('short')).toBe(false);
    expect(isWellFormedToken(`${'a'.repeat(42)}=`)).toBe(false);
    expect(isWellFormedToken({ $ne: null })).toBe(false);
    expect(isWellFormedToken(undefined)).toBe(false);
  });
});

describe('phonePin', () => {
  it('reads the last four digits however the number was typed', () => {
    expect(phonePin('02055551234')).toBe('1234');
    expect(phonePin('020 5555 1234')).toBe('1234');
    expect(phonePin('+856 20 5555-1234')).toBe('1234');
  });

  it('has no digits to offer for a number too short to hold them', () => {
    expect(phonePin('123')).toBeNull();
    expect(phonePin('')).toBeNull();
    expect(phonePin(null)).toBeNull();
  });
});

describe('pinMatches', () => {
  it('opens on the last four digits, spaces forgiven', () => {
    expect(pinMatches('1234', '020 5555 1234')).toBe(true);
    expect(pinMatches(' 12 34 ', '02055551234')).toBe(true);
  });

  it('refuses wrong, short, long and empty guesses', () => {
    expect(pinMatches('1235', '02055551234')).toBe(false);
    expect(pinMatches('234', '02055551234')).toBe(false);
    expect(pinMatches('51234', '02055551234')).toBe(false);
    expect(pinMatches('', '02055551234')).toBe(false);
  });

  it('opens nothing when the guardian has no usable number on file', () => {
    // Otherwise an empty phone and an empty guess would agree.
    expect(pinMatches('', '')).toBe(false);
    expect(pinMatches('0000', null)).toBe(false);
  });
});

describe('reportState', () => {
  const now = day('2026-10-28');
  const live = { expiresAt: day('2026-11-27') };

  it('is active until it expires', () => {
    expect(reportState(live, now)).toBe('active');
    expect(reportState({ expiresAt: now }, now)).toBe('expired');
  });

  it('names the deliberate act over the one that merely happened', () => {
    const past = day('2026-10-01');
    expect(reportState({ expiresAt: past, lockedAt: now }, now)).toBe('locked');
    expect(reportState({ expiresAt: past, lockedAt: now, revokedAt: now }, now)).toBe('revoked');
  });
});

describe('normalizeLinkDays', () => {
  it('keeps a sensible number of days', () => {
    expect(normalizeLinkDays(14)).toBe(14);
  });

  it('falls back on anything that would make a strange expiry', () => {
    for (const value of [0, -3, 2.5, 10_000, '30', null, undefined]) {
      expect(normalizeLinkDays(value)).toBe(DEFAULT_LINK_DAYS);
    }
  });
});

describe('linkExpiry', () => {
  it('adds whole days', () => {
    expect(linkExpiry(day('2026-10-28'), 30).toISOString()).toBe('2026-11-27T00:00:00.000Z');
  });
});

describe('monthWindow', () => {
  // ພາກຮຽນທີ 1, 2026–27: 17 Aug → 15 Jan.
  const term = { startDate: day('2026-08-17'), endDate: day('2027-01-15') };

  it('clips the opening month to the first day of term', () => {
    const window = monthWindow(term, 8)!;
    expect([iso(window.from), iso(window.to)]).toEqual(['2026-08-17', '2026-08-31']);
  });

  it('gives a whole month in the middle of term', () => {
    const window = monthWindow(term, 9)!;
    expect([iso(window.from), iso(window.to)]).toEqual(['2026-09-01', '2026-09-30']);
  });

  it('puts January in the year the term crosses into, clipped to its last day', () => {
    const window = monthWindow(term, 1)!;
    expect([iso(window.from), iso(window.to)]).toEqual(['2027-01-01', '2027-01-15']);
  });

  it('has no window for a month the term does not reach', () => {
    expect(monthWindow(term, 5)).toBeNull();
  });
});
