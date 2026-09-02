// Mirrors backend/src/services/gameState.ts exactly - keep in sync.
import type { ReactionConfig } from './reactions';

export interface GamePlayerState {
  userId: string;
  username: string;
  timeline: number[];
  scorePoints: number;
  karmaPoints: number;
  gamesPlayed: number;
  globalRank: number;
}

export type RoundStatus = 'countdown' | 'playing' | 'guessing' | 'resolved';

export interface CurrentRoundState {
  roundId: string;
  indexNo: number;
  status: RoundStatus;
  startedAt: string;
  countdownMs: number;
  trailerMs: number;
  guessWindowMs: number;
  sitOutUserIds: string[];
  trailerStreamPath: string | null;
  trailerTitle: string | null;
  trailerYear: number | null;
  results: { userId: string; submitted: boolean; correct: boolean; guessedIndex: number | null }[];
}

export interface RoundReadyPhase {
  startedAt: string | null;
  windowMs: number;
  readyUserIds: string[];
}

export interface GameState {
  gameId: string;
  tableId: string;
  status: string;
  winnerUserId: string | null;
  matchEndedAt: string | null;
  matchCloseWindowMs: number;
  players: GamePlayerState[];
  currentRound: CurrentRoundState | null;
  roundReadyPhase: RoundReadyPhase | null;
  autoReadyUserIds: string[];
  displayAnchorPresent: boolean;
  reactionConfig: ReactionConfig;
}
