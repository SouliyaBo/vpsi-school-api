import { Types } from 'mongoose';

/**
 * Normalizes a `.lean()` result to the same shape a hydrated document produces.
 *
 * `.lean()` skips Mongoose's `toJSON` transform, so a lean document keeps `_id`
 * while a hydrated one is rendered with `id`. Left alone, list endpoints would
 * return `_id` and single-document endpoints `id` — a difference clients trip
 * over. Every lean read that reaches a response goes through here.
 *
 * Only the top level is rewritten, matching what `baseSchemaOptions.toJSON`
 * does; nested ObjectIds serialize to strings on their own.
 */
export function toApiDocument<T extends { _id?: unknown }>(
  document: T,
): Omit<T, '_id'> & { id: string } {
  const { _id, ...rest } = document as T & { _id: Types.ObjectId };
  return { ...(rest as Omit<T, '_id'>), id: String(_id) };
}

export function toApiDocuments<T extends { _id?: unknown }>(
  documents: T[],
): (Omit<T, '_id'> & { id: string })[] {
  return documents.map(toApiDocument);
}
