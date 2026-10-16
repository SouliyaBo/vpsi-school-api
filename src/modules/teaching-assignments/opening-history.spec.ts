import { slotsOn } from 'src/common/lesson-coverage/lesson-coverage';
import { openingHistory, schoolToday } from './opening-history';

const termStart = new Date('2026-08-17T00:00:00Z');
const wednesday = [{ dayOfWeek: 3, isRotating: false }];

function asCoverage(history: ReturnType<typeof openingHistory<(typeof wednesday)[number]>>) {
  return {
    schedule: wednesday,
    scheduleHistory: history.map((spell) => ({
      from: spell.from.toISOString().slice(0, 10),
      to: spell.to ? spell.to.toISOString().slice(0, 10) : null,
      schedule: spell.schedule,
    })),
  };
}

describe('openingHistory', () => {
  it('writes nothing for a lesson that starts with the term', () => {
    expect(openingHistory({ termStart, startsOn: '2026-08-17', schedule: wednesday })).toEqual([]);
  });

  it('writes nothing for a start before the term opens', () => {
    expect(openingHistory({ termStart, startsOn: '2026-08-01', schedule: wednesday })).toEqual([]);
  });

  it('owes nothing before a mid-term start, and the schedule from it', () => {
    const history = openingHistory({ termStart, startsOn: '2026-10-05', schedule: wednesday });

    expect(history).toEqual([
      expect.objectContaining({
        schedule: [],
        from: termStart,
        to: new Date('2026-10-05T00:00:00Z'),
      }),
      expect.objectContaining({
        schedule: wednesday,
        from: new Date('2026-10-05T00:00:00Z'),
        to: null,
      }),
    ]);

    const lesson = asCoverage(history);
    expect(slotsOn(lesson, '2026-09-30')).toEqual([]);
    expect(slotsOn(lesson, '2026-10-04')).toEqual([]);
    expect(slotsOn(lesson, '2026-10-07')).toEqual(wednesday);
  });

  it('reads a start given as an instant by its UTC calendar day', () => {
    const [closed] = openingHistory({
      termStart,
      startsOn: new Date('2026-10-05T03:09:00Z'),
      schedule: wednesday,
    });
    expect(closed.to).toEqual(new Date('2026-10-05T00:00:00Z'));
  });

  it('keeps who and why on both spells, blank note as null', () => {
    const history = openingHistory({
      termStart,
      startsOn: '2026-10-05',
      schedule: wednesday,
      changedBy: 'u1',
      note: '  ',
    });
    expect(history.map((spell) => [spell.changedBy, spell.note])).toEqual([
      ['u1', null],
      ['u1', null],
    ]);
  });
});

describe('schoolToday', () => {
  it('is already Monday in Vientiane at 06:30 local, while UTC is still on Sunday', () => {
    expect(schoolToday(new Date('2026-10-04T23:30:00Z'))).toEqual(new Date('2026-10-05T00:00:00Z'));
  });

  it('stays on the same day through the evening', () => {
    expect(schoolToday(new Date('2026-10-05T16:59:00Z'))).toEqual(new Date('2026-10-05T00:00:00Z'));
  });
});
