import { SLOT_COUNT } from './types';

/** FR-044: leaving mid-game costs -5, and -1 per additional player at the table. */
export function karmaLeavePenalty(playerCount: number): number {
  return -(5 + (playerCount - 1));
}

export interface PlacementResult {
  slots: (number | null)[];
  landingIndex: number;
}

/**
 * Places a (still-hidden) card so it ends up immediately before whatever
 * currently occupies `desiredIndex`. If that slot is already taken (the
 * player wants to insert *between* two adjacent cards), shifts cards toward
 * the nearer free slot to open up room. See UI spec 2.3 ("Schiebelogik").
 * Returns null if the timeline has no free slot at all (full row).
 */
export function placeAt(baseSlots: (number | null)[], desiredIndex: number): PlacementResult | null {
  const slots = baseSlots.slice();

  if (slots[desiredIndex] == null) {
    return { slots, landingIndex: desiredIndex };
  }

  let rightEmpty: number | null = null;
  for (let k = desiredIndex; k < SLOT_COUNT; k++) {
    if (slots[k] == null) {
      rightEmpty = k;
      break;
    }
  }
  let leftEmpty: number | null = null;
  for (let k = desiredIndex - 1; k >= 0; k--) {
    if (slots[k] == null) {
      leftEmpty = k;
      break;
    }
  }

  const rightDist = rightEmpty != null ? rightEmpty - desiredIndex : Infinity;
  const leftDist = leftEmpty != null ? desiredIndex - 1 - leftEmpty : Infinity;
  if (rightEmpty == null && leftEmpty == null) return null;

  if (rightDist <= leftDist && rightEmpty != null) {
    for (let k = rightEmpty; k > desiredIndex; k--) slots[k] = slots[k - 1];
    slots[desiredIndex] = null;
    return { slots, landingIndex: desiredIndex };
  }

  for (let k = leftEmpty as number; k < desiredIndex - 1; k++) slots[k] = slots[k + 1];
  slots[desiredIndex - 1] = null;
  return { slots, landingIndex: desiredIndex - 1 };
}
