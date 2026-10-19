import { useEffect, useRef, useState } from 'react';
import './GameIntro.css';

const INTRO_DURATION_MS = 18_500;

export function GameIntro({ gameStartedAt }: { gameStartedAt: string }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const startedAtMs = new Date(gameStartedAt).getTime();
  const [visible, setVisible] = useState(() => Date.now() < startedAtMs + INTRO_DURATION_MS);

  useEffect(() => {
    const remainingMs = startedAtMs + INTRO_DURATION_MS - Date.now();
    if (remainingMs <= 0) {
      setVisible(false);
      return;
    }
    setVisible(true);
    const timeout = window.setTimeout(() => setVisible(false), remainingMs);
    return () => window.clearTimeout(timeout);
  }, [startedAtMs]);

  function syncToGameStart(): void {
    const video = videoRef.current;
    if (!video) return;
    const elapsedSeconds = Math.max(0, (Date.now() - startedAtMs) / 1000);
    if (Math.abs(video.currentTime - elapsedSeconds) > 0.35) video.currentTime = elapsedSeconds;
    void video.play().catch(() => undefined);
  }

  if (!visible) return null;

  return (
    <div className="game-intro" aria-label="Blöki-Spielintro">
      <video
        ref={videoRef}
        className="game-intro-video"
        src="/bloeki_intro.mp4"
        autoPlay
        muted
        playsInline
        preload="auto"
        onLoadedMetadata={syncToGameStart}
        onEnded={() => setVisible(false)}
      />
    </div>
  );
}
