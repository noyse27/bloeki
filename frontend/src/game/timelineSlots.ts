// Adapts the backend's packed, growing timeline (fetchTimeline in
// backend/src/services/timeline.ts orders cards 0..N-1, no reserved slots)
// onto the Playboard prototype's fixed 10-box row (see
// docs/Adolar_Songster_Playboard_UI_Spec_v1_20260822.md section 2.2 and
// playboard/types.ts SLOT_COUNT). The match threshold (matchOutcome.ts
// WIN_CARD_THRESHOLD) and the starting hand size (timeline.ts
// START_BLOCKS_PER_PLAYER) are both exactly 2/10, same as the prototype's
// STARTER_SLOTS/SLOT_COUNT - so centering the N packed cards inside 10
// boxes reproduces the prototype's fixed layout exactly at game start
// (leftPad 4, cards at slots 4/5) and keeps it centered as cards are added.
export const SLOT_COUNT = 10;

export function embedTimeline(years: number[]): (number | null)[] {
  const n = Math.min(years.length, SLOT_COUNT);
  const leftPad = Math.floor((SLOT_COUNT - n) / 2);
  const slots = new Array<number | null>(SLOT_COUNT).fill(null);
  for (let i = 0; i < n; i += 1) slots[leftPad + i] = years[i];
  return slots;
}

/** Inverse of the embedding above: maps a clicked box index (0..SLOT_COUNT)
 *  back to the packed insertion index the backend's position-guess API
 *  expects (0..cardCount) - simply counts how many real cards sit before
 *  that box in `slots` (the *unshifted* embedding from embedTimeline for
 *  the player's actual timeline).
 *
 *  Deliberately takes the raw clicked box index and the unshifted slots,
 *  not gameLogic.placeAt's shifted landingIndex/cardCount: which direction
 *  placeAt shifts existing cards to visually open a slot is a display
 *  choice only, and using a leftPad/cardCount boundary check on the
 *  post-shift landingIndex breaks whenever a left-shift's landing index
 *  happens to coincide with leftPad (e.g. inserting between the first two
 *  cards on an odd-sized timeline) - that previously submitted index 0
 *  ("before everything") for what was visually an insert *between* two
 *  cards, so the server correctly rejected an otherwise-correct guess and
 *  the new card never got added to the timeline. */
export function boxIndexToPackedIndex(boxIndex: number, slots: (number | null)[]): number {
  let count = 0;
  for (let i = 0; i < boxIndex && i < slots.length; i += 1) {
    if (slots[i] !== null) count += 1;
  }
  return count;
}

/** Forward direction of the mapping above: a packed insertion index
 *  (0..cardCount, as returned in a resolved round's `guessedIndex`) back to
 *  a box index in the embedded 10-slot frame - used to reconstruct where a
 *  player's guess landed for the reveal-tile highlight. */
export function packedIndexToBoxIndex(packedIndex: number, cardCount: number): number {
  const leftPad = Math.floor((SLOT_COUNT - cardCount) / 2);
  return leftPad + packedIndex;
}
