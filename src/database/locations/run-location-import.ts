import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { Logger } from '@nestjs/common';
import { connect, connection } from 'mongoose';
import { ObjectId } from 'mongodb';
import { LocationType } from 'src/common/constants/enums';
import {
  MatchQuality,
  OfficialLocation,
  flattenOfficialLocations,
  matchOfficial,
  tightKey,
} from './location-matching';

/**
 * Replaces the improvised location tree with the official one, without losing a
 * single address already on file.
 *
 *   npm run import:locations -- --dry-run
 *   npm run import:locations
 *
 * The tree in Mongo was never entered; it accumulated. The student importer
 * created whatever level it could not find, so one register sheet spelling
 * `ໄຊເສດຖາ` and another spelling `ໄຊເຊດຖາ` produced two districts, each holding
 * half the villages of the real one — twelve districts in a capital that has
 * nine, villages hanging off districts that were later deleted, and the same
 * village listed twice for the picker to offer twice.
 *
 * This is not a wipe-and-reload, because 200-odd students, teachers and
 * guardians point at those rows. Every existing row is first matched to the
 * official list, and the row that carries the most references becomes the
 * official one — same `_id`, official name and code — so those references stay
 * valid without being touched. Duplicates fold into it and their references are
 * moved; anything that cannot be matched is kept, re-parented under the official
 * district, and written to the report for the office to resolve. Nothing is
 * hard-deleted and nothing is invented.
 *
 * Codes make it repeatable: `01`, `0101`, `0101001` are the identity of a row,
 * so running this again updates in place instead of building a second tree.
 */

interface LocationDoc {
  _id: ObjectId;
  nameLo: string;
  nameEn?: string | null;
  code?: string | null;
  type: LocationType;
  parentId?: ObjectId | null;
  ancestors?: ObjectId[];
  depth?: number;
  deletedAt?: Date | null;
  deletedBy?: ObjectId | null;
  createdAt?: Date;
  updatedAt?: Date;
}

/** Collections whose `villageId` points into the tree. */
const REFERRING_COLLECTIONS = ['students', 'teachers', 'guardians'] as const;

const DEPTH_BY_TYPE: Record<LocationType, number> = { province: 0, district: 1, village: 2 };

interface Resolution {
  doc: LocationDoc;
  official: OfficialLocation | null;
  quality: MatchQuality | null;
  distance: number;
  ambiguous: boolean;
  /** Why no official row was found, for the report. */
  reason?: string;
}

interface Report {
  ranAt: string;
  dryRun: boolean;
  official: { provinces: number; districts: number; villages: number };
  adopted: { code: string; nameLo: string; was: string; quality: MatchQuality; refs: number }[];
  created: number;
  merged: {
    code: string;
    into: string;
    duplicate: string;
    type: LocationType;
    quality: MatchQuality;
    distance: number;
    refsMoved: number;
  }[];
  /** Same name, same district, no official row to fold them into: folded together. */
  mergedUnofficial: { into: string; duplicate: string; parent: string; refsMoved: number }[];
  fuzzy: { type: LocationType; was: string; matched: string; distance: number; refs: number }[];
  unmatched: {
    type: LocationType;
    nameLo: string;
    parent: string;
    refs: number;
    reason: string;
    deleted: boolean;
  }[];
  danglingRefs: { collection: string; villageId: string; rows: number; note: string }[];
}

async function main(): Promise<void> {
  const logger = new Logger('LocationImport');
  const dryRun = process.argv.includes('--dry-run');
  const now = new Date();

  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI is not set');

  await connect(uri);
  const locations = connection.collection<LocationDoc>('locations');

  const official = flattenOfficialLocations();
  const officialByCode = new Map(official.map((row) => [row.code, row]));
  const officialChildren = new Map<string, OfficialLocation[]>();
  for (const row of official) {
    const key = row.parentCode ?? '';
    officialChildren.set(key, [...(officialChildren.get(key) ?? []), row]);
  }

  const existing = await locations.find({}).toArray();
  const byId = new Map(existing.map((doc) => [doc._id.toString(), doc]));

  // ── What points where ──────────────────────────────────────────────────────
  const refsByLocation = new Map<string, number>();
  const refsByCollection = new Map<string, Map<string, number>>();

  for (const name of REFERRING_COLLECTIONS) {
    const rows = await connection
      .collection(name)
      .aggregate<{ _id: ObjectId; n: number }>([
        { $match: { villageId: { $ne: null } } },
        { $group: { _id: '$villageId', n: { $sum: 1 } } },
      ])
      .toArray();

    const perCollection = new Map<string, number>();
    for (const row of rows) {
      const key = String(row._id);
      perCollection.set(key, row.n);
      refsByLocation.set(key, (refsByLocation.get(key) ?? 0) + row.n);
    }
    refsByCollection.set(name, perCollection);
  }

  /** References to a row and to everything under it — how much a merge would move. */
  const childrenByParent = new Map<string, LocationDoc[]>();
  for (const doc of existing) {
    const key = doc.parentId ? doc.parentId.toString() : '';
    childrenByParent.set(key, [...(childrenByParent.get(key) ?? []), doc]);
  }

  const subtreeRefs = (doc: LocationDoc): number =>
    (refsByLocation.get(doc._id.toString()) ?? 0) +
    (childrenByParent.get(doc._id.toString()) ?? []).reduce(
      (total, child) => total + subtreeRefs(child),
      0,
    );

  // ── Match every existing row to the official list, level by level ──────────
  const resolutions = new Map<string, Resolution>();

  const resolve = (doc: LocationDoc, parentCode: string | null | undefined): Resolution => {
    if (doc.type !== 'province' && !parentCode) {
      return {
        doc,
        official: null,
        quality: null,
        distance: 0,
        ambiguous: false,
        reason: 'its parent is not in the official list',
      };
    }

    const candidates = officialChildren.get(parentCode ?? '') ?? [];
    const match = matchOfficial(doc.nameLo, doc.type, candidates, { code: doc.code });

    return match
      ? {
          doc,
          official: match.official,
          quality: match.quality,
          distance: match.distance,
          ambiguous: match.ambiguous,
        }
      : {
          doc,
          official: null,
          quality: null,
          distance: 0,
          ambiguous: false,
          reason: 'no official row of this name',
        };
  };

  /**
   * A row a previous run already retired: deleted, referenced by nobody, and
   * holding nothing but rows in the same state. Left out of the matching
   * entirely, so re-running reports the work still to do rather than the work
   * already done.
   */
  const isRetired = (doc: LocationDoc): boolean =>
    Boolean(doc.deletedAt) &&
    subtreeRefs(doc) === 0 &&
    (childrenByParent.get(doc._id.toString()) ?? []).every(isRetired);

  for (const type of ['province', 'district', 'village'] as const) {
    for (const doc of existing.filter((row) => row.type === type && !isRetired(row))) {
      const parent = doc.parentId ? byId.get(doc.parentId.toString()) : null;
      const parentCode =
        type === 'province'
          ? null
          : (resolutions.get(parent?._id.toString() ?? '')?.official?.code ?? null);
      resolutions.set(doc._id.toString(), resolve(doc, parentCode));
    }
  }

  // ── One existing row per official row keeps its `_id`; the rest fold in ────
  const claims = new Map<string, LocationDoc[]>();
  for (const resolution of resolutions.values()) {
    if (!resolution.official) continue;
    const code = resolution.official.code;
    claims.set(code, [...(claims.get(code) ?? []), resolution.doc]);
  }

  /** Live before deleted, then whatever carries the most references. */
  const primaryOf = (docs: LocationDoc[]): LocationDoc =>
    [...docs].sort((a, b) => {
      const aLive = a.deletedAt ? 1 : 0;
      const bLive = b.deletedAt ? 1 : 0;
      if (aLive !== bLive) return aLive - bLive;
      const refs = subtreeRefs(b) - subtreeRefs(a);
      if (refs !== 0) return refs;
      return a._id.toString().localeCompare(b._id.toString());
    })[0];

  const primaries = new Map<string, LocationDoc>();
  for (const [code, docs] of claims) primaries.set(code, primaryOf(docs));

  const report: Report = {
    ranAt: now.toISOString(),
    dryRun,
    official: {
      provinces: official.filter((row) => row.type === 'province').length,
      districts: official.filter((row) => row.type === 'district').length,
      villages: official.filter((row) => row.type === 'village').length,
    },
    adopted: [],
    created: 0,
    merged: [],
    mergedUnofficial: [],
    fuzzy: [],
    unmatched: [],
    danglingRefs: [],
  };

  // ── Backup, before a single write ─────────────────────────────────────────
  if (!dryRun) {
    const backupDir = join(process.cwd(), 'data', 'backups');
    mkdirSync(backupDir, { recursive: true });
    const stamp = now.toISOString().replace(/[:.]/g, '-');

    const references: Record<string, { _id: string; villageId: string }[]> = {};
    for (const name of REFERRING_COLLECTIONS) {
      const rows = await connection
        .collection(name)
        .find({ villageId: { $ne: null } }, { projection: { villageId: 1 } })
        .toArray();
      references[name] = rows.map((row) => ({
        _id: String(row._id),
        villageId: String(row.villageId),
      }));
    }

    const backupPath = join(backupDir, `locations-${stamp}.json`);
    writeFileSync(backupPath, JSON.stringify({ locations: existing, references }, null, 2));
    logger.log(`backup written to ${backupPath}`);
  }

  // ── Write the official tree, roots first ──────────────────────────────────
  const idByCode = new Map<string, ObjectId>();
  const inserts: LocationDoc[] = [];

  for (const row of official) {
    const parentId = row.parentCode ? idByCode.get(row.parentCode) : null;
    const grandparent = row.parentCode ? officialByCode.get(row.parentCode)?.parentCode : null;
    const ancestors = [
      ...(grandparent ? [idByCode.get(grandparent)!] : []),
      ...(parentId ? [parentId] : []),
    ];

    const primary = primaries.get(row.code);

    if (primary) {
      idByCode.set(row.code, primary._id);
      const resolution = resolutions.get(primary._id.toString())!;

      report.adopted.push({
        code: row.code,
        nameLo: row.nameLo,
        was: primary.nameLo,
        quality: resolution.quality!,
        refs: subtreeRefs(primary),
      });

      if (resolution.quality === 'fuzzy') {
        report.fuzzy.push({
          type: row.type,
          was: primary.nameLo,
          matched: row.nameLo,
          distance: resolution.distance,
          refs: subtreeRefs(primary),
        });
      }

      if (!dryRun) {
        await locations.updateOne(
          { _id: primary._id },
          {
            $set: {
              nameLo: row.nameLo,
              code: row.code,
              type: row.type,
              parentId: parentId ?? null,
              ancestors,
              depth: DEPTH_BY_TYPE[row.type],
              // A district the office deleted because it was a misspelling is
              // the same district under its right name — bring it back rather
              // than leave its villages unreachable.
              deletedAt: null,
              deletedBy: null,
              updatedAt: now,
            },
          },
        );
      }
      continue;
    }

    const _id = new ObjectId();
    idByCode.set(row.code, _id);
    report.created += 1;
    inserts.push({
      _id,
      nameLo: row.nameLo,
      nameEn: null,
      code: row.code,
      type: row.type,
      parentId: parentId ?? null,
      ancestors,
      depth: DEPTH_BY_TYPE[row.type],
      deletedAt: null,
      deletedBy: null,
      createdAt: now,
      updatedAt: now,
    });
  }

  if (inserts.length && !dryRun) {
    // In batches: one 500-row insert is fine, 655 in a single statement is close
    // enough to the driver's comfort that batching costs nothing to be safe.
    for (let index = 0; index < inserts.length; index += 200) {
      await locations.insertMany(inserts.slice(index, index + 200));
    }
  }
  logger.log(
    `official rows: ${official.length} — adopted ${report.adopted.length}, created ${report.created}`,
  );

  // ── Move references off the duplicates, then retire them ──────────────────
  const remap = new Map<string, ObjectId>();

  for (const [code, docs] of claims) {
    const primary = primaries.get(code)!;
    for (const duplicate of docs) {
      if (duplicate._id.equals(primary._id)) continue;
      const resolution = resolutions.get(duplicate._id.toString())!;
      const refs = refsByLocation.get(duplicate._id.toString()) ?? 0;

      remap.set(duplicate._id.toString(), primary._id);
      report.merged.push({
        code,
        into: officialByCode.get(code)!.nameLo,
        duplicate: duplicate.nameLo,
        type: duplicate.type,
        quality: resolution.quality!,
        distance: resolution.distance,
        refsMoved: refs,
      });

      if (resolution.quality === 'fuzzy') {
        report.fuzzy.push({
          type: duplicate.type,
          was: duplicate.nameLo,
          matched: officialByCode.get(code)!.nameLo,
          distance: resolution.distance,
          refs,
        });
      }
    }
  }

  // ── Whatever the official list does not name: kept, re-parented, reported ─
  /** Kept rows grouped by district and name, to catch duplicates among themselves. */
  const keptGroups = new Map<string, LocationDoc[]>();

  for (const resolution of resolutions.values()) {
    if (resolution.official) continue;
    const { doc } = resolution;

    const parent = doc.parentId ? byId.get(doc.parentId.toString()) : null;
    const parentResolution = parent ? resolutions.get(parent._id.toString()) : undefined;
    const officialParent = parentResolution?.official;

    report.unmatched.push({
      type: doc.type,
      nameLo: doc.nameLo,
      parent: parent?.nameLo ?? '—',
      refs: refsByLocation.get(doc._id.toString()) ?? 0,
      reason: resolution.reason ?? 'no official row of this name',
      deleted: Boolean(doc.deletedAt),
    });

    // Its own name stays as the office wrote it, but it must not hang off a
    // duplicate that is about to be retired.
    if (!officialParent) continue;
    keptGroups.set(`${officialParent.code}|${tightKey(doc.nameLo, doc.type)}`, [
      ...(keptGroups.get(`${officialParent.code}|${tightKey(doc.nameLo, doc.type)}`) ?? []),
      doc,
    ]);

    if (dryRun) continue;
    const newParentId = idByCode.get(officialParent.code)!;
    if (doc.parentId?.equals(newParentId)) continue;

    const grandparentCode = officialByCode.get(officialParent.code)?.parentCode;
    await locations.updateOne(
      { _id: doc._id },
      {
        $set: {
          parentId: newParentId,
          ancestors: [...(grandparentCode ? [idByCode.get(grandparentCode)!] : []), newParentId],
          depth: DEPTH_BY_TYPE[doc.type],
          updatedAt: now,
        },
      },
    );
  }

  // Two kept rows of the same name in the same district are one place written
  // twice — `ສີໄຄ` was entered under Sikhottabong by two different hands. The
  // official list cannot fold them, so they fold into each other.
  for (const docs of keptGroups.values()) {
    if (docs.length < 2) continue;
    const primary = primaryOf(docs);

    for (const duplicate of docs) {
      if (duplicate._id.equals(primary._id)) continue;
      remap.set(duplicate._id.toString(), primary._id);
      report.mergedUnofficial.push({
        into: primary.nameLo,
        duplicate: duplicate.nameLo,
        parent: byId.get(String(primary.parentId))?.nameLo ?? '—',
        refsMoved: refsByLocation.get(duplicate._id.toString()) ?? 0,
      });
    }
  }

  for (const [oldId, newId] of remap) {
    if (dryRun) continue;
    for (const name of REFERRING_COLLECTIONS) {
      await connection
        .collection(name)
        .updateMany({ villageId: new ObjectId(oldId) }, { $set: { villageId: newId } });
    }
  }

  // Retire the duplicates only once nothing points at them any more.
  if (!dryRun && remap.size) {
    await locations.updateMany(
      { _id: { $in: [...remap.keys()].map((id) => new ObjectId(id)) } },
      { $set: { deletedAt: now, code: null, updatedAt: now } },
    );
  }

  // ── References that still lead nowhere ────────────────────────────────────
  for (const name of REFERRING_COLLECTIONS) {
    for (const [villageId, rows] of refsByCollection.get(name)!) {
      const target = remap.get(villageId)
        ? byId.get(String(remap.get(villageId)))
        : byId.get(villageId);

      if (!target) {
        report.danglingRefs.push({
          collection: name,
          villageId,
          rows,
          note: 'points at a location that does not exist',
        });
        continue;
      }

      const resolution = resolutions.get(target._id.toString());
      if (target.type !== 'village') {
        report.danglingRefs.push({
          collection: name,
          villageId,
          rows,
          note: `points at a ${target.type}, not a village`,
        });
      } else if (!resolution?.official && target.deletedAt) {
        report.danglingRefs.push({
          collection: name,
          villageId,
          rows,
          note: `points at deleted "${target.nameLo}", which is not in the official list`,
        });
      }
    }
  }

  // ── Report ────────────────────────────────────────────────────────────────
  const reportDir = join(process.cwd(), 'data');
  mkdirSync(reportDir, { recursive: true });
  const reportPath = join(reportDir, 'location-import-report.json');
  writeFileSync(reportPath, JSON.stringify(report, null, 2));

  logger.log(
    `merged ${report.merged.length} duplicate row(s), moving ${report.merged.reduce((total, row) => total + row.refsMoved, 0)} reference(s)`,
  );

  for (const row of report.mergedUnofficial) {
    logger.log(
      `folded "${row.duplicate}" into "${row.into}" under ${row.parent} — same name, ` +
        `same district (${row.refsMoved} reference(s) moved)`,
    );
  }

  for (const row of report.fuzzy) {
    logger.warn(
      `matched by spelling distance ${row.distance}: "${row.was}" → "${row.matched}" ` +
        `(${row.type}, ${row.refs} reference(s)) — confirm this is the same place`,
    );
  }

  for (const row of report.unmatched) {
    logger.warn(
      `not in the official list: ${row.type} "${row.nameLo}" under "${row.parent}" ` +
        `(${row.refs} reference(s)${row.deleted ? ', deleted' : ''}) — kept as it is`,
    );
  }

  for (const row of report.danglingRefs) {
    logger.warn(`${row.collection}: ${row.rows} row(s) — ${row.note}`);
  }

  if (!dryRun) {
    const counts = await Promise.all(
      (['province', 'district', 'village'] as const).map((type) =>
        locations.countDocuments({ type, deletedAt: null }),
      ),
    );
    logger.log(
      `tree now holds ${counts[0]} provinces, ${counts[1]} districts, ${counts[2]} villages`,
    );
    logger.warn(
      'the running API caches /locations/tree in Redis for an hour — restart it or wait, ' +
        'or the address form keeps serving the old tree',
    );
  } else {
    logger.log('--dry-run: nothing was written');
  }

  logger.log(`report written to ${reportPath}`);
  await connection.close();
}

void main().catch((error: unknown) => {
  new Logger('LocationImport').error(error instanceof Error ? error.stack : String(error));
  process.exit(1);
});
