import { LAO_PHONE_PATTERN, normalizeLaoPhone } from './phone';

/**
 * The cases that matter are the ones the school's own records are written in:
 * a mobile given as eight bare digits with a space, no `020` and no country
 * code. Everything here that should be accepted is asserted to also satisfy the
 * stored pattern, since normalizing to something the validator still rejects
 * would be no better than not normalizing at all.
 */
describe('normalizeLaoPhone', () => {
  const accepts = (input: string, expected: string) => {
    const result = normalizeLaoPhone(input);
    expect(result).toBe(expected);
    expect(LAO_PHONE_PATTERN.test(result as string)).toBe(true);
  };

  it('expands a bare mobile subscriber number, as the office writes it', () => {
    accepts('5885 1773', '02058851773');
    accepts('5555 5757', '02055555757');
    // Every operator's leading digit, not just Unitel's.
    accepts('20345678', '02020345678');
    accepts('7712 3456', '02077123456');
    accepts('9912 3456', '02099123456');
  });

  it('strips the separators from a number already in national form', () => {
    accepts('020 5885 1773', '02058851773');
    accepts('020-5885-1773', '02058851773');
    accepts('(020) 5885 1773', '02058851773');
  });

  it('leaves a landline alone rather than reading it as a mobile', () => {
    // `021 212 345` is Vientiane, not a mobile missing its `20` — the leading
    // zero says the number is already national.
    accepts('021 212 345', '021212345');
  });

  it('adds the trunk zero to a national number written without it', () => {
    accepts('20 5885 1773', '02058851773');
  });

  it('folds both spellings of the country code into one', () => {
    accepts('+856 20 5885 1773', '+8562058851773');
    accepts('00856 20 5885 1773', '+8562058851773');
    // The trunk `0` is for domestic dialling and is dropped after the code.
    accepts('+856 020 5885 1773', '+8562058851773');
  });

  it('passes an unrecognisable number through for validation to reject', () => {
    // Too short to be anything — turning it into a plausible number would be
    // worse than asking for it again.
    expect(normalizeLaoPhone('12345')).toBe('12345');
    expect(LAO_PHONE_PATTERN.test('12345')).toBe(false);

    expect(normalizeLaoPhone('not a phone')).toBe('notaphone');
  });

  it('leaves a non-string untouched for the type validator to report', () => {
    expect(normalizeLaoPhone(undefined)).toBeUndefined();
    expect(normalizeLaoPhone(null)).toBeNull();
    expect(normalizeLaoPhone(2058851773)).toBe(2058851773);
  });
});
