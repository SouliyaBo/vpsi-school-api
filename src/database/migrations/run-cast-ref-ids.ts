import { Logger } from '@nestjs/common';
import { connect, connection, Schema, Types } from 'mongoose';
import * as schemas from 'src/database/schemas';

/**
 * Casts every stored reference that is a string back to an ObjectId.
 *
 *   npm run migrate:cast-ref-ids -- --dry-run
 *   npm run migrate:cast-ref-ids
 *
 * The companion to the `SchemaTypes.ObjectId` change. Until that change, every
 * `@Prop({ type: Types.ObjectId })` produced a `Mixed` path — NestJS needs
 * `SchemaTypes.ObjectId` for `@Prop` — so Mongoose cast nothing, and whatever a
 * service handed it was stored verbatim. Any code path that passed an id
 * straight from a DTO left a string behind.
 *
 * With the paths declared properly, Mongoose now casts on query too, which is
 * what makes this migration urgent rather than tidy: a query for an ObjectId no
 * longer matches a row holding the same id as a string. Before the fix those
 * rows were invisible to *some* queries; after it, they are invisible to all of
 * them. **Run this before deploying the schema change, not after.**
 *
 * The paths come from the schemas themselves rather than a hand-written list, so
 * a reference added later is covered without anybody remembering this file.
 *
 * Two things it does not touch, both on purpose:
 *
 *  - free-form payloads — `auditLogs.oldValue`/`newValue`, `notifications.data`,
 *    `examScans.qr` — which are `Mixed` or `String` by design and hold ids as
 *    strings quite correctly;
 *  - references *inside* embedded subdocuments, such as `students.guardians[]`.
 *    Those schemas have no collection of their own, so they are reached through
 *    their parent and would need a positional update. A full scan of the live
 *    database on 2026-09-24 found no string ids in any embedded document, so
 *    there is nothing there to fix; if that ever changes it wants its own
 *    migration rather than a guess bolted onto this one.
 */

/** Every `ObjectId` path a schema declares, including inside arrays. */
function objectIdPaths(schema: Schema): string[] {
  const paths: string[] = [];
  schema.eachPath((name, type) => {
    if (name === '_id') return;
    const instance = (type as { instance?: string }).instance;
    // `$*` is a map path; Mongoose reports its values, not a stored field.
    if (name.includes('$*')) return;
    if (instance === 'ObjectId') paths.push(name);
    else if (instance === 'Array') {
      const caster = (type as { caster?: { instance?: string } }).caster;
      if (caster?.instance === 'ObjectId') paths.push(name);
    }
  });
  return paths;
}

async function main(): Promise<void> {
  const logger = new Logger('CastRefIds');
  const dryRun = process.argv.includes('--dry-run');

  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI is not set');

  await connect(uri);

  // Every exported schema, paired with the collection it is stored in. The
  // `@Schema({ collection })` option is the authority; Mongoose's pluralizer
  // would guess wrong for several of these.
  const entries = Object.entries(schemas).filter(
    ([name, value]) => name.endsWith('Schema') && value instanceof Schema,
  ) as [string, Schema][];

  let totalFixed = 0;
  let totalSkipped = 0;
  const embedded: string[] = [];

  for (const [name, schema] of entries) {
    // No collection means an embedded schema, reached through its parent — see
    // the note above. Expected, so it is not worth a warning apiece.
    const collection = (schema.get('collection') as string | undefined) ?? null;
    if (!collection) {
      embedded.push(name);
      continue;
    }

    const paths = objectIdPaths(schema);
    if (paths.length === 0) continue;

    const col = connection.collection(collection);
    for (const path of paths) {
      // `$type: 'string'` finds the rows the old Mixed path let through. An
      // array path matches when any element is a string, which is what is wanted.
      const bad = await col.find({ [path]: { $type: 'string' } }).toArray();
      if (bad.length === 0) continue;

      for (const doc of bad) {
        const raw = doc[path] as unknown;
        const cast = castValue(raw);
        if (cast === null) {
          logger.warn(
            `${collection}.${path} on ${String(doc._id)}: ${JSON.stringify(raw)} is not a valid id — left as it is`,
          );
          totalSkipped += 1;
          continue;
        }

        logger.log(`${dryRun ? '[dry run] ' : ''}${collection}.${path} on ${String(doc._id)}`);
        if (!dryRun) await col.updateOne({ _id: doc._id }, { $set: { [path]: cast } });
        totalFixed += 1;
      }
    }
  }

  logger.log(`${embedded.length} embedded schema(s) not scanned: ${embedded.join(', ')}`);
  logger.log(
    `${dryRun ? '[dry run] ' : ''}done — ${totalFixed} value(s) cast, ${totalSkipped} left as they are`,
  );
  await connection.close();
}

/**
 * One stored value as an ObjectId, or `null` when it cannot be one.
 *
 * Arrays are cast element by element, keeping anything that was already an
 * ObjectId; a single unusable element fails the whole array rather than
 * silently dropping a reference out of a list.
 */
function castValue(raw: unknown): Types.ObjectId | Types.ObjectId[] | null {
  if (Array.isArray(raw)) {
    const cast = raw.map((item) =>
      item instanceof Types.ObjectId
        ? item
        : typeof item === 'string' && Types.ObjectId.isValid(item)
          ? new Types.ObjectId(item)
          : null,
    );
    return cast.every((item): item is Types.ObjectId => item !== null) ? cast : null;
  }
  if (typeof raw === 'string' && Types.ObjectId.isValid(raw)) return new Types.ObjectId(raw);
  return null;
}

main().catch((error: unknown) => {
  new Logger('CastRefIds').error(error);
  process.exit(1);
});
