import { flattenScript, foldUnicodeScripts, scriptChars, splitScript } from './script';

describe('scriptChars', () => {
  it('marks Word’s raised and lowered runs, one piece each', () => {
    const chars = [...'3×108ms-1'].map((ch, i) => ({
      ch,
      underline: false,
      script: i === 4 ? ('sup' as const) : i >= 7 ? ('sup' as const) : null,
    }));
    expect(
      scriptChars(chars)
        .map((c) => c.ch)
        .join(''),
    ).toBe('3×10[sup]8[/sup]ms[sup]-1[/sup]');
  });

  it('marks a subscript', () => {
    const chars = [...'H2O'].map((ch, i) => ({
      ch,
      underline: false,
      script: i === 1 ? ('sub' as const) : null,
    }));
    expect(
      scriptChars(chars)
        .map((c) => c.ch)
        .join(''),
    ).toBe('H[sub]2[/sub]O');
  });
});

describe('foldUnicodeScripts', () => {
  it('turns the ready-made characters into the same markers', () => {
    expect(foldUnicodeScripts('3 × 10⁸ m/s')).toBe('3 × 10[sup]8[/sup] m/s');
    expect(foldUnicodeScripts('x² + y⁻¹, H₂O')).toBe(
      'x[sup]2[/sup] + y[sup]-1[/sup], H[sub]2[/sub]O',
    );
    expect(foldUnicodeScripts('ບໍ່ມີ')).toBe('ບໍ່ມີ');
  });
});

describe('splitScript', () => {
  it('cuts the text into level, raised and lowered runs', () => {
    expect(splitScript('10[sup]8[/sup] H[sub]2[/sub]O')).toEqual([
      { text: '10', script: null },
      { text: '8', script: 'sup' },
      { text: ' H', script: null },
      { text: '2', script: 'sub' },
      { text: 'O', script: null },
    ]);
    // Mismatched markers are not a run.
    expect(splitScript('10[sup]8[/sub]')).toEqual([{ text: '10[sup]8[/sub]', script: null }]);
    expect(flattenScript('10[sup]8[/sup] H[sub]2[/sub]O')).toBe('10^8 H_2O');
  });
});
