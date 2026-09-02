import { Trailer } from './types';

const RING_LEN = 295.3;

interface CenterControlProps {
  ringMark: string;
  ringLabel: string;
  progress: number; // 0..1
  frontState: '' | 'pb-counting' | 'pb-playing';
  flipped: boolean;
  revealTrailer: Trailer | null;
  onClick: () => void;
  wrapRef?: (el: HTMLDivElement | null) => void;
}

export function CenterControl({ ringMark, ringLabel, progress, frontState, flipped, revealTrailer, onClick, wrapRef }: CenterControlProps) {
  return (
    <div className="pb-ring-wrap" ref={wrapRef}>
      <svg viewBox="0 0 100 100">
        <defs>
          <linearGradient id="pbRingGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="var(--color-accent, #c9a86a)" />
            <stop offset="100%" stopColor="var(--color-accent-dim, #8a6d3b)" />
          </linearGradient>
        </defs>
        <circle className="pb-ring-bg" cx="50" cy="50" r="47" />
        <circle
          className="pb-ring-fg"
          cx="50"
          cy="50"
          r="47"
          strokeDasharray={RING_LEN}
          strokeDashoffset={RING_LEN * (1 - progress)}
        />
      </svg>
      <div className={`pb-flip-stage${flipped ? ' pb-flipped' : ''}`} onClick={onClick}>
        <div className={`pb-flip-face pb-front ${frontState}`.trim()}>
          <div className="pb-ring-mark">{ringMark}</div>
          <div className="pb-ring-label">{ringLabel}</div>
        </div>
        <div className="pb-flip-face pb-back">
          <div className="pb-reveal-title">Film war</div>
          <div className="pb-reveal-track">{revealTrailer?.title ?? 'Titel'}</div>
          <div className="pb-reveal-year">{revealTrailer?.year ?? '19XX'}</div>
        </div>
      </div>
    </div>
  );
}
