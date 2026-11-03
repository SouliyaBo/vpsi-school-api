import { fromSymbolCode, fromSymbolText, isSymbolFont } from './symbol-font';

describe('the Symbol font', () => {
  it('reads Insert → Symbol codes as the characters they draw', () => {
    // The ຟີຊິກ paper's ohm, as Word stores it.
    expect(fromSymbolCode(0xf057)).toBe('Ω');
    expect(fromSymbolCode(0x57)).toBe('Ω');
    expect(fromSymbolCode(0xf070)).toBe('π');
    expect(fromSymbolCode(0xf0d6)).toBe('√');
    expect(fromSymbolCode(0xf0a3)).toBe('≤');
    expect(fromSymbolCode(0xf0ae)).toBe('→');
    // A bracket piece means nothing on its own.
    expect(fromSymbolCode(0xf0e6)).toBeNull();
  });

  it('reads letters typed in the Symbol font as Greek', () => {
    expect(fromSymbolText('8 W, a + b')).toBe('8 Ω, α + β');
    expect(isSymbolFont('Symbol')).toBe(true);
    expect(isSymbolFont('Wingdings')).toBe(false);
  });
});
