import { applyDecorators } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { IsString, Matches } from 'class-validator';

/**
 * The single written form a phone number is stored in: `020…`/`021…` for a
 * number dialled inside Laos, `+856…` for one written for abroad.
 */
export const LAO_PHONE_PATTERN = /^(\+856|0)[0-9]{8,10}$/;

export const LAO_PHONE_MESSAGE = 'Phone must be a Lao number, e.g. 02012345678 or +8562012345678';

/** `+8562058851773` and `008562058851773` are the same number written two ways. */
const WITH_COUNTRY_CODE = /^(?:\+|00)856(\d+)$/;

/**
 * A mobile subscriber number: the eight digits after `020`. The leading digit is
 * the operator — 2 ETL, 5 Unitel, 7 Beeline, 9 LTC.
 */
const MOBILE_SUBSCRIBER = /^[2579]\d{7}$/;

/**
 * Folds the ways a Lao number gets written down into the one form we store.
 *
 * The office writes numbers the way they are said: `5885 1773` for a mobile,
 * dropping the `020` everyone already knows, and with a space in the middle.
 * Left alone that is a 400 on every record the school actually holds, so the
 * number is normalized on the way in rather than the rule being loosened — one
 * stored form is what makes `phone` searchable and comparable at all.
 *
 * Only separators and missing prefixes are repaired. Anything still
 * unrecognisable is passed through untouched for validation to reject, because a
 * number quietly turned into a *different* valid number is worse than one the
 * user is asked to retype.
 */
export function normalizeLaoPhone(value: unknown): unknown {
  if (typeof value !== 'string') return value;

  const compact = value.replace(/[\s()\-.]/g, '');
  if (!compact) return value.trim();

  const abroad = WITH_COUNTRY_CODE.exec(compact);
  // The trunk `0` is a domestic-dialling prefix and is not part of the number.
  if (abroad) return `+856${abroad[1].replace(/^0/, '')}`;

  // A leading `0` means it is already in national form. `021 212 345` is a
  // Vientiane landline, not a mobile missing its `20` — nothing is inserted.
  if (compact.startsWith('0')) return compact;

  if (MOBILE_SUBSCRIBER.test(compact)) return `020${compact}`;

  // National form with the trunk `0` left off, e.g. `20 5885 1773`.
  if (/^\d{8,10}$/.test(compact)) return `0${compact}`;

  return compact;
}

/**
 * A Lao phone number, normalized before it is checked.
 *
 * Combine with `@IsOptional()` for a nullable field — this decorator itself
 * always requires a value.
 */
export function IsLaoPhone(): PropertyDecorator {
  return applyDecorators(
    Transform(({ value }) => normalizeLaoPhone(value)),
    IsString(),
    Matches(LAO_PHONE_PATTERN, { message: LAO_PHONE_MESSAGE }),
  );
}
