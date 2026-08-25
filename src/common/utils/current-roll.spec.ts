import { Types } from 'mongoose';
import { isCurrentRollStatus, isOnCurrentRoll } from './current-roll';

/**
 * The rule these two encode is a data fact, not a preference: a student's status
 * and their enrollment's status are written by different acts, so "has an active
 * enrollment in this room" and "is still being taught here" can disagree for as
 * long as nobody closes the placement. Roll call and the behaviour register read
 * the second, which is what these assert.
 */
describe('isCurrentRollStatus', () => {
  it('accepts the two statuses of a child still in the room', () => {
    expect(isCurrentRollStatus('active')).toBe(true);
    // Declining the certificate says nothing about attendance.
    expect(isCurrentRollStatus('no_certificate')).toBe(true);
  });

  it('rejects everyone the school is no longer teaching', () => {
    expect(isCurrentRollStatus('new')).toBe(false);
    expect(isCurrentRollStatus('graduated')).toBe(false);
    expect(isCurrentRollStatus('transferred')).toBe(false);
    expect(isCurrentRollStatus('dropped')).toBe(false);
    expect(isCurrentRollStatus('suspended')).toBe(false);
  });
});

describe('isOnCurrentRoll', () => {
  it('reads the status off a populated student ref', () => {
    expect(isOnCurrentRoll({ _id: new Types.ObjectId(), status: 'active' })).toBe(true);
    expect(isOnCurrentRoll({ _id: new Types.ObjectId(), status: 'dropped' })).toBe(false);
  });

  it('keeps a row it cannot judge, rather than dropping a name off the sheet', () => {
    // Unpopulated ref, or a student record that has gone: the enrollment is then
    // the only evidence, and it says the child is in the class.
    expect(isOnCurrentRoll(new Types.ObjectId())).toBe(true);
    expect(isOnCurrentRoll(null)).toBe(true);
    expect(isOnCurrentRoll(undefined)).toBe(true);
    expect(isOnCurrentRoll({ _id: new Types.ObjectId() })).toBe(true);
  });
});
