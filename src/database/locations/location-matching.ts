import { LocationType } from 'src/common/constants/enums';
import {
  laoSpellingVariants,
  provinceLookupNames,
  stripInvisible,
} from 'src/common/utils/lao-text';
import { LAO_ADDRESS } from './lao-address.data';

/**
 * Matching a name someone typed against the official address list.
 *
 * Everything here is about *reading* names, never about rewriting them: the
 * official spelling is what gets stored, and this module only decides which
 * official row a hand-typed name was reaching for.
 *
 * Three kinds of difference show up between the register and the official list,
 * in rising order of how much they cost to be wrong about:
 *
 *  1. The class word — `ບ້ານໂພນເຄັງ` against `ໂພນເຄັງ`. Pure convention.
 *  2. Invisible or equivalent characters — zero-width spaces, `ຳ` typed as one
 *     character or two, the `ຼ` ligature, tone marks that vary by typist.
 *  3. An actual misspelling — `ໄຊເຊດຖາ` for `ໄຊເສດຖາ`, `ຫາດຊາຍຟອໃ` for
 *     `ຫາດຊາຍຟອງ`. Only an edit distance catches these, and only they can match
 *     the wrong place, so they are reported wherever they are used.
 */

/** The class word each level is written with, when it is written at all. */
const CLASS_WORD: Record<LocationType, string> = {
  province: 'ແຂວງ',
  district: 'ເມືອງ',
  village: 'ບ້ານ',
};

/** `່ ້ ໊ ໋` — typed inconsistently, and never the only difference between two places. */
const TONE_MARKS = /[່-໋]/g;

const AM_DECOMPOSED = /ໍາ/g;
const AM_COMPOSED = 'ຳ';

/** `ຼ` (U+0EBC), the subscript form of `ລ`, which some keyboards produce instead. */
const LO_LIGATURE = /ຼ/g;

/**
 * How far apart two names may be and still be the same place.
 *
 * Districts are few and long, and no two official district names in a province
 * come within three edits of each other, so two edits is safe there and catches
 * `ຫາດຊອງຟອງ` → `ຫາດຊາຍຟອງ`. Villages are the opposite: `ໜອງທາເໜືອ` and
 * `ໜອງທາໃຕ້` are neighbours in the same district, so anything past a single edit
 * would start merging real places, and an unmatched village is reported for the
 * office to decide rather than guessed at.
 */
const MAX_DISTANCE: Record<LocationType, number> = { province: 1, district: 2, village: 1 };

export function stripClassWord(value: string, type: LocationType): string {
  const trimmed = stripInvisible(value).trim();
  const prefix = CLASS_WORD[type];
  return trimmed.startsWith(prefix) ? trimmed.slice(prefix.length).trim() : trimmed;
}

/** Class word and spacing folded away; spelling left alone. */
export function tightKey(value: string, type: LocationType): string {
  return stripClassWord(value, type).replace(/\s+/g, '').toLowerCase();
}

/**
 * `tightKey` with the differences that are invisible on screen folded away too.
 *
 * Deliberately lossy — `ດົງປ່າແລບ` and `ດົງປາແຫຼບ` come down to one edit apart
 * once tone marks and the ligature are gone, which is what makes them findable.
 * Never use it to decide what to store.
 */
export function looseKey(value: string, type: LocationType): string {
  return tightKey(value, type)
    .replace(AM_DECOMPOSED, AM_COMPOSED)
    .replace(TONE_MARKS, '')
    .replace(LO_LIGATURE, 'ລ');
}

/** Every spelling this name might be stored under, folded to tight keys. */
function tightKeysFor(value: string, type: LocationType): string[] {
  const bare = stripClassWord(value, type);
  const spellings = type === 'province' ? provinceLookupNames(bare) : laoSpellingVariants(bare);
  return [...new Set(spellings.map((spelling) => tightKey(spelling, type)))];
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length || !b.length) return Math.max(a.length, b.length);

  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);

  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const substitution = previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1);
      current[j] = Math.min(current[j - 1] + 1, previous[j] + 1, substitution);
    }
    previous = current;
  }

  return previous[b.length];
}

export interface OfficialLocation {
  code: string;
  nameLo: string;
  type: LocationType;
  /** `null` for a province. */
  parentCode: string | null;
}

/** The official list as a flat array, roots first, in source order. */
export function flattenOfficialLocations(): OfficialLocation[] {
  const flat: OfficialLocation[] = [];

  for (const province of LAO_ADDRESS) {
    flat.push({
      code: province.code,
      nameLo: province.nameLo,
      type: 'province',
      parentCode: null,
    });
    for (const district of province.districts) {
      flat.push({
        code: district.code,
        nameLo: district.nameLo,
        type: 'district',
        parentCode: province.code,
      });
      for (const village of district.villages) {
        flat.push({
          code: village.code,
          nameLo: village.nameLo,
          type: 'village',
          parentCode: district.code,
        });
      }
    }
  }

  return flat;
}

/** How a name was matched, weakest confidence last. */
export type MatchQuality = 'code' | 'exact' | 'folded' | 'fuzzy';

export interface MatchResult {
  official: OfficialLocation;
  quality: MatchQuality;
  distance: number;
  /**
   * The official list names two villages in Chanthabouly `ບ້ານດົງປາແຫຼບ` and two
   * in Hatxaifong `ບ້ານຖິ່ນແທ່ນ`. A name alone cannot choose between them, so the
   * lower code wins and the caller is told the choice was arbitrary.
   */
  ambiguous: boolean;
}

/**
 * Finds the official row a typed name refers to, among `candidates`.
 *
 * `candidates` is always the siblings of one parent — the districts of a
 * province, the villages of a district — because a village name is only unique
 * inside its district, and matching across the country would pick a village
 * hundreds of kilometres away that happens to share a name.
 */
export function matchOfficial(
  name: string,
  type: LocationType,
  candidates: OfficialLocation[],
  options: { code?: string | null } = {},
): MatchResult | null {
  if (!candidates.length) return null;

  if (options.code) {
    const byCode = candidates.find((candidate) => candidate.code === options.code);
    if (byCode) return { official: byCode, quality: 'code', distance: 0, ambiguous: false };
  }

  const pick = (matches: OfficialLocation[], quality: MatchQuality): MatchResult => {
    const sorted = [...matches].sort((a, b) => a.code.localeCompare(b.code));
    return { official: sorted[0], quality, distance: 0, ambiguous: sorted.length > 1 };
  };

  const wanted = new Set(tightKeysFor(name, type));
  const exact = candidates.filter((candidate) => wanted.has(tightKey(candidate.nameLo, type)));
  if (exact.length) return pick(exact, 'exact');

  const loose = looseKey(name, type);
  const folded = candidates.filter((candidate) => looseKey(candidate.nameLo, type) === loose);
  if (folded.length) return pick(folded, 'folded');

  const limit = MAX_DISTANCE[type];
  let best: OfficialLocation[] = [];
  let bestDistance = limit + 1;

  for (const candidate of candidates) {
    const distance = levenshtein(loose, looseKey(candidate.nameLo, type));
    if (distance > limit) continue;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = [candidate];
    } else if (distance === bestDistance) {
      best.push(candidate);
    }
  }

  // A tie is a coin flip between two real places. Report it as unmatched and let
  // the office say which one it is.
  if (best.length !== 1) return null;

  return { official: best[0], quality: 'fuzzy', distance: bestDistance, ambiguous: false };
}
