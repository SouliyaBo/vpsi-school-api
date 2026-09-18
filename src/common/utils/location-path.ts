import { Types } from 'mongoose';
import { LocationType } from 'src/common/constants/enums';

/** The minimum a location must expose to be written into an address line. */
export interface AddressableLocation {
  _id: Types.ObjectId | string;
  nameLo: string;
  type: LocationType;
  ancestors?: (Types.ObjectId | string)[];
}

const PREFIX: Readonly<Record<LocationType, string>> = {
  village: 'ບ້ານ',
  district: 'ເມືອງ',
  province: 'ແຂວງ',
};

/**
 * Village-first, the way an address is written and spoken here.
 *
 * The opposite of the order `ancestors` is stored in, which is root-down for
 * querying.
 */
const WRITTEN_ORDER: LocationType[] = ['village', 'district', 'province'];

/**
 * Names the prefix off a name that already carries it.
 *
 * The official village list bakes the word in — 492 of the 538 villages on file
 * are named `ບ້ານໂພນສະຫວັນ`, not `ໂພນສະຫວັນ` — so prefixing unconditionally
 * produces `ບ້ານ ບ້ານໂພນສະຫວັນ`. Districts and provinces in the same list carry
 * no such prefix, which is why this cannot be decided per level.
 */
function withPrefix(entry: AddressableLocation): string {
  const prefix = PREFIX[entry.type];
  const name = entry.nameLo.trim();
  if (name.startsWith(prefix)) {
    const remainder = name.slice(prefix.length).trim();
    // `ບ້ານ` on its own is a name, not a prefix — leave such a row alone rather
    // than reducing it to an empty string.
    return remainder.length > 0 ? `${prefix} ${remainder}` : name;
  }
  return `${prefix} ${name}`;
}

/**
 * The name without its level word: `ໂພນສະຫວັນ` for a village stored as
 * `ບ້ານໂພນສະຫວັນ`. For a form that prints `ບ້ານ … ເມືອງ … ແຂວງ …` as its own
 * labels, where `withPrefix` would double the word.
 */
export function bareLocationName(entry: AddressableLocation): string {
  const prefix = PREFIX[entry.type];
  const name = entry.nameLo.trim();
  if (name.startsWith(prefix)) {
    const remainder = name.slice(prefix.length).trim();
    return remainder.length > 0 ? remainder : name;
  }
  return name;
}

/**
 * Writes a location as an official address line: `ບ້ານ ດອນແດງ ເມືອງ ຈັນທະບູລີ
 * ແຂວງ ນະຄອນຫຼວງວຽງຈັນ`.
 *
 * Each level carries its own word, because a bare `ດອນແດງ ຈັນທະບູລີ
 * ນະຄອນຫຼວງວຽງຈັນ` does not read as an address on a formal letter — and village
 * and district names are drawn from the same pool of words, so without the
 * prefixes a reader cannot tell which is which.
 *
 * `node` may sit at any depth. A child born in Savannakhet is on file no finer
 * than its district (the official village list covers Vientiane Capital only),
 * so a two-level line is a normal result rather than missing data. `detail` is
 * the part the official tree has no node for and is written where the village
 * would go.
 */
export function formatAddressLine(
  node: AddressableLocation | null | undefined,
  ancestors: AddressableLocation[] = [],
  detail?: string | null,
): string {
  const chain = [...ancestors, ...(node ? [node] : [])];

  // A caller that resolved the ancestors with an `$in` query gets them in
  // whatever order Mongo returned, so the level decides the position rather than
  // the input order.
  const sorted = chain
    .filter(
      (entry, index, all) => all.findIndex((o) => String(o._id) === String(entry._id)) === index,
    )
    .sort((a, b) => WRITTEN_ORDER.indexOf(a.type) - WRITTEN_ORDER.indexOf(b.type));

  const parts = sorted.map(withPrefix);

  const trimmedDetail = detail?.trim();
  if (trimmedDetail) {
    // A village on file wins: the detail then names something inside it (a unit,
    // a lane) and belongs beside the village rather than in place of it.
    const hasVillage = sorted.some((entry) => entry.type === 'village');
    if (hasVillage) parts.splice(1, 0, trimmedDetail);
    else parts.unshift(withPrefix({ _id: '', nameLo: trimmedDetail, type: 'village' }));
  }

  return parts.join(' ');
}
