export type PendingResult = 'good' | 'bad' | null;

// Trailer statt Song - kein "Artist", nur Titel + Jahr.
export interface Trailer {
  title: string;
  year: number;
}

export interface PlayerState {
  id: string;
  name: string;
  you: boolean;
  initials: string;
  /** Fixed 10-slot timeline; null = empty. */
  slots: (number | null)[];
  /** Snapshot of `slots` taken at the start of the current round, used to
   *  undo shifts/placements when a round resolves incorrectly. */
  roundStartSlots: (number | null)[] | null;
  pendingSlot: number | null;
  pendingResult: PendingResult;
  scorePoints: number;
  karma: number;
  ready: boolean;
  /** "Auto bereit" locked in for this match - see LiveGameBoard's avatar double-click. */
  autoReady: boolean;
  sittingOut: boolean;
}

export const SLOT_COUNT = 10;
export const STARTER_YEARS: [number, number] = [1986, 2004];
export const STARTER_SLOTS: [number, number] = [4, 5];
