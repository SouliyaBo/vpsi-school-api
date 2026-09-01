import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Logger } from '@nestjs/common';
import { connect, connection, Types } from 'mongoose';
import { stripInvisible } from 'src/common/utils/lao-text';
import {
  OfficialLocation,
  flattenOfficialLocations,
  matchOfficial,
  tightKey,
} from 'src/database/locations/location-matching';

/**
 * Converts the free-text `placeOfBirth` into `birthLocationId` + `birthAddressDetail`,
 * so a birthplace is held exactly like a current address.
 *
 *   npm run migrate:student-birthplace -- --dry-run
 *   npm run migrate:student-birthplace
 *
 * The register wrote the birthplace as one line — `ບ.ອານຸ ມ.ຈັນທະບູລີ ຂ.ນະຄອນຫຼວງວຽງຈັນ` —
 * which reads fine and filters not at all. Nobody can ask "how many of this class
 * were born in Xaythany" of a string, and the same village arrives spelled four
 * ways because there is nothing to spell it against.
 *
 * Resolution goes as deep as the official list allows and stops there: village
 * inside the capital, district everywhere else, since the list carries no
 * villages outside Vientiane Capital. Whatever the chosen node does not account
 * for — the village name of a provincial birth — is kept verbatim in
 * `birthAddressDetail`, so no line of the register is thrown away even when the
 * tree cannot hold it.
 *
 * A string that resolves to nothing at all is moved wholesale into
 * `birthAddressDetail` and reported. That is a spelling for the office to fix in
 * the UI, not something this script should guess at.
 *
 * Connects to Mongo directly rather than booting Nest: one collection, and it
 * needs none of the graph.
 */

/** The three parts of a birthplace line, as written. */
interface WrittenPlace {
  village: string;
  district: string;
  province: string;
}

const officialChildren = new Map<string, OfficialLocation[]>();
for (const row of flattenOfficialLocations()) {
  const key = row.parentCode ?? '';
  officialChildren.set(key, [...(officialChildren.get(key) ?? []), row]);
}

/**
 * Splits `ບ.X ມ.Y ຂ.Z` on its class markers rather than on punctuation.
 *
 * The register separates the three parts with a comma, a space, or nothing at
 * all, and village names contain both spaces and commas — `ບ. ນາທາມ,​ ມ. ຫາດຊາຍຟອງ`.
 * The markers (`ບ.`/`ບ້ານ`, `ມ.`/`ເມືອງ`, `ຂ.`/`ແຂວງ`/`ນະຄອນຫຼວງ`) are the only
 * reliable boundaries, so the line is cut at those.
 *
 * The abbreviations are dropped here rather than left to `matchOfficial`, whose
 * `stripClassWord` knows only the full words: the importers it was written for
 * read a spreadsheet with one column per level, where nobody writes `ບ.` at all.
 * Leaving them on makes every single village miss.
 */
function parsePlace(raw: string): WrittenPlace {
  const text = stripInvisible(raw).replace(/\s+/g, ' ').trim();

  // `ນະຄອນຫຼວງ` is part of the province's own name, so it is kept in the slice it
  // opens; `ຂ.` and `ແຂວງ` are dropped with the marker.
  const provinceAt = text.search(/(?:^|[\s,])(?:ຂ\.|ແຂວງ|ນະຄອນຫຼວງ)/);
  const districtAt = text.search(/(?:^|[\s,])(?:ມ\.|ເມືອງ)/);

  const cut = (from: number, to: number) => text.slice(from, to === -1 ? undefined : to);
  const clean = (value: string) =>
    value
      .replace(/^[\s,]+|[\s,]+$/g, '')
      .replace(/^(?:ບ\.|ບ້ານ|ມ\.|ເມືອງ|ຂ\.|ແຂວງ)\s*/, '')
      .trim();

  // A line with no district marker is a bare village name — three registers
  // write the birthplace as just `ນາສົ້ມມໍ`.
  if (districtAt === -1 && provinceAt === -1) {
    return { village: clean(text), district: '', province: '' };
  }

  const villageEnd = districtAt === -1 ? provinceAt : districtAt;
  const districtEnd = provinceAt === -1 ? -1 : provinceAt;

  return {
    village: clean(cut(0, villageEnd)),
    district: districtAt === -1 ? '' : clean(cut(districtAt, districtEnd)),
    province: provinceAt === -1 ? '' : clean(cut(provinceAt, -1)),
  };
}

interface Resolution {
  /** Official code of the deepest node the line resolves to, or `null`. */
  code: string | null;
  /** Which level `code` names — the caller can only go deeper from a district. */
  level: 'province' | 'district' | 'village' | null;
  /** Human-readable path of that node, for the report. */
  path: string;
  /** The parts the node does not account for, to keep as detail. */
  detail: string;
  note: string | null;
}

/**
 * Resolves as deep as the official list goes, and reports where it stopped.
 *
 * The province is the only part that can be inferred: every birthplace on file
 * that names a district but no province is in the capital, and matching a
 * district name across all eighteen provinces would pick the wrong one. So a
 * missing province is tried against the capital first and only then given up on.
 */
function resolve(written: WrittenPlace): Resolution {
  const provinces = officialChildren.get('') ?? [];
  const provinceName = written.province || (written.district ? 'ນະຄອນຫຼວງວຽງຈັນ' : '');

  const province = provinceName ? matchOfficial(provinceName, 'province', provinces) : null;
  if (!province) {
    return {
      code: null,
      level: null,
      path: '',
      detail: [written.village, written.district, written.province].filter(Boolean).join(', '),
      note: provinceName
        ? `province "${provinceName}" is not on the official list`
        : 'no district or province given',
    };
  }

  const districts = officialChildren.get(province.official.code) ?? [];
  const district = written.district ? matchOfficial(written.district, 'district', districts) : null;

  if (!district) {
    return {
      code: province.official.code,
      level: 'province',
      path: province.official.nameLo,
      detail: [written.village, written.district].filter(Boolean).join(', '),
      note: written.district
        ? `district "${written.district}" is not in ${province.official.nameLo} — ` +
          'stopped at the province'
        : null,
    };
  }

  const villages = officialChildren.get(district.official.code) ?? [];
  const village = written.village ? matchOfficial(written.village, 'village', villages) : null;

  if (village) {
    return {
      code: village.official.code,
      level: 'village',
      path: `${village.official.nameLo}, ${district.official.nameLo}, ${province.official.nameLo}`,
      detail: '',
      note: village.ambiguous
        ? `"${written.village}" names more than one village in ${district.official.nameLo} — ` +
          `took ${village.official.code}`
        : null,
    };
  }

  // Expected outside the capital, where the list has no villages at all: the
  // district is the right answer and the village name belongs in the detail —
  // unless the tree carries the village unofficially, which the caller checks.
  return {
    code: district.official.code,
    level: 'district',
    path: `${district.official.nameLo}, ${province.official.nameLo}`,
    detail: written.village,
    note: !written.village
      ? null
      : villages.length
        ? `village "${written.village}" is not on the official list for ` +
          `${district.official.nameLo} — kept as detail`
        : null,
  };
}

interface StudentRow {
  _id: Types.ObjectId;
  studentCode?: string;
  placeOfBirth?: string | null;
}

async function main(): Promise<void> {
  const logger = new Logger('StudentBirthplace');
  const dryRun = process.argv.includes('--dry-run');

  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI is not set');

  await connect(uri);
  const students = connection.collection('students');
  const locations = connection.collection('locations');

  const rows = (await students
    .find({ placeOfBirth: { $nin: [null, ''] } })
    .project({ studentCode: 1, placeOfBirth: 1 })
    .toArray()) as StudentRow[];

  logger.log(`${rows.length} student(s) have a birthplace on file`);

  const idByCode = new Map<string, Types.ObjectId | null>();
  const findByCode = async (code: string): Promise<Types.ObjectId | null> => {
    if (!idByCode.has(code)) {
      const doc = await locations.findOne({ code, deletedAt: null }, { projection: { _id: 1 } });
      idByCode.set(code, doc?._id ?? null);
    }
    return idByCode.get(code) ?? null;
  };

  /**
   * A village the tree holds that the official list does not name.
   *
   * `ວັດໄຕໃຫຍ່` is somebody's actual birthplace and the location import keeps such
   * rows rather than deleting them, so stopping at the district here would throw
   * away a node that exists. Matched on the name as written, never fuzzily —
   * exactly as `official-location-resolver` does it, and for the same reason: an
   * unofficial row is where a near-miss is most likely to be a different place.
   */
  const findUnofficialVillage = async (
    districtCode: string,
    name: string,
  ): Promise<Types.ObjectId | null> => {
    const districtId = await findByCode(districtCode);
    if (!districtId) return null;

    const wanted = tightKey(name, 'village');
    const siblings = await locations
      .find({ parentId: districtId, type: 'village', deletedAt: null })
      .project({ _id: 1, nameLo: 1 })
      .toArray();

    const hit = siblings.filter((doc) => tightKey(String(doc.nameLo), 'village') === wanted);
    return hit.length === 1 ? (hit[0]._id as Types.ObjectId) : null;
  };

  let resolved = 0;
  let detailOnly = 0;
  const writes: { id: Types.ObjectId; locationId: Types.ObjectId | null; detail: string }[] = [];

  for (const row of rows) {
    const raw = row.placeOfBirth ?? '';
    const label = `${row.studentCode ?? row._id.toHexString()}`;
    const outcome = resolve(parsePlace(raw));

    let locationId: Types.ObjectId | null = null;
    let path = outcome.path;
    let detail = outcome.detail;

    if (outcome.code) {
      locationId = await findByCode(outcome.code);
      if (!locationId) {
        logger.warn(
          `${label}: ${outcome.path} (${outcome.code}) is not in the database — ` +
            'run `npm run import:locations` first; kept the line as detail',
        );
      }
    }

    if (locationId && outcome.level === 'district' && detail) {
      const unofficial = await findUnofficialVillage(outcome.code as string, detail);
      if (unofficial) {
        locationId = unofficial;
        path = `${detail} (unofficial), ${outcome.path}`;
        detail = '';
      }
    }

    // Nothing is dropped: with no node to point at, the whole line stays as text.
    if (!locationId) detail = raw;
    if (locationId) resolved++;
    else detailOnly++;

    if (outcome.note && detail) logger.warn(`${label}: ${outcome.note}`);
    logger.log(
      `${label}: ${JSON.stringify(raw)} → ` +
        `${locationId ? path : '(no location)'}` +
        `${detail ? ` + detail ${JSON.stringify(detail)}` : ''}`,
    );

    writes.push({ id: row._id, locationId, detail });
  }

  // Snapshotted before anything is written, next to the location-import backups.
  // The old strings are the only copy of what the register said, and a resolution
  // this script got wrong is only correctable against them.
  if (!dryRun && rows.length) {
    const dir = join(process.cwd(), 'data', 'backups');
    mkdirSync(dir, { recursive: true });
    const file = join(
      dir,
      `student-birthplace-${new Date().toISOString().replace(/[:.]/g, '-')}.json`,
    );
    writeFileSync(
      file,
      JSON.stringify(
        rows.map((row) => ({
          _id: row._id.toHexString(),
          studentCode: row.studentCode ?? null,
          placeOfBirth: row.placeOfBirth ?? null,
        })),
        null,
        2,
      ),
    );
    logger.log(`backed up ${rows.length} old birthplace string(s) to ${file}`);
  }

  if (dryRun) {
    logger.log(
      `--dry-run: would set birthLocationId on ${resolved}, detail only on ${detailOnly}, ` +
        `and unset placeOfBirth on ${await students.countDocuments({ placeOfBirth: { $exists: true } })} students`,
    );
  } else {
    for (const write of writes) {
      await students.updateOne(
        { _id: write.id },
        {
          $set: {
            birthLocationId: write.locationId,
            birthAddressDetail: write.detail || null,
          },
        },
      );
    }
    // Every student loses the old field, not only the ones that had a value —
    // the schema no longer declares it, so a leftover is dead weight.
    const cleared = await students.updateMany({}, { $unset: { placeOfBirth: '' } });
    logger.log(
      `set birthLocationId on ${resolved} student(s), detail only on ${detailOnly}, ` +
        `unset placeOfBirth on ${cleared.modifiedCount}`,
    );
  }

  await connection.close();
}

main().catch((error: unknown) => {
  new Logger('StudentBirthplace').error(error instanceof Error ? error.stack : String(error));
  process.exit(1);
});
