import { gradeSheet, parseAnswerString } from './grading';

describe('gradeSheet', () => {
  // Set B prints original question 1 first, with its options reversed.
  const variant = {
    label: 'B',
    questionOrder: [1, 0, 2],
    optionOrders: [
      [3, 2, 1, 0],
      [0, 1, 2, 3],
      [0, 1, 2, 3],
    ],
  };
  const key = [2, 0, null]; // original 0 → C, original 1 → A, original 2 → no answer on record

  it('marks by the set the pupil held, not by the teacher’s order', () => {
    // Printed 1 is original 1, whose answer A now sits at letter D (index 3).
    const result = gradeSheet(variant, key, [3, 2, 0], 20);
    expect(result.questions.map((q) => q.isCorrect)).toEqual([true, true, null]);
    expect(result.correctCount).toBe(2);
    expect(result.totalQuestions).toBe(2);
    expect(result.points).toBe(20);
  });

  it('scales to the paper’s points and leaves points null without them', () => {
    expect(gradeSheet(variant, key, [3, 1, 0], 20).points).toBe(10);
    expect(gradeSheet(variant, key, [0, 0, 0], 7).points).toBe(0);
    expect(gradeSheet(variant, key, [3, 2, 0], null).points).toBeNull();
    expect(gradeSheet(variant, [null, null, null], [3, 2, 0], 20).points).toBeNull();
  });

  it('counts a blank as wrong', () => {
    const result = gradeSheet(variant, key, [null, 2], 20);
    expect(result.correctCount).toBe(1);
    expect(result.questions[0].marked).toBeNull();
  });
});

describe('parseAnswerString', () => {
  const latin = ['A', 'B', 'C', 'D'];
  it('reads one letter per question, any case, blanks as dashes, and pads the rest', () => {
    expect(parseAnswerString('bC d-A', latin, 6)).toEqual([1, 2, 3, null, 0, null]);
  });
  it('reads Lao letters, and ignores what is not a letter', () => {
    expect(parseAnswerString('ກຂ.ງ', ['ກ', 'ຂ', 'ຄ', 'ງ'], 4)).toEqual([0, 1, null, 3]);
    expect(parseAnswerString('AXB', latin, 3)).toEqual([0, null, 1]);
  });
});
