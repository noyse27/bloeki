import type { GameState } from './types';

export type ReactionPhase = 'waiting' | 'countdown' | 'playing' | 'guessing' | 'resolved' | 'finished';
export type ReactionKind = 'emoji' | 'sticker';

export interface ReactionAsset {
  id: string;
  symbol: string;
  defaultLabel: string;
  kind: ReactionKind;
}

export interface ConfiguredReaction extends ReactionAsset {
  label: string;
}

export type ReactionConfig = Record<ReactionPhase, ConfiguredReaction[]>;

export interface GameReactionEvent {
  gameId: string;
  userId: string;
  username: string;
  reactionId: string;
  phase: ReactionPhase;
  symbol: string;
  label: string;
  kind: ReactionKind;
  sentAt: string;
}

export const REACTION_PHASES: ReactionPhase[] = ['waiting', 'countdown', 'playing', 'guessing', 'resolved', 'finished'];

export function communicationPhase(state: GameState): ReactionPhase {
  if (state.status === 'finished') return 'finished';
  const status = state.currentRound?.status;
  if (status === 'countdown') return 'countdown';
  if (status === 'playing') return 'playing';
  if (status === 'guessing') return 'guessing';
  if (status === 'resolved') return 'resolved';
  return 'waiting';
}
