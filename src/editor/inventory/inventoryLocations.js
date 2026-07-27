import { LOCATION_KINDS } from './inventoryConstants.js';

/**
 * Structured inventory locations. Prefer these over string parsing.
 * A DOM key serializer exists only for attribute binding.
 */
export function bagLocation(index) {
  return Object.freeze({ kind: LOCATION_KINDS.bag, index });
}

export function equipmentLocation(slot) {
  return Object.freeze({ kind: LOCATION_KINDS.equipment, slot });
}

export function weaponLocation(set, slot) {
  return Object.freeze({ kind: LOCATION_KINDS.weapon, set, slot });
}

export function serializeLocation(location) {
  if (!location) return '';
  if (location.kind === LOCATION_KINDS.bag) return `bag:${location.index}`;
  if (location.kind === LOCATION_KINDS.equipment) return `equipment:${location.slot}`;
  if (location.kind === LOCATION_KINDS.weapon) {
    return `weapon:${location.set}:${location.slot}`;
  }
  return '';
}

export function parseLocation(key) {
  if (typeof key !== 'string' || key.length === 0) return null;
  const [kind, a, b] = key.split(':');
  if (kind === LOCATION_KINDS.bag) {
    if (typeof a !== 'string' || a.length === 0 || !/^\d+$/.test(a)) return null;
    const index = Number(a);
    if (!Number.isInteger(index) || index < 0) return null;
    return bagLocation(index);
  }
  if (kind === LOCATION_KINDS.equipment && a) {
    return equipmentLocation(a);
  }
  if (kind === LOCATION_KINDS.weapon && a && b) {
    if (!/^\d+$/.test(a)) return null;
    const set = Number(a);
    if (!Number.isInteger(set) || set < 1) return null;
    return weaponLocation(set, b);
  }
  return null;
}

export function locationsEqual(left, right) {
  if (!left || !right || left.kind !== right.kind) return false;
  if (left.kind === LOCATION_KINDS.bag) return left.index === right.index;
  if (left.kind === LOCATION_KINDS.equipment) return left.slot === right.slot;
  if (left.kind === LOCATION_KINDS.weapon) {
    return left.set === right.set && left.slot === right.slot;
  }
  return false;
}
