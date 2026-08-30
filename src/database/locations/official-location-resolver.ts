import { Model, Types } from 'mongoose';
import { LocationDocument } from 'src/database/schemas';
import { stripInvisible } from 'src/common/utils/lao-text';
import {
  OfficialLocation,
  flattenOfficialLocations,
  matchOfficial,
  tightKey,
} from './location-matching';

/**
 * Turns a register's `province / district / village` columns into a `villageId`.
 *
 * The importers used to create whatever they could not find, which is how the
 * tree ended up with twelve districts in a nine-district capital. The official
 * list is now the authority, so this resolves and never creates: an address the
 * list does not recognise is reported with its exact spelling, and the office
 * fixes either the sheet or the tree.
 *
 * Returning `null` therefore means "no address could be established", never
 * "this student has no address" — which is why callers must leave any stored
 * `villageId` alone rather than overwrite it with the null.
 */

export interface SourceAddress {
  province?: string | null;
  district?: string | null;
  village?: string | null;
}

export interface ResolvedAddress {
  villageId: Types.ObjectId | null;
  /** Why there is no id, phrased for the import report. `null` when resolved. */
  note: string | null;
}

const official = flattenOfficialLocations();

const officialChildren = new Map<string, OfficialLocation[]>();
for (const row of official) {
  const key = row.parentCode ?? '';
  officialChildren.set(key, [...(officialChildren.get(key) ?? []), row]);
}

/** Resolutions made in one import run, so a class of 40 costs a handful of queries. */
export type LocationCache = Map<string, Types.ObjectId | null>;

async function findByCode(
  locations: Model<LocationDocument>,
  code: string,
): Promise<Types.ObjectId | null> {
  const doc = await locations.findOne({ code, deletedAt: null }).select('_id').exec();
  return doc?._id ?? null;
}

/**
 * A village on file under this district that the official list does not name.
 *
 * The location import keeps those rather than deleting them — `ວັດໄຕໃຫຍ່ທົ່ງ` is
 * somebody's actual address — so a re-import of the same register must still
 * find them. Matched on the name as written, never fuzzily: an unofficial row is
 * exactly the case where a near-miss is most likely to be a different place.
 */
async function findUnofficialVillage(
  locations: Model<LocationDocument>,
  districtId: Types.ObjectId,
  name: string,
): Promise<Types.ObjectId | null> {
  const wanted = tightKey(name, 'village');
  const siblings = await locations
    .find({ parentId: districtId, type: 'village', deletedAt: null })
    .select('_id nameLo')
    .exec();

  const hit = siblings.filter((doc) => tightKey(doc.nameLo, 'village') === wanted);
  return hit.length === 1 ? hit[0]._id : null;
}

export async function resolveOfficialVillage(
  locations: Model<LocationDocument>,
  address: SourceAddress,
  cache: LocationCache,
): Promise<ResolvedAddress> {
  const province = stripInvisible(address.province ?? '').trim();
  const district = stripInvisible(address.district ?? '').trim();
  const village = stripInvisible(address.village ?? '').trim();

  if (!province || !district) return { villageId: null, note: null };

  const cacheKey = [province, district, village].join('|');
  if (cache.has(cacheKey)) {
    // A miss is reported once. Forty siblings from the same misspelled village
    // are one thing for the office to fix, not forty lines of report.
    return { villageId: cache.get(cacheKey) ?? null, note: null };
  }

  const miss = (note: string): ResolvedAddress => {
    cache.set(cacheKey, null);
    return { villageId: null, note };
  };

  const provinceMatch = matchOfficial(province, 'province', officialChildren.get('') ?? []);
  if (!provinceMatch) return miss(`province "${province}" is not on the official list`);

  const districts = officialChildren.get(provinceMatch.official.code) ?? [];
  const districtMatch = matchOfficial(district, 'district', districts);
  if (!districtMatch) {
    return miss(`district "${district}" is not in ${provinceMatch.official.nameLo}`);
  }

  const districtId = await findByCode(locations, districtMatch.official.code);
  if (!districtId) {
    return miss(
      `district ${districtMatch.official.code} "${districtMatch.official.nameLo}" is not in the ` +
        'database — run `npm run import:locations` first',
    );
  }

  if (!village) {
    return miss(`no village given for ${districtMatch.official.nameLo}`);
  }

  const villages = officialChildren.get(districtMatch.official.code) ?? [];

  // Outside Vientiane Capital the official list stops at the district, so there
  // is nothing to point a `villageId` at. The village belongs in `addressDetail`,
  // which the office types — this import will not guess at it.
  if (!villages.length) {
    return miss(
      `"${village}" is outside the capital, where the official list has no villages — ` +
        `record it in the address detail of ${districtMatch.official.nameLo}`,
    );
  }

  const villageMatch = matchOfficial(village, 'village', villages);

  if (villageMatch) {
    const villageId = await findByCode(locations, villageMatch.official.code);
    if (villageId) {
      cache.set(cacheKey, villageId);
      return { villageId, note: null };
    }
    return miss(
      `village ${villageMatch.official.code} "${villageMatch.official.nameLo}" is not in the ` +
        'database — run `npm run import:locations` first',
    );
  }

  const unofficial = await findUnofficialVillage(locations, districtId, village);
  if (unofficial) {
    cache.set(cacheKey, unofficial);
    return { villageId: unofficial, note: null };
  }

  return miss(
    `village "${village}" is not on the official list for ${districtMatch.official.nameLo} — ` +
      'correct the spelling in the register, or add the village in Locations',
  );
}
