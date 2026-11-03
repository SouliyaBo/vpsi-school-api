import { gradeSheet } from './grading';
import {
  partsProblem,
  scoreBySubject,
  sectionsOf,
  unassignedCount,
  type SubjectPart,
} from './subject-parts';

describe('subject parts', () => {
  // ທຳມະຊາດ: two ຟີຊິກ questions, two ເຄມີ, one with no heading.
  const questions = [
    { section: 'ພາກ I ຟີຊິກ' },
    { section: 'ພາກ I ຟີຊິກ' },
    { section: 'ພາກ II ເຄມີ' },
    { section: 'ພາກ II ເຄມີ' },
    { section: null },
  ];
  const key = [0, 1, 2, 3, 0];
  // Set B prints the questions back to front, options in place.
  const variant = {
    label: 'B',
    questionOrder: [4, 3, 2, 1, 0],
    optionOrders: [0, 1, 2, 3, 4].map(() => [0, 1, 2, 3]),
  };
  const parts: SubjectPart[] = [
    { subjectId: 'phys', sections: ['ພາກ I ຟີຊິກ'], points: 3 },
    { subjectId: 'chem', sections: ['ພາກ II ເຄມີ'], points: null },
  ];

  it('lists each ພາກ once, in order, with its size; no heading is ""', () => {
    expect(sectionsOf(questions)).toEqual([
      { section: 'ພາກ I ຟີຊິກ', questions: 2 },
      { section: 'ພາກ II ເຄມີ', questions: 2 },
      { section: '', questions: 1 },
    ]);
  });

  it('scores each subject on its own questions, traced back through the set', () => {
    // Printed order is 4,3,2,1,0: right on original 4 (unassigned), 3, 1 and 0; wrong on 2.
    const graded = gradeSheet(variant, key, [0, 3, 0, 1, 0], 6).questions;
    expect(scoreBySubject(questions, graded, parts, 6)).toEqual([
      { subjectId: 'phys', correctCount: 2, totalQuestions: 2, points: 3 },
      // Its own total is not set, so the paper's 6 applies: 1 of 2 → 3.
      { subjectId: 'chem', correctCount: 1, totalQuestions: 2, points: 3 },
    ]);
  });

  it('rounds like the paper, and leaves points null with no total or no keyed question', () => {
    const graded = gradeSheet(variant, [0, 1, 2, null, 0], [0, 0, 0, 1, 0], null).questions;
    const odd: SubjectPart[] = [
      { subjectId: 'phys', sections: ['ພາກ I ຟີຊິກ'], points: 2.5 },
      { subjectId: 'chem', sections: ['ພາກ II ເຄມີ'], points: null },
    ];
    // ຟີຊິກ 2/2 of 2.5; ເຄມີ has one keyed question but no total anywhere.
    expect(scoreBySubject(questions, graded, odd, null)).toEqual([
      { subjectId: 'phys', correctCount: 2, totalQuestions: 2, points: 2.5 },
      { subjectId: 'chem', correctCount: 0, totalQuestions: 1, points: null },
    ]);
    const unkeyed = gradeSheet(variant, [0, 1, null, null, 0], [0, 0, 0, 1, 0], 6).questions;
    expect(scoreBySubject(questions, unkeyed, odd, 6)[1].points).toBeNull();
    // Wrong on original 4, the unheaded one: 2 of 3 of 2 points.
    const third = gradeSheet(variant, key, [1, 0, 0, 1, 0], 6).questions;
    expect(
      scoreBySubject(
        questions,
        third,
        [{ subjectId: 'x', sections: ['ພາກ I ຟີຊິກ', ''], points: 2 }],
        6,
      ),
    ).toEqual([{ subjectId: 'x', correctCount: 2, totalQuestions: 3, points: 1.33 }]);
  });

  it('counts the questions in no part', () => {
    expect(unassignedCount(questions, parts)).toBe(1);
    expect(unassignedCount(questions, [])).toBe(5);
  });

  it('refuses a ພາກ given twice, or a subject listed twice', () => {
    expect(partsProblem(parts)).toBeNull();
    expect(
      partsProblem([...parts, { subjectId: 'bio', sections: ['ພາກ II ເຄມີ'], points: null }]),
    ).toBe('sectionTwice');
    expect(partsProblem([...parts, { subjectId: 'phys', sections: [''], points: null }])).toBe(
      'subjectTwice',
    );
  });
});
