import { useEffect, useRef } from 'react';
import { SLOT_COUNT, STARTER_YEARS, PlayerState } from './types';

// Browsers fire click, click, dblclick for a double-click gesture - they
// don't suppress the two intervening clicks. Wiring onToggleReady straight
// to onClick meant the *first* click of a double-click could already mark
// the last remaining player ready and start the round server-side, so the
// second click then hit a game no longer accepting a ready-toggle and
// errored out (see LiveGameBoard's handleSetReady). Debouncing the click
// lets a genuine double-click be recognized before either action fires.
const DOUBLE_CLICK_MS = 280;

interface PlayerRowProps {
  player: PlayerState;
  isLeader: boolean;
  rank: number;
  canReady: boolean;
  onToggleReady: () => void;
  onToggleAutoReady?: () => void;
  onGapClick?: (index: number) => void;
  onHandleClick?: (index: number) => void;
  onConfirm?: () => void;
  onClear?: () => void;
  currentTrailerYear: number | null;
  timelineRef?: (el: HTMLDivElement | null) => void;
  reaction?: { emoji: string; label: string };
}

export function PlayerRow({
  player: p,
  isLeader,
  rank,
  canReady,
  onToggleReady,
  onToggleAutoReady,
  onGapClick,
  onHandleClick,
  onConfirm,
  onClear,
  currentTrailerYear,
  timelineRef,
  reaction,
}: PlayerRowProps) {
  const clickTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const canAutoReady = Boolean(onToggleAutoReady);
  const canUseAvatar = canReady || canAutoReady;
  useEffect(() => {
    return () => {
      if (clickTimer.current) clearTimeout(clickTimer.current);
    };
  }, []);

  function handleAvatarClick() {
    if (!canUseAvatar) return;
    if (clickTimer.current) {
      // Second click within the window - this is a double-click.
      clearTimeout(clickTimer.current);
      clickTimer.current = null;
      onToggleAutoReady?.();
      return;
    }
    clickTimer.current = setTimeout(() => {
      clickTimer.current = null;
      if (!canReady) return;
      onToggleReady();
    }, DOUBLE_CLICK_MS);
  }

  const score = p.slots.filter((v) => v != null).length;
  const rowClasses = ['pb-row', p.you ? 'pb-you' : '', p.sittingOut ? 'pb-sitting-out' : ''].filter(Boolean).join(' ');

  const boxes: JSX.Element[] = [];

  // Centering N cards in SLOT_COUNT boxes (see timelineSlots.ts's
  // embedTimeline) splits the leftover empty slots unevenly once fewer
  // than 2 remain - the single last empty slot always ends up on the
  // right, so at 9/10 filled there is no ordinary gap box left on the
  // left to click "insert before everything". Same fix as the interior
  // insert-handles below, just anchored at the boundary instead of
  // between two filled slots.
  if (p.you && p.slots[0] != null) {
    boxes.push(
      <div
        key="edge-start"
        className="pb-insert-handle pb-insert-handle-edge"
        title="Karte hier einschieben"
        onClick={onHandleClick ? () => onHandleClick(0) : undefined}
      >
        <span className="pb-gap-plus">+</span>
      </div>,
    );
  }

  for (let i = 0; i < SLOT_COUNT; i++) {
    const val = p.slots[i];
    if (p.pendingSlot === i) {
      const cls = p.pendingResult === 'good' ? 'pb-tile pb-reveal-good' : p.pendingResult === 'bad' ? 'pb-tile pb-reveal-bad' : 'pb-tile pb-pending';
      const label = p.pendingResult ? (currentTrailerYear ?? '') : '?';
      boxes.push(
        <div key={i} className={cls}>
          {label}
        </div>,
      );
    } else if (val != null) {
      boxes.push(
        <div key={i} className="pb-tile pb-filled">
          {val}
        </div>,
      );
    } else {
      boxes.push(
        <div
          key={i}
          className="pb-gap"
          onClick={p.you && onGapClick ? () => onGapClick(i) : undefined}
        >
          <span className="pb-gap-plus">+</span>
        </div>,
      );
    }

    if (p.you && i < SLOT_COUNT - 1 && p.slots[i] != null && p.slots[i + 1] != null) {
      const targetIndex = i + 1;
      boxes.push(
        <div
          key={`h${i}`}
          className="pb-insert-handle"
          title="Karte hier einschieben"
          onClick={onHandleClick ? () => onHandleClick(targetIndex) : undefined}
        >
          <span className="pb-gap-plus">+</span>
        </div>,
      );
    }
  }

  return (
    <div className={rowClasses}>
      <div className="pb-player">
        {reaction && (
          <div className="pb-reaction-bubble" role="status" aria-label={`${p.name}: ${reaction.label}`}>
            <span aria-hidden="true">{reaction.emoji}</span>
            <small>{reaction.label}</small>
          </div>
        )}
        <div
          className={`pb-avatar-wrap${canUseAvatar ? '' : ' pb-static'}`}
          onClick={canUseAvatar ? handleAvatarClick : undefined}
          title={
            canReady
              ? 'Klick: bereit. Doppelklick: Auto bereit (für diese Partie gelockt).'
              : canAutoReady
                ? 'Doppelklick: Auto bereit (für diese Partie gelockt).'
                : undefined
          }
        >
          <div className="pb-avatar">{p.initials}</div>
          <div className={`pb-ready-badge${p.autoReady ? ' pb-ready-locked' : p.ready ? ' pb-ready' : ''}`}>
            {p.autoReady ? '🔒' : p.ready ? '✓' : ''}
          </div>
          <div className="pb-tooltip">
            Punkte: <b>{p.scorePoints}</b>
            <br />
            Karma-Punkte: <b>{p.karma}</b>
            <br />
            Rang: <b>#{rank}</b>
            {p.autoReady && (
              <>
                <br />
                Auto bereit: <b>an</b>
              </>
            )}
          </div>
        </div>
        <div className="pb-player-meta">
          <div className="pb-player-name">
            {p.name}
            {isLeader && score > STARTER_YEARS.length && (
              <span className="pb-crown" title="Führung">
                &#128081;
              </span>
            )}
          </div>
          <div className="pb-player-score">
            {score}/{SLOT_COUNT}
            <span className="pb-score-track">
              <span className="pb-score-fill" style={{ width: `${score * 10}%` }} />
            </span>
          </div>
        </div>
      </div>

      <div className="pb-timeline" ref={timelineRef}>
        {boxes}
      </div>

      {p.you ? (
        <div className="pb-actions">
          <button className="pb-act-btn pb-act-confirm" onClick={onConfirm} disabled={p.pendingSlot === null}>
            &#10003;
          </button>
          <button className="pb-act-btn pb-act-clear" onClick={onClear} disabled={p.pendingSlot === null}>
            &#10005;
          </button>
        </div>
      ) : (
        <div />
      )}
    </div>
  );
}
