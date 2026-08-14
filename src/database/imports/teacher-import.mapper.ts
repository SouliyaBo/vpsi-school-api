import { Gender, HousingType, MaritalStatus } from 'src/common/constants/enums';
import { LAO_PHONE_PATTERN, normalizeLaoPhone } from 'src/common/utils/phone';

/**
 * One row of the school's staff register, keyed by the spreadsheet's own Lao
 * headers.
 *
 * Declared with the headers verbatim rather than tidied into English names: the
 * file is exported straight from the sheet, and a rename here would only move
 * the moment of truth somewhere less obvious.
 */
export interface SourceTeacher {
  'ລ/ດ'?: string | null;
  'ຊື່ ແລະນາມສະກຸນ'?: string | null;
  'Name and surname'?: string | null;
  mail?: string | null;
  'ເບີໂທ/ເບີແອັບ'?: string | null;
  ຊົນເຜົ່າ?: string | null;
  'ວັນ.ເດືອນ.ປີເກີດ'?: string | null;
  'ບ. ເກີດ'?: string | null;
  'ມ. ເກີດ'?: string | null;
  'ຂ. ເກີດ'?: string | null;
  ບ້ານຢູ່ປັດຈຸບັນ?: string | null;
  ເມືອງຢູ່ປັດຈຸບັນ?: string | null;
  ແຂວງຢູ່ປັດຈຸບັນ?: string | null;
  ຈົບຈາກ?: string | null;
  ສົກຮຽນຈົບປີໃດ?: string | null;
  ສາຂາວິຊາ?: string | null;
  ສອນວິຊາ?: string | null;
  ລະດັບວິຊາສະເພາະ?: string | null;
  'ວັນ/ເດືອນ/ປີ ເຂົ້າອົງການ'?: string | null;
  ເຊົ່າຫ້ອງຢູ່?: string | null;
  ຢູ່ເຮືອນຕົນເອງ?: string | null;
  'ໂສດ/ແຕ່ງງານ'?: string | null;
  ມີລູກຈັກຄົນ?: string | null;
  'ຢູ່ກັບໃຜແດ່(ບອກລະອຽດ)'?: string | null;
  'ຊື່ ເອື້ອຍ/ອ້າຍ/ນ້ອງ ຄີງ(ພ້ອມບອກທີ່ຢູ່ອາໄສລະອຽດ)'?: string | null;
  'ຊື່ພໍ່ ແລະ ນາມສະກຸນ'?: string | null;
  'ທີ່ຢູ່ປັດຈຸບັນ (ພໍ່)'?: string | null;
  'ອາຊີບ (ພໍ່)'?: string | null;
  'ຊື່ແມ່ ແລະ ນາມສະກຸນ'?: string | null;
  'ທີ່ຢູ່ປັດຈຸບັນ (ແມ່)'?: string | null;
  'ອາຊີບ (ແມ່)'?: string | null;
}

/**
 * The two ways Lao writes the same vowel, folded into one.
 *
 * `ຳ` (U+0EB3) and `ໍ` + `າ` (U+0ECD U+0EB2) render identically and mean the
 * same thing, but Unicode gives them no canonical equivalence, so `ຄໍາຮຸ່ງ` and
 * `ຄຳຮຸ່ງ` are two different strings to Mongo. The register uses both, sometimes
 * for the same village two rows apart — left alone that creates the village
 * twice and files two spellings of one surname as two people.
 */
export function normalizeLao(value: string): string {
  return value.normalize('NFC').replace(/ໍາ/g, 'ຳ');
}

const text = (value: string | null | undefined): string => normalizeLao((value ?? '').trim());

// ── Names ───────────────────────────────────────────────────────────────────

/** Honorifics the staff register writes, Lao and English. */
const LAO_TITLES = ['ນາງສາວ', 'ນາງ', 'ທ້າວ', 'ນ', 'ທ'];
const ENGLISH_TITLES = ['miss', 'mrs', 'mr', 'ms'];

/**
 * Splits `ນ. ສົມເພັດ` — and `ນ..ລັດເຊຍ`, and `ທ.ບຸນເຫຼືອ` — into title and name.
 *
 * The student register puts a space after the honorific; this one frequently
 * does not, and sometimes doubles the full stop. Splitting on whitespace alone
 * would leave `ນ..ລັດເຊຍ` as a given name, filing a third of the staff under a
 * punctuation mark. So the title is matched as a prefix and the separators are
 * eaten, whether or not there is a space among them.
 */
export function splitLaoTitle(value: string | null | undefined): {
  title: string | null;
  name: string;
} {
  const trimmed = text(value);
  if (!trimmed) return { title: null, name: '' };

  for (const title of LAO_TITLES) {
    if (!trimmed.startsWith(title)) continue;

    const rest = trimmed.slice(title.length);
    // A bare prefix match is not a title: `ນາງແກ້ວ` starts with `ນ` but the next
    // character is part of the name, not a separator.
    const separator = /^[.\s]+/.exec(rest);
    if (!separator) continue;

    return { title: `${title}.`, name: rest.slice(separator[0].length).trim() };
  }

  return { title: null, name: trimmed };
}

/** Strips `Mr`/`Miss`/`Ms`/`Mrs` from the English name column. */
export function stripEnglishTitle(value: string | null | undefined): string {
  const trimmed = text(value);
  const [head, ...rest] = trimmed.split(/\s+/).filter(Boolean);
  if (!head || rest.length === 0) return trimmed;

  const folded = head.toLowerCase().replace(/\.$/, '');
  return ENGLISH_TITLES.includes(folded) ? rest.join(' ') : trimmed;
}

/**
 * The honorific tells us the gender, in both languages.
 *
 * `gender` is required on a teacher and the register has no column for it, so it
 * is read off the title — which every row on file carries, in one language or
 * the other. A row carrying neither returns `null` and is reported, rather than
 * quietly defaulting everyone to `other`.
 */
export function genderFromTitles(
  laoTitle: string | null,
  englishName: string | null | undefined,
): Gender | null {
  if (laoTitle) {
    const bare = laoTitle.replace(/\.$/, '');
    if (bare === 'ນ' || bare === 'ນາງ' || bare === 'ນາງສາວ') return 'female';
    if (bare === 'ທ' || bare === 'ທ້າວ') return 'male';
  }

  const head = text(englishName).split(/\s+/)[0]?.toLowerCase().replace(/\.$/, '');
  if (head === 'mr') return 'male';
  if (head === 'ms' || head === 'miss' || head === 'mrs') return 'female';

  return null;
}

// ── Subjects, places ────────────────────────────────────────────────────────

/**
 * `ເຄມີສາດ/ຊີວະສາດ/ທຳມະຊາດ` → three subjects.
 *
 * Split on `/` only. A hyphen joins rather than separates here —
 * `ພາສາລາວ-ວັນນະຄະດີ` is one subject, and splitting it would invent two that
 * the curriculum does not have.
 */
export function splitTeachingSubjects(value: string | null | undefined): string[] {
  return text(value)
    .split('/')
    .map((part) => part.trim())
    .filter(Boolean);
}

/**
 * Drops the class word a place is written with, abbreviated or spelled out.
 *
 * The register writes the same district three ways — `ໄຊທານີ`, `ມ.ໄຊທານີ`,
 * `ເມືອງໄຊທານີ` — and a lookup that does not fold them creates the district
 * three times over.
 */
export function stripPlacePrefix(value: string | null | undefined): string | null {
  const trimmed = text(value);
  if (!trimmed) return null;
  return (
    trimmed
      .replace(/^(ບ້ານ|ເມືອງ|ແຂວງ)\s*/, '')
      .replace(/^[ບມຂ]\s*\.\s*/, '')
      .trim() || null
  );
}

// ── Contact ─────────────────────────────────────────────────────────────────

/**
 * Normalizes a number and refuses one that still does not look Lao.
 *
 * The register writes numbers every way they are said — `020 55 529 281`,
 * `98311292`, `2091567725`. `normalizeLaoPhone` folds those together; anything
 * it cannot is returned as `null` so the row imports without a number rather
 * than with a wrong one.
 */
export function parseTeacherPhone(value: string | null | undefined): string | null {
  const normalized = normalizeLaoPhone(text(value));
  if (typeof normalized !== 'string' || !LAO_PHONE_PATTERN.test(normalized)) return null;
  return normalized;
}

export function parseEmail(value: string | null | undefined): string | null {
  const trimmed = text(value).toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed) ? trimmed : null;
}

// ── Dates ───────────────────────────────────────────────────────────────────

/** `13/2/1996`, `6.8.1999`, `1996-02-13` — day-first unless clearly ISO. */
export function parseTeacherDate(value: string | null | undefined): Date | null {
  const trimmed = text(value);
  if (!trimmed) return null;

  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(trimmed);
  if (iso) return buildDate(Number(iso[3]), Number(iso[2]), Number(iso[1]));

  const dayFirst = /^(\d{1,2})\s*[./-]\s*(\d{1,2})\s*[./-]\s*(\d{4})$/.exec(trimmed);
  if (dayFirst) return buildDate(Number(dayFirst[1]), Number(dayFirst[2]), Number(dayFirst[3]));

  return null;
}

function buildDate(day: number, month: number, year: number): Date | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  // UTC on purpose: a birth date is a calendar date, and building it locally
  // shifts it a day backwards for anyone reading the record west of Laos.
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date;
}

/**
 * Whether a parsed date could be a working teacher's birth date.
 *
 * One row on file reads `21/5/2024` for someone who graduated in 2018 — a
 * transcription slip that would otherwise import a newborn onto the staff. The
 * bounds are deliberately wide: this rejects the impossible, not the unusual.
 */
export function isPlausibleBirthDate(date: Date, now: Date = new Date()): boolean {
  const age = (now.getTime() - date.getTime()) / (365.2425 * 24 * 60 * 60 * 1000);
  return age >= 18 && age <= 90;
}

// ── The shifted block ───────────────────────────────────────────────────────

/**
 * Housing, marital status and children, recovered by what the cell *says*.
 *
 * These five columns cannot be read by position. The sheet they came from has
 * two unlabelled date columns — entry into the youth union and the party, going
 * by the ages they imply — and the export dropped their headers, so every later
 * value slid left by an amount that differs from row to row: one row has its
 * housing under `ຢູ່ເຮືອນຕົນເອງ`, another under `ໂສດ/ແຕ່ງງານ`, another under
 * `ມີລູກຈັກຄົນ`.
 *
 * Reading by value instead of position is exact where the vocabulary is closed
 * — `ເຊົ່າຫ້ອງ` is housing wherever it lands, `ແຕ່ງງານ` is marital status — and
 * silent where it is not. Anything unrecognised is left unset and reported, so a
 * teacher fills in their own rather than inheriting a neighbour's.
 */
export interface AmbiguousBlock {
  housingType: HousingType | null;
  maritalStatus: MaritalStatus | null;
  childrenCount: number | null;
  livingWith: string | null;
  /** Cells that matched nothing, for the report. */
  unrecognized: string[];
}

const HOUSING_RULES: { match: (cell: string) => boolean; value: HousingType }[] = [
  // Checked before the others: `ເຮືອນພໍ່ແມ່` and `ເຮືອນເອື້ອຍ` both contain
  // `ເຮືອນ`, and only the qualifier tells them apart.
  { match: (c) => c.includes('ພໍ່ແມ່'), value: 'parents' },
  {
    match: (c) => c.includes('ພີ່ນ້ອງ') || c.includes('ເອື້ອຍ') || c.includes('ອ້າຍ'),
    value: 'relatives',
  },
  // `ເຊົາ` without the tone mark is how one row spells it.
  { match: (c) => c.includes('ເຊົ່າ') || c.includes('ເຊົາ'), value: 'rented' },
  { match: (c) => c.includes('ຕົນເອງ'), value: 'own' },
];

const MARITAL_RULES: { match: (cell: string) => boolean; value: MaritalStatus }[] = [
  { match: (c) => c.includes('ແຕ່ງງານ'), value: 'married' },
  { match: (c) => c.includes('ຢ່າຮ້າງ'), value: 'divorced' },
  { match: (c) => c.includes('ໝ້າຍ') || c.includes('ຫມ້າຍ'), value: 'widowed' },
  { match: (c) => c.includes('ມີແຟນ'), value: 'engaged' },
  { match: (c) => c === 'ໂສດ', value: 'single' },
];

/**
 * Cells the block is recovered from, in sheet order.
 *
 * `ຢູ່ກັບໃຜແດ່` is included because on the worst-shifted rows the block reaches
 * that far; it is still read as prose when nothing else claims it.
 */
export function ambiguousCells(row: SourceTeacher): string[] {
  return [
    text(row['ວັນ/ເດືອນ/ປີ ເຂົ້າອົງການ']),
    text(row['ເຊົ່າຫ້ອງຢູ່']),
    text(row['ຢູ່ເຮືອນຕົນເອງ']),
    text(row['ໂສດ/ແຕ່ງງານ']),
    text(row['ມີລູກຈັກຄົນ']),
    text(row['ຢູ່ກັບໃຜແດ່(ບອກລະອຽດ)']),
  ];
}

/**
 * Whether a cell is a label rather than a sentence.
 *
 * `ພໍ່,ແມ່,ເອື້ອຍ,ນ້ອງ ແລະ ໝາ1ຕົວ` — who someone lives with — contains `ເອື້ອຍ`
 * and would otherwise be read as "lives with relatives". Household prose is
 * listed and long; the closed vocabularies are neither, so only short unlisted
 * cells are offered to them.
 */
function looksLikeLabel(cell: string): boolean {
  return cell.length <= 20 && !/[,;\n]/.test(cell);
}

export function readAmbiguousBlock(row: SourceTeacher): AmbiguousBlock {
  const cells = ambiguousCells(row);
  const livingWithCell = cells.length - 1;

  const result: AmbiguousBlock = {
    housingType: null,
    maritalStatus: null,
    childrenCount: null,
    livingWith: null,
    unrecognized: [],
  };

  /** Cells already accounted for, so one value is never read as two things. */
  const claimed = new Set<number>();

  cells.forEach((cell, index) => {
    if (!cell) return;

    // A date here is one of the two membership columns whose headers were lost.
    // Which of the two it is cannot be told apart, so neither is imported.
    if (parseTeacherDate(cell)) {
      claimed.add(index);
      return;
    }

    if (looksLikeLabel(cell)) {
      const housing = HOUSING_RULES.find((rule) => rule.match(cell));
      if (housing && !result.housingType) {
        result.housingType = housing.value;
        claimed.add(index);
        return;
      }

      const marital = MARITAL_RULES.find((rule) => rule.match(cell));
      if (marital && !result.maritalStatus) {
        result.maritalStatus = marital.value;
        claimed.add(index);
        return;
      }
    }

    if (/^\d{1,2}$/.test(cell) && result.childrenCount === null) {
      result.childrenCount = Number(cell);
      claimed.add(index);
      return;
    }
  });

  // Prose about the household, but only if nothing else took that cell.
  const livingWith = cells[livingWithCell];
  if (livingWith && !claimed.has(livingWithCell)) {
    result.livingWith = livingWith;
    claimed.add(livingWithCell);
  }

  result.unrecognized = cells.filter((cell, index) => cell !== '' && !claimed.has(index));
  return result;
}

/**
 * `ວັນເຂົ້າອົງການ`, but only when its own cell still holds a date.
 *
 * On the rows shifted furthest this column holds the professional grade instead
 * — one row reads `P` — so it is taken at face value only when it parses.
 */
export function parseJoinedOrgDate(row: SourceTeacher): Date | null {
  return parseTeacherDate(row['ວັນ/ເດືອນ/ປີ ເຂົ້າອົງການ']);
}
