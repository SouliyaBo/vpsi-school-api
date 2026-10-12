import { Schema } from 'mongoose';
import * as schemas from 'src/database/schemas';

/**
 * Every reference field is a real `ObjectId` path, not `Mixed`.
 *
 * `@Prop({ type: Types.ObjectId })` compiles, reads correctly and does nothing:
 * NestJS needs `SchemaTypes.ObjectId`, and the `Types` form produces a `Mixed`
 * path that casts neither writes nor queries. Nothing fails — a string id is
 * stored verbatim and a later query for the ObjectId simply matches no rows.
 *
 * That cost the school a working feature: eleven of twelve classrooms held
 * `homeroomTeacherId` as a string, so "which rooms is this teacher responsible
 * for" answered with one room, silently, for months.
 *
 * This is the guard. It is a unit test rather than an e2e one because it needs
 * no database: the mistake is visible in the compiled schema, which is exactly
 * where it should be caught — one wrong `@Prop` in a pull request rather than a
 * report that comes back empty next term.
 */
describe('schema reference paths', () => {
  const entries = Object.entries(schemas).filter(
    (entry): entry is [string, Schema] => entry[0].endsWith('Schema') && entry[1] instanceof Schema,
  );

  it('finds the schemas to check', () => {
    // A guard on the guard: if the export shape ever changes, this test must
    // fail loudly rather than quietly checking nothing.
    expect(entries.length).toBeGreaterThan(30);
  });

  /**
   * Paths that end in `Id`/`Ids` and are not `ObjectId` — the shape of the bug.
   *
   * Named rather than counted, so a failure says which field to fix.
   */
  it('declares every *Id path as ObjectId rather than Mixed', () => {
    const wrong: string[] = [];

    for (const [name, schema] of entries) {
      schema.eachPath((path, type) => {
        if (path === '_id' || path.includes('$*')) return;
        const field = path.split('.').pop() ?? path;
        if (!/Ids?$/.test(field)) return;

        const instance = (type as { instance?: string }).instance;
        const caster = (type as { caster?: { instance?: string } }).caster?.instance;
        const effective = instance === 'Array' ? caster : instance;

        // `String` is a deliberate choice in a couple of places — the verbatim
        // QR payload on a scan, for one — so only `Mixed` is the failure.
        if (effective === 'Mixed') wrong.push(`${name}.${path}`);
      });
    }

    expect(wrong).toEqual([]);
  });
});
