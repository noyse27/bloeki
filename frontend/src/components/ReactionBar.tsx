import { ConfiguredReaction, ReactionPhase } from '../game/reactions';

interface ReactionBarProps {
  phase: ReactionPhase;
  reactions: ConfiguredReaction[];
  sending: boolean;
  onReact: (reactionId: string) => void;
}

const PHASE_HINT: Record<ReactionPhase, string> = {
  waiting: 'Zwischen den Runden',
  countdown: 'Countdown – kurz und ruhig',
  playing: 'Trailer läuft',
  guessing: 'Zeitleiste einordnen',
  resolved: 'Auflösung',
  finished: 'Partie beendet',
};

export function ReactionBar({ phase, reactions, sending, onReact }: ReactionBarProps) {
  return (
    <div className="pb-reaction-bar" aria-label="Schnellreaktionen">
      <span className="pb-reaction-hint">{PHASE_HINT[phase]}</span>
      <div className="pb-reaction-actions">
        {reactions.map((reaction) => (
          <button
            key={reaction.id}
            type="button"
            className="pb-reaction-btn"
            disabled={sending}
            title={reaction.label}
            aria-label={reaction.label}
            onClick={() => onReact(reaction.id)}
          >
            <span aria-hidden="true">{reaction.symbol}</span>
            <small>{reaction.label}</small>
          </button>
        ))}
      </div>
    </div>
  );
}
