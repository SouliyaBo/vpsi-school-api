import { Gender } from 'src/common/constants/enums';
import { LAO_PHONE_PATTERN, normalizeLaoPhone } from 'src/common/utils/phone';

/**
 * One row of the school's own student register, as it is held today.
 *
 * Written to match the file rather than our schema — every difference between
 * the two is handled here, in one place, so the import service deals only in
 * shapes the database already understands.
 */
export interface SourceParent {
  name?: string | null;
  occupation?: string | null;
  phone?: string | null;
  /**
   * A second number for the same parent.
   *
   * Some sheets write both in one cell — `22215304 and 22666395`. Only the first
   * identifies the guardian (it is half of the deduplication key); the second is
   * kept so the office does not lose the number it may actually get an answer on.
   */
  alternate_phone?: string | null;
}

export interface SourceStudent {
  id?: number;
  student_id?: string | null;
  gender?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  nickname?: string | null;
  english_name?: string | null;
  english_nickname?: string | null;
  /** The English-programme class. Not imported — only the Lao curriculum is kept. */
  english_class?: string | null;
  dob?: string | null;
  /** Derived from `dob`, so never stored. */
  age?: number | null;
  father?: SourceParent | null;
  mother?: SourceParent | null;
  address?: { village?: string | null; district?: string | null; province?: string | null } | null;
  contact_phone?: string | null;
  /** `ຊົນເຜົ່າ`, where the sheet records it. */
  ethnicity?: string | null;
  /**
   * Which parent the office actually rings — the register's own answer, in a
   * column of its own.
   *
   * Not always derivable from `contact_phone`: where that names a nanny or an
   * older sibling it matches neither parent, and the primary guardian would
   * otherwise fall to whichever parent happened to be listed first.
   */
  preferred_contact?: 'father' | 'mother' | null;
  notes?: string | null;
  /**
   * Conduct marks. Not imported: a `ConductScore` is keyed by semester and
   * classroom, and at import time the student has neither. Declared so the
   * importer can report the rows it is leaving behind instead of dropping them
   * silently.
   */
  demerits?: { score?: number | null; deducted?: number | null; reason?: string | null } | null;
}

/** Honorifics the register puts in front of a given name, abbreviated or not. */
const TITLES = new Set([
  'ນ',
  'ນ.',
  'ນາງ',
  'ນາງສາວ',
  'ທ',
  'ທ.',
  'ທ້າວ',
  'ດ.ຊ.',
  'ດ.ຍ.',
  'mr.',
  'ms.',
  'mrs.',
]);

/**
 * Splits `ນ. ຈຸທາລັດ` into its honorific and the name proper.
 *
 * The register writes the two in one field. Left joined, the honorific sorts and
 * searches as part of the given name — every girl in the school files under `ນ`.
 */
export function splitTitle(value: string | null | undefined): {
  title?: string;
  name: string;
} {
  const parts = (value ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return { name: parts.join(' ') };

  const [head, ...rest] = parts;
  if (!TITLES.has(head.toLowerCase())) return { name: parts.join(' ') };
  return { title: head, name: rest.join(' ') };
}

/**
 * `ເພັດສະໝອນ ວົງວຽງຄໍາ` → given name, family name.
 *
 * The last token is the family name; everything before it is the given name,
 * which in Lao is often two or three syllables written apart.
 *
 * A one-token name has no family name to take. Rather than duplicate the token,
 * `fallbackLast` is used — for a parent that is the child's own family name,
 * which is the right guess far more often than not, and visible in the report
 * either way.
 */
export function splitLaoName(
  value: string | null | undefined,
  fallbackLast = '',
): { firstNameLo: string; lastNameLo: string } {
  const parts = (value ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstNameLo: '', lastNameLo: '' };
  if (parts.length === 1) {
    return { firstNameLo: parts[0], lastNameLo: fallbackLast || parts[0] };
  }

  const lastNameLo = parts[parts.length - 1];
  return { firstNameLo: parts.slice(0, -1).join(' '), lastNameLo };
}

/**
 * `Chouthalath SIHAPANYA` → given name, family name.
 *
 * The register capitalizes the family name throughout, which is more reliable
 * than counting tokens: a two-word given name would otherwise lose half of
 * itself to the surname.
 */
export function splitEnglishName(value: string | null | undefined): {
  firstNameEn?: string;
  lastNameEn?: string;
} {
  const parts = (value ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return {};
  if (parts.length === 1) return { firstNameEn: parts[0] };

  const isShouted = (part: string) => part.length > 1 && part === part.toUpperCase();
  const shoutedFrom = parts.findIndex(isShouted);

  if (shoutedFrom > 0) {
    return {
      firstNameEn: parts.slice(0, shoutedFrom).join(' '),
      lastNameEn: parts.slice(shoutedFrom).join(' '),
    };
  }

  return { firstNameEn: parts.slice(0, -1).join(' '), lastNameEn: parts[parts.length - 1] };
}

/** A written phone number: digits, with the spaces and dashes the office adds. */
const WRITTEN_NUMBER = /\+?\d[\d\s-]*\d|\d/;

/**
 * Splits a contact cell into the number and who answers it.
 *
 * The register annotates a contact number whenever it is not a parent's, and it
 * does so in whichever order the typist thought of first —
 * `9112 1155 (ເອື້ອຍລ້ຽງ)` on one sheet, `ເອື້ອຍລ້ຽງ(ໜູເລັກ) 9112 1155` on the
 * next. Left whole, `normalizeLaoPhone` strips the brackets rather than the
 * note and yields `ເອື້ອຍລ້ຽງໜູເລັກ91121155` — not a phone number at all, but
 * truthy, so it would be stored as one.
 *
 * So the number is lifted out by finding the digits wherever they sit, and
 * whatever is left over is the name. A cell whose digits do not make a Lao
 * number yields no `contactPhone`: the caller reports it, rather than the
 * register's prose being filed under a field the school later dials.
 */
export function splitContact(value: string | null | undefined): {
  contactPhone?: string;
  contactName?: string;
} {
  const trimmed = (value ?? '').trim();
  if (!trimmed) return {};

  const match = WRITTEN_NUMBER.exec(trimmed);
  const phone = match ? (normalizeLaoPhone(match[0]) as string) : '';

  // Everything that is not the number names the person holding it, minus the
  // brackets the note is usually wrapped in.
  const contactName = (match ? trimmed.replace(match[0], ' ') : trimmed)
    .replace(/[()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return {
    ...(phone && LAO_PHONE_PATTERN.test(phone) ? { contactPhone: phone } : {}),
    ...(contactName ? { contactName } : {}),
  };
}

export function parseGender(value: string | null | undefined): Gender {
  const normalized = (value ?? '').trim().toLowerCase();
  if (['ຍິງ', 'f', 'female'].includes(normalized)) return 'female';
  if (['ຊາຍ', 'm', 'male'].includes(normalized)) return 'male';
  return 'other';
}

/**
 * `18.5.2014` — day-first, single-digit months, dots for separators.
 *
 * Built in UTC on purpose: a date of birth is a calendar date, and constructing
 * it locally would shift it a day backwards for anyone west of Laos reading the
 * record.
 *
 * Returns `null` for anything unparseable so the row can be reported and
 * skipped — `dateOfBirth` is required, and a wrong one is worse than a refusal.
 */
export function parseSourceDate(value: string | null | undefined): Date | null {
  // Spaces inside the date — `01. 01.2010` — are typing, not meaning. Removing
  // them is not a guess about the value, unlike a month of 22, which is left to
  // fail so a human decides what was meant.
  const trimmed = (value ?? '').replace(/\s+/g, '');
  if (!trimmed) return null;

  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (iso) return buildDate(Number(iso[3]), Number(iso[2]), Number(iso[1]));

  const dayFirst = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/.exec(trimmed);
  if (dayFirst) return buildDate(Number(dayFirst[1]), Number(dayFirst[2]), Number(dayFirst[3]));

  return null;
}

function buildDate(day: number, month: number, year: number): Date | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  // Rejects `31.2.2014`, which would otherwise roll into March.
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date;
}

/**
 * What makes two rows the same parent.
 *
 * Phone alone would merge a mother and father who share a handset; name alone
 * would merge two unrelated people who happen to be namesakes. Together they are
 * wrong only when the same parent is spelled two different ways — which the
 * importer reports rather than guesses at, since a missed merge shows up as
 * siblings that do not know they are siblings.
 */
export function guardianKey(name: string, phone: string): string {
  const foldedName = name.replace(/\s+/g, '').toLowerCase();
  return `${normalizeLaoPhone(phone) as string}|${foldedName}`;
}

/**
 * Folds `ບ້ານໂພນເຄັງ` and `ໂພນເຄັງ` together for lookup.
 *
 * The register drops the class word the seeded locations carry. Provinces are
 * left alone deliberately: `ນະຄອນຫຼວງວຽງຈັນ` (the capital) and `ວຽງຈັນ` (the
 * province around it) are two different places, and stripping the prefix would
 * merge them.
 */
export function locationLookupName(
  value: string,
  type: 'province' | 'district' | 'village',
): string {
  const trimmed = value.trim();
  const prefix = { province: 'ແຂວງ', district: 'ເມືອງ', village: 'ບ້ານ' }[type];
  const stripped = trimmed.startsWith(prefix) ? trimmed.slice(prefix.length) : trimmed;
  return stripped.replace(/\s+/g, '').toLowerCase();
}
