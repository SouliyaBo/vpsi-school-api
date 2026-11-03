import { Types } from 'mongoose';
import type { AuthenticatedUser } from 'src/common/interfaces/authenticated-user.interface';
import { ExamPapersService } from './exam-papers.service';

/**
 * ແຍກຄະແນນຕາມວິຊາ through the service: the results view and the send to the
 * monthly sheet read the paper's ພາກ → subject mapping. The rules themselves
 * are in subject-parts.spec; this checks they reach the two places that use
 * them, over models faked down to the queries those two make.
 */

/** A query chain that resolves to `result` whichever of these it is called with. */
function chain<T>(result: T) {
  const query = {
    select: () => query,
    populate: () => query,
    sort: () => query,
    lean: () => query,
    exec: async () => result,
  };
  return query;
}

const actor = {
  sub: new Types.ObjectId().toHexString(),
  username: 'boun',
  permissions: [{ resource: 'exam-papers', actions: ['manage'] }],
} as unknown as AuthenticatedUser;

const NATURE = new Types.ObjectId();
const PHYS = new Types.ObjectId();
const CHEM = new Types.ObjectId();
const BIO = new Types.ObjectId();
const ROOM = new Types.ObjectId();
const KHAM = new Types.ObjectId();
const BOUN = new Types.ObjectId();

const subjects = [
  { _id: PHYS, nameLo: 'ຟີຊິກສາດ', monthlyColumnMax: null },
  { _id: CHEM, nameLo: 'ເຄມີສາດ', monthlyColumnMax: null },
  { _id: BIO, nameLo: 'ຊີວະສາດ', monthlyColumnMax: null },
];

// Four questions: two ຟີຊິກ, two ເຄມີ; key A, B, C, D; one set in the teacher's order.
function paper(parts: { subjectId: Types.ObjectId; sections: string[]; points: number | null }[]) {
  return {
    _id: new Types.ObjectId(),
    createdById: new Types.ObjectId(actor.sub),
    subjectId: { _id: NATURE, nameLo: 'ທຳມະຊາດ' },
    classroomId: { _id: ROOM, name: 'ມ.2/ກ' },
    semesterId: null,
    optionLabelStyle: 'latin',
    totalPoints: 6,
    questions: [
      { section: 'ພາກ I ຟີຊິກ', correctIndex: 0 },
      { section: 'ພາກ I ຟີຊິກ', correctIndex: 1 },
      { section: 'ພາກ II ເຄມີ', correctIndex: 2 },
      { section: 'ພາກ II ເຄມີ', correctIndex: 3 },
    ],
    variants: [
      {
        label: 'A',
        questionOrder: [0, 1, 2, 3],
        optionOrders: [0, 1, 2, 3].map(() => [0, 1, 2, 3]),
      },
    ],
    subjectParts: parts,
  };
}

const PARTS = [
  { subjectId: PHYS, sections: ['ພາກ I ຟີຊິກ'], points: 3 },
  { subjectId: CHEM, sections: ['ພາກ II ເຄມີ'], points: null },
];

// ຄຳ: both ຟີຊິກ right, one ເຄມີ right. ບຸນ: one ຟີຊິກ right, no ເຄມີ.
const SHEETS = [
  {
    _id: new Types.ObjectId(),
    studentId: KHAM,
    setLabel: 'A',
    answers: [0, 1, 2, 0],
    correctCount: 3,
    totalQuestions: 4,
    points: 4.5,
  },
  {
    _id: new Types.ObjectId(),
    studentId: BOUN,
    setLabel: 'A',
    answers: [0, 0, 0, 0],
    correctCount: 1,
    totalQuestions: 4,
    points: 1.5,
  },
];

function service(record: ReturnType<typeof paper>) {
  const saveMonthGrid = jest.fn(async () => ({ saved: 2, skipped: 0, errors: [] }));
  const build = new ExamPapersService(
    { findOne: () => chain(record) } as never,
    {
      find: () =>
        chain([
          {
            studentId: { _id: KHAM, status: 'active' },
            studentCode: '0801',
            studentNameLo: 'ນາງ ຄຳ',
          },
          {
            studentId: { _id: BOUN, status: 'active' },
            studentCode: '0802',
            studentNameLo: 'ທ້າວ ບຸນ',
          },
        ]),
    } as never,
    { findOne: () => chain({ _id: ROOM, name: 'ມ.2/ກ' }) } as never,
    { find: () => chain(SHEETS) } as never,
    {} as never,
    {} as never,
    { getValue: async () => ({ '1': [9, 10, 11] }) } as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    { saveMonthGrid } as never,
    {
      getActiveOrFail: async () => ({ _id: new Types.ObjectId(), number: 1, nameLo: 'ພາກຮຽນ 1' }),
    } as never,
    { findMarkedUnder: async () => subjects } as never,
  );
  return { build, saveMonthGrid };
}

describe('ExamPapersService — marks split by subject', () => {
  it('shows each pupil’s points per subject, and what each part is out of', async () => {
    const { build } = service(paper(PARTS));
    const view = await build.responses('paper', {}, actor);
    expect(view.subjectParts).toEqual([
      { subjectId: String(PHYS), nameLo: 'ຟີຊິກສາດ', testMax: 6, points: 3, questions: 2 },
      // Its own total left blank: the paper's 6.
      { subjectId: String(CHEM), nameLo: 'ເຄມີສາດ', testMax: 6, points: 6, questions: 2 },
    ]);
    expect(view.unassigned).toBe(0);
    expect(view.rows[0].response?.subjects).toEqual([
      { subjectId: String(PHYS), correctCount: 2, totalQuestions: 2, points: 3 },
      { subjectId: String(CHEM), correctCount: 1, totalQuestions: 2, points: 3 },
    ]);
    expect(view.rows[1].response?.subjects.map((subject) => subject.points)).toEqual([1.5, 0]);
  });

  it('marks a paper with no mapping as a whole, as before', async () => {
    const { build } = service(paper([]));
    const view = await build.responses('paper', {}, actor);
    expect(view.subjectParts).toEqual([]);
    expect(view.rows[0].response?.subjects).toEqual([]);
    expect(view.rows[0].response?.points).toBe(4.5);
  });

  it('sends the chosen subject its own part’s points, not the whole paper’s', async () => {
    const { build, saveMonthGrid } = service(paper(PARTS));
    await build.pushToMonthlyMarks('paper', { subjectId: String(CHEM), month: 9 }, actor, null);
    expect(saveMonthGrid).toHaveBeenCalledTimes(1);
    const [grid] = saveMonthGrid.mock.calls[0] as unknown as [
      { subjectId: string; entries: { studentId: string; test: number }[] },
    ];
    expect(grid.subjectId).toBe(String(CHEM));
    expect(grid.entries).toEqual([
      { studentId: String(KHAM), test: 3 },
      { studentId: String(BOUN), test: 0 },
    ]);
  });

  it('refuses a subject no ພາກ is given to', async () => {
    const { build, saveMonthGrid } = service(paper(PARTS));
    await expect(
      build.pushToMonthlyMarks('paper', { subjectId: String(BIO), month: 9 }, actor, null),
    ).rejects.toMatchObject({ messageKey: 'examPaper.subjectNotInParts' });
    expect(saveMonthGrid).not.toHaveBeenCalled();
  });

  it('refuses a part worth more than the ກວດກາ column', async () => {
    const { build } = service(paper([{ subjectId: PHYS, sections: ['ພາກ I ຟີຊິກ'], points: 7 }]));
    await expect(
      build.pushToMonthlyMarks('paper', { subjectId: String(PHYS), month: 9 }, actor, null),
    ).rejects.toMatchObject({ messageKey: 'examPaper.pointsExceedTest' });
  });

  describe('saving the mapping', () => {
    function editable(parts = PARTS) {
      const record = { ...paper(parts), save: jest.fn(async () => undefined) };
      const { build } = service(record as never);
      (build as unknown as { audit: unknown }).audit = { record: jest.fn() };
      jest.spyOn(build, 'findOne').mockResolvedValue({} as never);
      return { build, record };
    }

    it('keeps the parts as ids, one ພາກ each, dropping a part with none', async () => {
      const { build, record } = editable([]);
      await build.update(
        'paper',
        {
          subjectParts: [
            { subjectId: String(PHYS), sections: ['ພາກ I ຟີຊິກ', 'ພາກ I ຟີຊິກ'], points: 3 },
            { subjectId: String(BIO), sections: [], points: 2 },
          ],
        },
        actor,
        null,
      );
      expect(record.subjectParts).toEqual([
        { subjectId: PHYS, sections: ['ພາກ I ຟີຊິກ'], points: 3 },
      ]);
      expect(record.save).toHaveBeenCalled();
    });

    it('refuses a ພາກ given to two subjects, and a subject not under the paper’s', async () => {
      const { build } = editable([]);
      await expect(
        build.update(
          'paper',
          {
            subjectParts: [
              { subjectId: String(PHYS), sections: ['ພາກ I ຟີຊິກ'] },
              { subjectId: String(CHEM), sections: ['ພາກ I ຟີຊິກ'] },
            ],
          },
          actor,
          null,
        ),
      ).rejects.toMatchObject({ messageKey: 'examPaper.partsInvalid' });
      await expect(
        build.update(
          'paper',
          { subjectParts: [{ subjectId: new Types.ObjectId().toHexString(), sections: [''] }] },
          actor,
          null,
        ),
      ).rejects.toMatchObject({ messageKey: 'common.validationFailed' });
    });

    it('drops the mapping when the paper moves to another subject', async () => {
      const { build, record } = editable();
      await build.update('paper', { subjectId: new Types.ObjectId().toHexString() }, actor, null);
      expect(record.subjectParts).toEqual([]);
    });
  });
});
