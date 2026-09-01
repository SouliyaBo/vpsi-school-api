/**
 * Lao month names and the two date shapes official letters are written in.
 *
 * The month is always spelled out. `31/8/2026` is ambiguous to a Lao reader —
 * the day-first convention is not universal on paper — so the register and every
 * letter the office issues write the month as a word, and a certificate that
 * prints digits there looks like a draft.
 */
export const LAO_MONTHS: Readonly<Record<number, string>> = {
  1: 'ມັງກອນ',
  2: 'ກຸມພາ',
  3: 'ມີນາ',
  4: 'ເມສາ',
  5: 'ພຶດສະພາ',
  6: 'ມິຖຸນາ',
  7: 'ກໍລະກົດ',
  8: 'ສິງຫາ',
  9: 'ກັນຍາ',
  10: 'ຕຸລາ',
  11: 'ພະຈິກ',
  12: 'ທັນວາ',
};

/**
 * Reads a date in the school's timezone rather than the server's.
 *
 * Dates of birth are stored at midnight UTC. A server running in UTC+7 that
 * formats them with the local getters returns the same day; one running in UTC-5
 * — which is what a misconfigured container gives you — returns the day before,
 * and a certificate then states a birthday one day off. Reading the UTC parts is
 * correct for a date-only value however the host is configured.
 */
function parts(value: Date): { day: number; month: number; year: number } {
  return {
    day: value.getUTCDate(),
    month: value.getUTCMonth() + 1,
    year: value.getUTCFullYear(),
  };
}

/** `4 ສິງຫາ 2010` — how a date of birth is written inside a sentence. */
export function formatLaoDateLong(value: Date | null | undefined): string {
  if (!value) return '';
  const { day, month, year } = parts(value);
  return `${day} ${LAO_MONTHS[month] ?? month} ${year}`;
}

/** `31/ສິງຫາ/2026` — how a letter's own date is written in its header. */
export function formatLaoDateSlash(value: Date | null | undefined): string {
  if (!value) return '';
  const { day, month, year } = parts(value);
  return `${day}/${LAO_MONTHS[month] ?? month}/${year}`;
}
