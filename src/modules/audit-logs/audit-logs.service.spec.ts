import { Types } from 'mongoose';
import { diffFields, redactSensitive } from './audit-logs.service';

describe('redactSensitive', () => {
  it('redacts a top-level password field', () => {
    expect(redactSensitive({ username: 'somsak', password: 'hunter2' })).toEqual({
      username: 'somsak',
      password: '[REDACTED]',
    });
  });

  it('redacts every known credential field name', () => {
    const input = {
      password: 'a',
      passwordHash: 'b',
      currentPassword: 'c',
      newPassword: 'd',
      refreshToken: 'e',
      accessToken: 'f',
      token: 'g',
      secret: 'h',
    };
    const output = redactSensitive(input);
    expect(Object.values(output).every((value) => value === '[REDACTED]')).toBe(true);
  });

  it('redacts nested credentials', () => {
    // A DTO can nest a credential a level down, e.g. creating a student with an
    // account in the same payload.
    const output = redactSensitive({
      student: { firstNameLo: 'ນາງ', account: { password: 'hunter2' } },
    });
    expect(output).toEqual({
      student: { firstNameLo: 'ນາງ', account: { password: '[REDACTED]' } },
    });
  });

  it('redacts credentials inside arrays', () => {
    const output = redactSensitive({ users: [{ username: 'a', password: 'p1' }] });
    expect(output).toEqual({ users: [{ username: 'a', password: '[REDACTED]' }] });
  });

  it('leaves non-sensitive values untouched, including Lao text', () => {
    const input = { nameLo: 'ສົມສັກ ພົມມະຈັນ', score: 82.5, isPassed: true };
    expect(redactSensitive(input)).toEqual(input);
  });

  it('preserves Date and ObjectId values rather than walking into them', () => {
    const date = new Date('2025-09-01T00:00:00Z');
    const id = new Types.ObjectId();
    const output = redactSensitive({ date, id });
    expect(output.date).toBe(date);
    expect(output.id).toBe(id);
  });

  it('handles null and undefined values', () => {
    expect(redactSensitive({ a: null, b: undefined })).toEqual({ a: null, b: undefined });
  });
});

describe('diffFields', () => {
  it('records only the fields that changed', () => {
    const { oldValue, newValue } = diffFields(
      { status: 'active', name: 'ນາງ', phone: '02011111111' },
      { status: 'dropped', name: 'ນາງ', phone: '02011111111' },
    );

    expect(newValue).toEqual({ status: 'dropped' });
    expect(oldValue).toEqual({ status: 'active' });
  });

  it('returns empty objects when nothing changed', () => {
    const state = { status: 'active', score: 80 };
    const { oldValue, newValue } = diffFields(state, { ...state });
    expect(newValue).toEqual({});
    expect(oldValue).toEqual({});
  });

  it('ignores bookkeeping fields that always change', () => {
    const { newValue } = diffFields(
      { score: 80, updatedAt: new Date('2025-01-01'), _id: 'x', id: 'x' },
      { score: 80, updatedAt: new Date('2025-06-01'), _id: 'x', id: 'x' },
    );
    expect(newValue).toEqual({});
  });

  it('detects a change from a value to null', () => {
    const { oldValue, newValue } = diffFields({ score: 80 }, { score: null });
    expect(oldValue).toEqual({ score: 80 });
    expect(newValue).toEqual({ score: null });
  });

  it('detects a change from null to a value', () => {
    const { oldValue, newValue } = diffFields({ score: null }, { score: 80 });
    expect(oldValue).toEqual({ score: null });
    expect(newValue).toEqual({ score: 80 });
  });

  it('normalizes a missing previous field to null rather than undefined', () => {
    // Mongo stores null but not undefined, so an undefined here would be dropped
    // from the audit row entirely and the change would look like it came from nothing.
    const { oldValue } = diffFields({}, { remark: 'late submission' });
    expect(oldValue).toEqual({ remark: null });
  });

  it('compares nested objects structurally', () => {
    const unchanged = diffFields(
      { schedule: [{ dayOfWeek: 1, startTime: '08:00' }] },
      { schedule: [{ dayOfWeek: 1, startTime: '08:00' }] },
    );
    expect(unchanged.newValue).toEqual({});

    const changed = diffFields(
      { schedule: [{ dayOfWeek: 1, startTime: '08:00' }] },
      { schedule: [{ dayOfWeek: 1, startTime: '09:00' }] },
    );
    expect(changed.newValue).toHaveProperty('schedule');
  });

  it('does not report fields absent from the new state', () => {
    // A partial update (PATCH) sends only some fields; the untouched ones must
    // not appear as deletions.
    const { newValue } = diffFields({ a: 1, b: 2 }, { a: 1 });
    expect(newValue).toEqual({});
  });
});
