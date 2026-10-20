import { hasUnderline, splitUnderline, stripUnderline, underlineChars } from './underline';

const chars = (text: string, underlined: string) =>
  [...text].map((ch, i) => ({ ch, underline: underlined[i] === '_' }));

describe('underlineChars', () => {
  it('marks the underlined run of a question', () => {
    // ປ້າຂອງຂ້ອຍ|ພວມ|ໄປຕະຫຼາດ, with ພວມ underlined in Word.
    const text = 'ປ້າຂອງຂ້ອຍພວມໄປຕະຫຼາດ';
    const start = text.indexOf('ພວມ');
    const mask = [...text].map((_, i) => (i >= start && i < start + 3 ? '_' : ' ')).join('');
    expect(underlineChars(chars(text, mask))).toBe('ປ້າຂອງຂ້ອຍ[u]ພວມ[/u]ໄປຕະຫຼາດ');
  });

  it('keeps spaces at a run’s edges outside it, and the ones inside in', () => {
    expect(underlineChars(chars('ກ ຂ ຄ ງ', '  ___ '))).toBe('ກ [u]ຂ ຄ[/u] ງ');
  });

  it('ends a run at a line break', () => {
    expect(underlineChars(chars('ກຂ\nຄງ', '_____'))).toBe('[u]ກຂ[/u]\n[u]ຄງ[/u]');
  });
});

describe('splitUnderline', () => {
  it('cuts the text into underlined and plain runs', () => {
    expect(splitUnderline('ກ[u]ຂ[/u]ຄ')).toEqual([
      { text: 'ກ', underline: false },
      { text: 'ຂ', underline: true },
      { text: 'ຄ', underline: false },
    ]);
    expect(hasUnderline('ກ[u]ຂ[/u]')).toBe(true);
    expect(hasUnderline('ກ[u]ຂ')).toBe(false);
    expect(stripUnderline('ກ[u]ຂ[/u]ຄ')).toBe('ກຂຄ');
  });
});
