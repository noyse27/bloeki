import './FilmCountdown.css';

interface FilmCountdownProps {
  /** Sekunden bis zum Start, abgerundet auf eine ganze Zahl >= 1 (3, 2, 1). */
  secondsRemaining: number;
  /** 0..1, wie weit der aktuelle Countdown-Tick schon verstrichen ist -
   *  treibt den rotierenden "Ticker"-Strich, wie beim klassischen
   *  "Academy leader"-Countdown vor alten Kinofilmen. */
  progress: number;
}

// 3-2-1-Countdown-Overlay im Stil alter Filmvorspaenne ("Academy leader"):
// zwei konzentrische Kreise, ein Fadenkreuz aus vertikaler+horizontaler
// Linie durch die Mitte, eine grosse zentrierte Zahl und ein dezenter
// rotierender Ticker-Strich. Reines SVG, keine externen Assets - passt zum
// Sepia-Filmklassiker-Theme (siehe theme.css).
export function FilmCountdown({ secondsRemaining, progress }: FilmCountdownProps) {
  const angle = progress * 360;
  return (
    <div className="film-countdown" role="status" aria-label={`Countdown: ${secondsRemaining}`}>
      <svg viewBox="0 0 200 200" className="film-countdown-svg">
        <circle cx="100" cy="100" r="92" className="film-countdown-ring film-countdown-ring-outer" />
        <circle cx="100" cy="100" r="58" className="film-countdown-ring film-countdown-ring-inner" />
        <line x1="100" y1="8" x2="100" y2="192" className="film-countdown-crosshair" />
        <line x1="8" y1="100" x2="192" y2="100" className="film-countdown-crosshair" />
        <line
          x1="100"
          y1="100"
          x2="100"
          y2="12"
          className="film-countdown-ticker"
          transform={`rotate(${angle} 100 100)`}
        />
        <text x="100" y="112" textAnchor="middle" className="film-countdown-number">
          {secondsRemaining}
        </text>
      </svg>
    </div>
  );
}
