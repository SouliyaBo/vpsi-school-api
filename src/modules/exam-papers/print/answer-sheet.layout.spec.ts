import { answerSheetLayout, BUBBLE_R, SETS_PER_COLUMN } from './answer-sheet.layout';
import { MAX_VARIANTS } from '../variants';

const layoutFor = (setCount: number) =>
  answerSheetLayout({ questionCount: 40, optionCount: 4, codeDigits: 4, setCount });

describe('answer sheet set bubbles', () => {
  it('keeps the single column every sheet printed so far was read with', () => {
    const before = layoutFor(8);
    for (let i = 0; i < 8; i += 1) {
      expect(before.sets.bubble(i).x).toBe(before.sets.bubble(0).x);
    }
    expect(layoutFor(SETS_PER_COLUMN).code.left).toBe(before.code.left);
  });

  it('wraps 25 sets into columns that stay beside the code grid', () => {
    const layout = layoutFor(MAX_VARIANTS);
    const bubbles = Array.from({ length: MAX_VARIANTS }, (_, i) => layout.sets.bubble(i));
    const lowestCode = layout.code.bubble(0, 9).y;
    const rightEdge = layout.corners[1].x - layout.fiducialSize / 2;

    for (const b of bubbles) {
      expect(b.y).toBeLessThanOrEqual(lowestCode);
      expect(b.x + BUBBLE_R).toBeLessThan(rightEdge);
      expect(b.x - BUBBLE_R).toBeGreaterThan(layout.code.bubble(layout.code.digits - 1, 0).x);
    }
    // No two bubbles share a spot.
    const spots = new Set(bubbles.map((b) => `${b.x},${b.y}`));
    expect(spots.size).toBe(MAX_VARIANTS);
  });
});
