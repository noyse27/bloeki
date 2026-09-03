import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import '../playboard/Playboard.css';
import { useAuth } from '../auth/AuthContext';
import { apiFetch, ApiError, API_BASE_URL } from '../api';
import { getSocket } from '../realtime/socket';
import { fetchGameState, setRoundReady, setAutoReady, submitPositionGuess, restartTable, keepTableAlive } from './gameApi';
import { CurrentRoundState, GameState } from './types';
import { buildGameSummaryPdf } from './gameSummaryPdf';
import { embedTimeline, boxIndexToPackedIndex, packedIndexToBoxIndex, SLOT_COUNT } from './timelineSlots';
import { FilmCountdown } from './FilmCountdown';
import { PlayerRow } from '../playboard/PlayerRow';
import { CenterControl } from '../playboard/CenterControl';
import { ExitModal, HelpModal } from '../playboard/Modals';
import { PendingResult, PlayerState } from '../playboard/types';
import blokiIcon from '../assets/brand/blöki-icon.png';
import { karmaLeavePenalty, placeAt } from '../playboard/gameLogic';
import { useWakeLock } from '../hooks/useWakeLock';
import { ReactionBar } from '../components/ReactionBar';
import { communicationPhase, GameReactionEvent, ReactionConfig } from './reactions';
import { keepNewestGameState } from './stateOrdering';
import { describeAudioElement, flushClientDebugEvents, logClientEvent, snapshotClientDebugContext } from '../debugLogging';

/*
 * Real-data counterpart of playboard/Playboard.tsx - reuses that prototype's
 * own components (PlayerRow/CenterControl/Modals) and pure helpers
 * (gameLogic.ts) for the fixed 10-box timeline, deal animation, pending "?"
 * tile before reveal, avatar ready-toggle/tooltip, exit/help modals. The
 * round/ready choreography is driven by the server's broadcast GameState
 * instead of a local timer engine - see gameApi.ts / realtime/socket.ts.
 *
 * Anders als songster (Audio waehrend des Songfensters) zeigt bloeki einen
 * 25s Video-Trailer, gefolgt von einem eigenen 10s Ratefenster
 * ('guessing') - siehe roundEngine.ts. Der Countdown vor dem Trailer wird
 * als eigenes FilmCountdown-Overlay im Stil alter Kinovorspaenne gezeigt.
 */

const VIDEO_MUTED_STORAGE_KEY = 'bloeki:video-muted';
// Matches the backend's AUTO_READY_GRACE_MS (roundConfig.ts): how long any
// reveal (Aufloesung) stays on screen before an all-auto-ready table is
// allowed to move on. Auto-ready only automates the ready click, never
// these reveals - see roundReady.ts.
const REVEAL_MS = 5000;

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}

// Same breakpoint as Playboard.css' mobile layout switch. Desktop keeps the
// trailer inside the normal player window (sized to match the countdown,
// see the aspectRatio rule below); only mobile goes fullscreen, which is
// why the post-trailer guessing window is 10s there instead of songster's
// usual reveal timing - see roundEngine.ts.
function isMobileViewport(): boolean {
  return window.matchMedia('(max-width: 780px)').matches;
}

function nullSlots(): (number | null)[] {
  return new Array(SLOT_COUNT).fill(null);
}

export function LiveGameBoard() {
  const { auth } = useAuth();
  const navigate = useNavigate();
  const { gameId } = useParams<{ gameId: string }>();

  const [state, setState] = useState<GameState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [pendingLocal, setPendingLocal] = useState<{
    slots: (number | null)[];
    landingIndex: number;
    desiredIndex: number;
    base: (number | null)[];
  } | null>(null);
  const [exitOpen, setExitOpen] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [dealt, setDealt] = useState(false);
  const [animatedSlots, setAnimatedSlots] = useState<Record<string, (number | null)[]> | null>(null);
  const [videoMuted, setVideoMuted] = useState(() => window.localStorage.getItem(VIDEO_MUTED_STORAGE_KEY) !== 'false');
  const [videoUnavailable, setVideoUnavailable] = useState(false);
  const [revealUntil, setRevealUntil] = useState<number | null>(null);
  // Full snapshot of the last round that resolved, not just its trailer -
  // GameState.currentRound can already be the *next* round (or gone
  // entirely once the match ends) by the time a reveal needs to render.
  const [lastResolvedRound, setLastResolvedRound] = useState<CurrentRoundState | null>(null);
  const [restarting, setRestarting] = useState(false);
  const [reactionsByUser, setReactionsByUser] = useState<Record<string, GameReactionEvent>>({});
  const [sendingReaction, setSendingReaction] = useState(false);

  const timelineRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const ringWrapRef = useRef<HTMLDivElement | null>(null);
  const dealStartedRef = useRef(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const videoContainerRef = useRef<HTMLDivElement | null>(null);
  const reactionTimersRef = useRef<Map<string, number>>(new Map());

  function debugRoundPayload(extra: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      clientKind: 'player',
      userId: auth?.user.id ?? null,
      tableId: state?.tableId ?? null,
      gameId: state?.gameId ?? gameId ?? null,
      roundId: state?.currentRound?.roundId ?? null,
      roundIndex: state?.currentRound?.indexNo ?? null,
      roundStatus: state?.currentRound?.status ?? null,
      displayAnchorPresent: state?.displayAnchorPresent ?? null,
      videoMuted,
      effectiveMuted: state?.displayAnchorPresent ? true : videoMuted,
      ...extra,
    };
  }

  useEffect(() => {
    if (!auth || !gameId) return;
    logClientEvent({
      eventType: 'game_board_mount',
      clientKind: 'player',
      userId: auth.user.id,
      gameId,
      payload: debugRoundPayload(),
    });
    fetchGameState(gameId, auth.accessToken)
      .then((payload) => {
        logClientEvent({
          eventType: 'game_state_initial_loaded',
          clientKind: 'player',
          userId: auth.user.id,
          tableId: payload.tableId,
          gameId: payload.gameId,
          roundId: payload.currentRound?.roundId ?? null,
          roundIndex: payload.currentRound?.indexNo ?? null,
          payload: {
            status: payload.currentRound?.status ?? null,
            playerCount: payload.players.length,
            displayAnchorPresent: payload.displayAnchorPresent,
          },
        });
        setState(payload);
      })
      .catch((err) => {
        if (err instanceof ApiError && err.status === 404) setNotFound(true);
        else setError('Spielstand konnte nicht geladen werden.');
      });

    const socket = getSocket(auth.accessToken);
    const reactionTimers = reactionTimersRef.current;
    socket.emit('game:join-room', gameId);
    // A flaky connection makes socket.io reconnect automatically, which
    // starts a brand-new server session with zero room memberships - the
    // initial join-room emit above only fires once on mount. Re-fetching
    // state on top of the rejoin closes the gap for whatever happened
    // while disconnected.
    const onReconnect = () => {
      logClientEvent({
        eventType: 'socket_game_rejoin_after_reconnect',
        clientKind: 'player',
        userId: auth.user.id,
        gameId,
        payload: debugRoundPayload({ socketId: socket.id }),
      });
      socket.emit('game:join-room', gameId);
      fetchGameState(gameId, auth.accessToken)
        .then((payload) => setState((current) => keepNewestGameState(current, payload)))
        .catch(() => undefined);
    };
    socket.on('connect', onReconnect);
    const onUpdate = (payload: GameState) => {
      logClientEvent({
        eventType: 'game_update_received',
        clientKind: 'player',
        userId: auth.user.id,
        tableId: payload.tableId,
        gameId: payload.gameId,
        roundId: payload.currentRound?.roundId ?? null,
        roundIndex: payload.currentRound?.indexNo ?? null,
        payload: {
          status: payload.currentRound?.status ?? null,
          playerCount: payload.players.length,
          displayAnchorPresent: payload.displayAnchorPresent,
        },
      });
      setState((current) => keepNewestGameState(current, payload));
    };
    const onConfigUpdate = (payload: { reactions: ReactionConfig }) => {
      setState((current) => (current ? { ...current, reactionConfig: payload.reactions } : current));
    };
    const onReaction = (reaction: GameReactionEvent) => {
      if (reaction.gameId !== gameId) return;
      setReactionsByUser((current) => ({ ...current, [reaction.userId]: reaction }));
      const previousTimer = reactionTimers.get(reaction.userId);
      if (previousTimer) window.clearTimeout(previousTimer);
      const timer = window.setTimeout(() => {
        setReactionsByUser((current) => {
          if (current[reaction.userId]?.sentAt !== reaction.sentAt) return current;
          const next = { ...current };
          delete next[reaction.userId];
          return next;
        });
        reactionTimers.delete(reaction.userId);
      }, 3500);
      reactionTimers.set(reaction.userId, timer);
    };
    socket.on('game:update', onUpdate);
    socket.on('game:reaction', onReaction);
    socket.on('communication:config-updated', onConfigUpdate);
    return () => {
      socket.off('connect', onReconnect);
      socket.off('game:update', onUpdate);
      socket.off('game:reaction', onReaction);
      socket.off('communication:config-updated', onConfigUpdate);
      socket.emit('game:leave-room', gameId);
      for (const timer of reactionTimers.values()) window.clearTimeout(timer);
      reactionTimers.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth, gameId]);

  function handleReaction(reactionId: string) {
    if (!auth || !gameId || sendingReaction) return;
    setSendingReaction(true);
    const socket = getSocket(auth.accessToken);
    socket.emit('game:reaction', { gameId, reactionId }, (result: { ok: boolean; error?: string }) => {
      setSendingReaction(false);
      if (!result.ok && result.error !== 'reaction rate limited') setError('Reaktion konnte nicht gesendet werden.');
    });
    window.setTimeout(() => setSendingReaction(false), 1500);
  }

  // Once a rematch resets the table back to 'open', everyone here needs
  // the table's own broadcast to know to head back to the ready-up flow.
  const tableId = state?.tableId;
  useEffect(() => {
    if (!auth || !tableId) return;
    const socket = getSocket(auth.accessToken);
    socket.emit('table:join-room', tableId);
    const onReconnect = () => socket.emit('table:join-room', tableId);
    socket.on('connect', onReconnect);
    const onTableUpdate = (payload: { state: string }) => {
      if (payload.state === 'open') navigate(`/tisch/${tableId}`);
    };
    socket.on('table:update', onTableUpdate);
    return () => {
      socket.off('connect', onReconnect);
      socket.off('table:update', onTableUpdate);
      socket.emit('table:leave-room', tableId);
    };
  }, [auth, tableId, navigate]);

  useEffect(() => {
    if (!auth || !tableId || state?.status === 'finished') return;
    const ping = () => {
      keepTableAlive(tableId, auth.accessToken).catch(() => undefined);
    };
    ping();
    const id = window.setInterval(ping, 5 * 60 * 1000);
    return () => window.clearInterval(id);
  }, [auth, tableId, state?.status]);

  // A new round means any local pending placement from the previous one is
  // stale - reset it.
  useEffect(() => {
    setPendingLocal(null);
    if (state?.currentRound?.roundId) {
      logClientEvent({
        eventType: 'round_seen',
        clientKind: 'player',
        userId: auth?.user.id ?? null,
        tableId: state.tableId,
        gameId: state.gameId,
        roundId: state.currentRound.roundId,
        roundIndex: state.currentRound.indexNo,
        payload: debugRoundPayload(),
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.currentRound?.roundId]);

  // Remembers the last resolved round's trailer, and holds the ring
  // flipped to the reveal face for a fixed 5s once a round resolves.
  // Keyed on wall-clock time (revealUntil), not on status === 'resolved':
  // an all-auto-ready table's ready window can already arm and start the
  // next round the instant this one resolves, so currentRound can already
  // be the *next* round's 'countdown' by the time this broadcast arrives.
  const roundStatusForReveal = state?.currentRound?.status;
  const roundIdForReveal = state?.currentRound?.roundId;
  const roundIndexForReveal = state?.currentRound?.indexNo;
  useEffect(() => {
    if (roundStatusForReveal !== 'resolved' || !roundIdForReveal || !state) return;
    const round = state.currentRound!;
    setLastResolvedRound((prev) => (prev?.roundId === roundIdForReveal ? prev : round));
    setRevealUntil((prev) => (prev !== null ? prev : Date.now() + REVEAL_MS));
  }, [roundStatusForReveal, roundIdForReveal, state]);

  useEffect(() => {
    if (revealUntil === null || !lastResolvedRound || roundIndexForReveal == null) return;
    if (roundIndexForReveal <= lastResolvedRound.indexNo) return;
    if (roundStatusForReveal === 'countdown') return;
    setRevealUntil(null);
  }, [revealUntil, lastResolvedRound, roundIndexForReveal, roundStatusForReveal]);

  useEffect(() => {
    if (revealUntil === null || now < revealUntil) return;
    setRevealUntil(null);
  }, [revealUntil, now]);

  // Ticks while any timed phase is on screen, so rings/clocks animate
  // smoothly between the (infrequent) real state updates from the server.
  const roundStatus = state?.currentRound?.status;
  useEffect(() => {
    const active =
      state?.roundReadyPhase?.startedAt ||
      (roundStatus && ['countdown', 'playing', 'guessing'].includes(roundStatus)) ||
      state?.status === 'finished' ||
      revealUntil !== null;
    if (!active) return;
    const id = window.setInterval(() => setNow(Date.now()), 200);
    return () => window.clearInterval(id);
  }, [state?.roundReadyPhase?.startedAt, roundStatus, state?.status, revealUntil]);

  // The winner screen's own auto-close countdown.
  useEffect(() => {
    if (state?.status !== 'finished' || !state.matchEndedAt) return;
    const deadline = new Date(state.matchEndedAt).getTime() + state.matchCloseWindowMs;
    if (Date.now() >= deadline) {
      navigate('/lobby');
    }
  }, [state?.status, state?.matchEndedAt, state?.matchCloseWindowMs, now, navigate]);

  // Video: preload as soon as a round - and therefore its stream path - is
  // known, i.e. already during 'countdown', so the file is likely buffered
  // by the time 'playing' starts. Keyed on roundId, not the path string, so
  // a re-broadcast mid-round never restarts a load already in flight.
  const roundId = state?.currentRound?.roundId;
  const trailerStreamPath = state?.currentRound?.trailerStreamPath;
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    setVideoUnavailable(false);
    if (!trailerStreamPath) {
      video.removeAttribute('src');
      video.load();
      return;
    }
    video.src = `${API_BASE_URL}${trailerStreamPath}`;
    video.load();
    logClientEvent({
      eventType: 'video_load_start',
      clientKind: 'player',
      userId: auth?.user.id ?? null,
      tableId: state?.tableId ?? null,
      gameId,
      roundId,
      roundIndex: state?.currentRound?.indexNo ?? null,
      payload: debugRoundPayload({ trailerStreamPath, video: describeAudioElement(video) }),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roundId]);

  // Fullscreen: entered on the actual round start ('playing'), so the
  // browser's user-activation requirement for requestFullscreen() is met
  // by whatever click most recently happened (a ready-click, gap-click,
  // etc.) - a purely server-triggered transition can't itself satisfy that
  // requirement, so this best-effort call silently no-ops if the browser
  // refuses it; the manual "Vollbild"-Knopf (topbar) covers that case.
  useEffect(() => {
    if (roundStatus !== 'playing') return;
    if (!isMobileViewport()) return;
    const container = videoContainerRef.current;
    if (container && !document.fullscreenElement) {
      container.requestFullscreen?.().catch(() => undefined);
    }
  }, [roundStatus]);

  // Plays exactly while the trailer window is actually open ('playing');
  // pauses again once 'guessing' starts.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (roundStatus === 'playing') {
      video.currentTime = 0;
      video
        .play()
        .then(() => {
          logClientEvent({
            eventType: 'video_play_success',
            clientKind: 'player',
            userId: auth?.user.id ?? null,
            tableId: state?.tableId ?? null,
            gameId,
            roundId,
            roundIndex: state?.currentRound?.indexNo ?? null,
            payload: debugRoundPayload({ video: describeAudioElement(video) }),
          });
        })
        .catch((err) => {
          setVideoUnavailable(true);
          logClientEvent({
            eventType: 'video_play_rejected',
            clientKind: 'player',
            userId: auth?.user.id ?? null,
            tableId: state?.tableId ?? null,
            gameId,
            roundId,
            roundIndex: state?.currentRound?.indexNo ?? null,
            payload: snapshotClientDebugContext(
              debugRoundPayload({ errorName: err.name, errorMessage: err.message, video: describeAudioElement(video) }),
            ),
          });
          void flushClientDebugEvents(true);
        });
    } else {
      video.pause();
      if (roundStatus === 'guessing' && document.fullscreenElement) {
        document.exitFullscreen?.().catch(() => undefined);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roundStatus, roundId]);

  useEffect(() => {
    window.localStorage.setItem(VIDEO_MUTED_STORAGE_KEY, String(videoMuted));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoMuted]);

  // Initial deal animation - flies the players' real two starting cards in
  // from the center. Only plays once, and only for a genuinely fresh game.
  useEffect(() => {
    if (!state || dealStartedRef.current) return;
    dealStartedRef.current = true;

    const freshStart = !state.currentRound && state.players.every((p) => p.timeline.length === 2);
    if (!freshStart) {
      setDealt(true);
      return;
    }

    const initial = state;
    window.setTimeout(() => dealCards(initial), 500);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  function dealCards(initial: GameState) {
    const initialMap: Record<string, (number | null)[]> = {};
    initial.players.forEach((p) => {
      initialMap[p.userId] = nullSlots();
    });
    setAnimatedSlots(initialMap);

    const centerRect = ringWrapRef.current?.getBoundingClientRect();
    if (!centerRect) {
      setAnimatedSlots(null);
      setDealt(true);
      return;
    }
    const cx = centerRect.left + centerRect.width / 2 - 34;
    const cy = centerRect.top + centerRect.height / 2 - 38;
    const STARTER_SLOTS = [4, 5];

    let delay = 0;
    initial.players.forEach((p) => {
      const isSelf = p.userId === auth?.user.id;
      STARTER_SLOTS.forEach((slotIdx, ci) => {
        const year = p.timeline[ci];
        const myDelay = delay;
        delay += 260;
        window.setTimeout(() => {
          const ghost = document.createElement('div');
          ghost.className = 'pb-deal-ghost';
          ghost.textContent = String(year);
          ghost.style.left = `${cx}px`;
          ghost.style.top = `${cy}px`;
          document.body.appendChild(ghost);
          requestAnimationFrame(() => {
            const timelineEl = timelineRefs.current.get(p.userId);
            const targetBox = timelineEl?.children[slotIdx] as HTMLElement | undefined;
            const rect = targetBox?.getBoundingClientRect() ?? centerRect;
            const tx = rect.left + rect.width / 2 - 34 - cx;
            const ty = rect.top + rect.height / 2 - 38 - cy;
            ghost.style.transform = `translate(${tx}px, ${ty}px) scale(${isSelf ? 0.95 : 0.65}) rotate(${(Math.random() * 30 - 15).toFixed(0)}deg)`;
            ghost.style.opacity = '0';
          });
          window.setTimeout(() => {
            setAnimatedSlots((prev) => {
              if (!prev) return prev;
              const s = (prev[p.userId] ?? nullSlots()).slice();
              s[slotIdx] = year;
              return { ...prev, [p.userId]: s };
            });
            ghost.remove();
          }, 560);
        }, myDelay);
      });
    });

    window.setTimeout(() => {
      setDealt(true);
      setAnimatedSlots(null);
    }, delay + 700);
  }

  const confettiPieces = useMemo(
    () =>
      Array.from({ length: 26 }, (_, i) => ({
        left: Math.round(Math.random() * 100),
        delay: (Math.random() * 2.4).toFixed(2),
        duration: (2.6 + Math.random() * 1.8).toFixed(2),
        color: ['var(--color-accent-bright)', 'var(--color-accent)', 'var(--color-text)', 'var(--color-accent-dim)'][i % 4],
      })),
    [],
  );

  // Hostmodus (gemeinsames Anzeigegeraet): once a shared screen is
  // connected for this table, every player's own device switches to
  // showing only their own row and mutes itself, since the shared screen
  // is the one playing the trailer out loud for the room.
  const compact = Boolean(state?.displayAnchorPresent);
  const effectiveMuted = compact ? true : videoMuted;

  useWakeLock(Boolean(state) && state?.status !== 'finished');

  const you = state?.players.find((p) => p.userId === auth?.user.id) ?? null;
  const currentUserAutoReady = Boolean(auth && state?.autoReadyUserIds.includes(auth.user.id));
  const maxScore = useMemo(() => Math.max(0, ...(state?.players.map((p) => p.timeline.length) ?? [0])), [state]);
  const rankMap = useMemo(() => {
    const map: Record<string, number> = {};
    for (const p of state?.players ?? []) map[p.userId] = p.globalRank;
    return map;
  }, [state]);

  async function handleSetReady(ready: boolean) {
    if (!auth || !gameId) return;
    try {
      await setRoundReady(gameId, auth.accessToken, ready);
      setError(null);
    } catch {
      setError('Bereit-Status konnte nicht gesetzt werden.');
    }
  }

  async function handleToggleAutoReady() {
    if (!auth || !gameId) return;
    const isAutoReady = state?.autoReadyUserIds.includes(auth.user.id) ?? false;
    try {
      await setAutoReady(gameId, auth.accessToken, !isAutoReady);
      setError(null);
    } catch {
      setError('Auto bereit konnte nicht gesetzt werden.');
    }
  }

  async function handlePlaceClick(desiredIndex: number) {
    if (!canPlaceGuess || !you || !auth || !gameId || !state?.currentRound) return;
    const base = embedTimeline(you.timeline);
    const result = placeAt(base, desiredIndex);
    if (!result) return; // timeline full
    setPendingLocal({ slots: result.slots, landingIndex: result.landingIndex, desiredIndex, base });

    const packedIndex = boxIndexToPackedIndex(desiredIndex, base);
    try {
      await submitPositionGuess(gameId, state.currentRound.roundId, auth.accessToken, packedIndex);
    } catch {
      setError('Platzierung konnte nicht übermittelt werden.');
    }
  }

  function handleClear() {
    setPendingLocal(null);
  }

  async function handleConfirm() {
    if (!auth || !gameId || !state?.currentRound || !you || pendingLocal === null) return;
    const packedIndex = boxIndexToPackedIndex(pendingLocal.desiredIndex, pendingLocal.base);
    try {
      await submitPositionGuess(gameId, state.currentRound.roundId, auth.accessToken, packedIndex);
    } catch {
      setError('Platzierung konnte nicht übermittelt werden.');
    }
  }

  function handleExportPdf() {
    if (!state) return;
    buildGameSummaryPdf(state).catch(() => setError('PDF konnte nicht erstellt werden.'));
  }

  async function handleRestart() {
    if (!auth || !state || restarting) return;
    setRestarting(true);
    try {
      await restartTable(state.tableId, auth.accessToken);
    } catch {
      setError('Tisch konnte nicht neu gestartet werden.');
      setRestarting(false);
    }
  }

  async function confirmExit() {
    if (!auth || !state || leaving) return;
    setLeaving(true);
    setExitOpen(false);
    try {
      await apiFetch(`/tables/${state.tableId}/leave`, { method: 'POST', token: auth.accessToken });
      navigate('/lobby');
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        navigate('/lobby');
      } else {
        setError('Tisch konnte nicht verlassen werden.');
        setLeaving(false);
      }
    }
  }

  if (!auth) {
    return (
      <div className="playboard">
        <div className="pb-app">
          <p>
            Bitte zuerst <Link to="/login">anmelden</Link>.
          </p>
        </div>
      </div>
    );
  }
  if (notFound) {
    return (
      <div className="playboard">
        <div className="pb-app">
          <p>Diese Partie gibt es nicht (mehr).</p>
          <Link to="/lobby">Zurück zur Lobby</Link>
        </div>
      </div>
    );
  }
  if (!state) {
    return (
      <div className="playboard">
        <div className="pb-app">
          <p>Lade…</p>
        </div>
      </div>
    );
  }

  const round = state.currentRound;
  const readyPhase = state.roundReadyPhase;

  // ---------- center ring content ----------
  let ringMark = '?';
  let ringLabel = 'Bereit?';
  let progress = 0;
  let frontState: '' | 'pb-counting' | 'pb-playing' = '';
  let flipped = false;
  let deckCaption = '';
  let phaseLabel = 'Bereit für nächste Runde';

  if (!dealt) {
    phaseLabel = 'Karten werden verteilt…';
  } else if (revealUntil !== null && now < revealUntil) {
    flipped = true;
    phaseLabel = 'Auflösung';
    if (readyPhase) {
      deckCaption = `${readyPhase.readyUserIds.length}/${state.players.length} bereit`;
    }
  } else if (readyPhase) {
    const iAmReady = you ? readyPhase.readyUserIds.includes(you.userId) : false;
    const readyCount = readyPhase.readyUserIds.length;
    const total = state.players.length;
    if (readyPhase.startedAt) {
      const remaining = Math.max(0, readyPhase.windowMs - (now - new Date(readyPhase.startedAt).getTime()));
      ringMark = String(Math.ceil(remaining / 1000));
      progress = clamp01(1 - remaining / readyPhase.windowMs);
      ringLabel = 'Warte…';
      frontState = 'pb-counting';
      phaseLabel = 'Warte auf Mitspieler';
    } else {
      ringMark = iAmReady ? '✓' : '?';
      ringLabel = 'Bereit?';
    }
    deckCaption = `${readyCount}/${total} bereit`;
  } else if (round) {
    if (round.status === 'playing') {
      ringMark = '🎬';
      ringLabel = 'läuft';
      const elapsed = now - new Date(round.startedAt).getTime() - round.countdownMs;
      const remaining = Math.max(0, round.trailerMs - elapsed);
      progress = clamp01(elapsed / round.trailerMs);
      frontState = 'pb-playing';
      deckCaption = `${Math.ceil(remaining / 1000)}s Trailer`;
      phaseLabel = 'Trailer läuft';
    } else if (round.status === 'guessing') {
      const elapsed = now - new Date(round.startedAt).getTime() - round.countdownMs - round.trailerMs;
      const remaining = Math.max(0, round.guessWindowMs - elapsed);
      ringMark = String(Math.ceil(remaining / 1000) || 1);
      ringLabel = 'einordnen!';
      progress = clamp01(elapsed / round.guessWindowMs);
      frontState = 'pb-counting';
      deckCaption = `Noch ${Math.ceil(remaining / 1000)}s zum Einordnen`;
      phaseLabel = 'Zeitleiste einordnen';
    }
  }

  const canReadyNow = dealt && Boolean(readyPhase);
  const iAmSittingOut = round ? round.sitOutUserIds.includes(you?.userId ?? '') : false;
  // Platzieren ist schon waehrend 'playing' erlaubt, nicht erst ab
  // 'guessing' - die Zeitleiste ist auf breiten Bildschirmen ja schon
  // waehrend des Trailers sichtbar (siehe roundEngine.ts's submitGuess).
  const canPlaceGuess = Boolean(
    dealt && round && (round.status === 'playing' || round.status === 'guessing') && !iAmSittingOut,
  );
  const showCountdownOverlay = dealt && round?.status === 'countdown';
  const countdownElapsed = showCountdownOverlay ? now - new Date(round!.startedAt).getTime() : 0;
  const countdownRemainingMs = showCountdownOverlay ? Math.max(0, round!.countdownMs - countdownElapsed) : 0;

  return (
    <div className="playboard">
      <div className="pb-app">
        <div className="pb-topbar">
          <div className="pb-brand">
            <button className="pb-icon-btn pb-exit" title="Tisch verlassen" aria-label="Tisch verlassen" onClick={() => (state.status === 'finished' ? navigate('/lobby') : setExitOpen(true))}>
              &#10005;
            </button>
            <button className="pb-icon-btn" title="Kurzanleitung" aria-label="Kurzanleitung" onClick={() => setHelpOpen(true)}>
              ?
            </button>
            <button
              className={`pb-icon-btn pb-auto-ready${currentUserAutoReady ? ' pb-active' : ''}`}
              title={currentUserAutoReady ? 'Auto bereit ausschalten' : 'Auto bereit einschalten'}
              aria-label="Auto bereit ein/aus"
              disabled={!you}
              onClick={handleToggleAutoReady}
            >
              &#8635;
            </button>
            <button
              className="pb-icon-btn"
              title="Vollbild umschalten"
              aria-label="Vollbild umschalten"
              onClick={() => {
                if (document.fullscreenElement) document.exitFullscreen?.().catch(() => undefined);
                else videoContainerRef.current?.requestFullscreen?.().catch(() => undefined);
              }}
            >
              &#9974;
            </button>
            <button
              className="pb-icon-btn"
              title={
                compact
                  ? 'Ton läuft auf dem Anzeigegerät'
                  : videoUnavailable
                    ? 'Kein Ton für diesen Trailer verfügbar'
                    : videoMuted
                      ? 'Ton einschalten'
                      : 'Ton ausschalten'
              }
              aria-label="Ton ein/aus"
              disabled={compact}
              onClick={() => setVideoMuted((m) => !m)}
            >
              {effectiveMuted ? '🔇' : '🔊'}
            </button>
            <img src={blokiIcon} alt="" className="pb-brand-mark" />
            <div>
              <div className="pb-brand-title">blöki</div>
              <div className="pb-brand-sub">{compact ? 'Anzeigegerät verbunden' : 'Live-Partie'}</div>
            </div>
            <div className="pb-brand-ids" title={`Tisch-ID: ${state.tableId}`}>
              <span>Tisch {state.tableId.slice(0, 8)}</span>
            </div>
          </div>
          <div className="pb-round-pill">
            <span className="pb-round-dot" />
            &nbsp;Runde <b>{round?.indexNo ?? '—'}</b> &middot; <span>{phaseLabel}</span>
          </div>
        </div>

        <div
          className="pb-video-container"
          ref={videoContainerRef}
          style={{
            position: 'relative',
            // Waehrend des Countdowns braucht der Container eine echte
            // Groesse, auch bevor das Video selbst sichtbar wird - sonst
            // kollabiert er auf Hoehe 0 und das FilmCountdown-Overlay
            // (position: absolute; inset: 0 relativ zu diesem Container)
            // bekommt ebenfalls Hoehe 0. Sein SVG-Inhalt haette dank
            // overflow:visible zwar trotzdem sichtbar geblieben, aber der
            // eigentlich blickdichte Overlay-Hintergrund waere in dieser
            // 0px-hohen Box nicht gemalt worden - das Spielfeld dahinter
            // schien durch. Aspect-Ratio 16:9 hier reserviert denselben
            // Platz, den das Video gleich danach in 'playing' einnimmt.
            aspectRatio: showCountdownOverlay || round?.status === 'playing' ? '16 / 9' : undefined,
          }}
        >
          <video
            ref={videoRef}
            preload="auto"
            muted={effectiveMuted}
            playsInline
            style={{ width: round?.status === 'playing' ? '100%' : 0, height: round?.status === 'playing' ? 'auto' : 0 }}
            onError={() => {
              setVideoUnavailable(true);
              void flushClientDebugEvents(true);
            }}
          />
          {showCountdownOverlay && (
            <FilmCountdown
              secondsRemaining={Math.ceil(countdownRemainingMs / 1000) || 1}
              progress={clamp01(countdownElapsed / (round?.countdownMs || 1))}
            />
          )}
        </div>

        {error && (
          <div className="sh-error" style={{ marginBottom: 4 }}>
            {error}
          </div>
        )}

        <div className="pb-board">
          {(compact && you ? [you] : state.players).map((p) => {
            const isSelf = p.userId === you?.userId;
            const sittingOut = round?.sitOutUserIds.includes(p.userId) ?? false;

            let slots: (number | null)[];
            let pendingSlot: number | null = null;
            let pendingResult: PendingResult = null;
            if (!dealt) {
              slots = animatedSlots?.[p.userId] ?? nullSlots();
            } else if (revealUntil !== null && now < revealUntil) {
              const mine = lastResolvedRound?.results.find((r) => r.userId === p.userId);
              if (mine?.submitted && mine.guessedIndex !== null) {
                if (mine.correct) {
                  slots = embedTimeline(p.timeline);
                  pendingSlot = packedIndexToBoxIndex(mine.guessedIndex, p.timeline.length);
                } else {
                  const base = embedTimeline(p.timeline);
                  const desiredBox = packedIndexToBoxIndex(mine.guessedIndex, p.timeline.length);
                  const result = placeAt(base, desiredBox);
                  slots = result ? result.slots : base;
                  pendingSlot = result ? result.landingIndex : null;
                }
                pendingResult = mine.correct ? 'good' : 'bad';
              } else {
                slots = embedTimeline(p.timeline);
              }
            } else if (isSelf && pendingLocal) {
              slots = pendingLocal.slots;
              pendingSlot = pendingLocal.landingIndex;
            } else {
              slots = embedTimeline(p.timeline);
            }

            const playerState: PlayerState = {
              id: p.userId,
              name: p.username,
              you: isSelf,
              initials: p.username.slice(0, 2).toUpperCase(),
              slots,
              roundStartSlots: null,
              pendingSlot,
              pendingResult,
              scorePoints: p.scorePoints,
              karma: p.karmaPoints,
              ready: readyPhase?.readyUserIds.includes(p.userId) ?? false,
              autoReady: state.autoReadyUserIds.includes(p.userId),
              sittingOut,
            };

            return (
              <PlayerRow
                key={p.userId}
                player={playerState}
                isLeader={p.timeline.length === maxScore && maxScore > 0}
                rank={rankMap[p.userId]}
                canReady={dealt && isSelf && canReadyNow}
                onToggleReady={() => handleSetReady(!(readyPhase?.readyUserIds.includes(p.userId) ?? false))}
                onToggleAutoReady={isSelf ? handleToggleAutoReady : undefined}
                onGapClick={isSelf && canPlaceGuess ? handlePlaceClick : undefined}
                onHandleClick={isSelf && canPlaceGuess ? handlePlaceClick : undefined}
                onConfirm={isSelf ? handleConfirm : undefined}
                onClear={isSelf ? handleClear : undefined}
                currentTrailerYear={round?.trailerYear ?? null}
                timelineRef={(el) => {
                  if (el) timelineRefs.current.set(p.userId, el);
                }}
                reaction={reactionsByUser[p.userId]
                  ? { emoji: reactionsByUser[p.userId].symbol, label: reactionsByUser[p.userId].label }
                  : undefined}
              />
            );
          })}
        </div>

        <ReactionBar
          phase={communicationPhase(state)}
          reactions={state.reactionConfig[communicationPhase(state)]}
          sending={sendingReaction}
          onReact={handleReaction}
        />

        <div className="pb-hint">
          {compact && <>Punktestand und Mitspieler siehst du auf dem Anzeigegerät. </>}
          {canPlaceGuess && (
            <>
              Klick auf eine <b>Lücke</b> in deiner Zeitleiste, um deine Karte dort zu platzieren.
            </>
          )}
          {iAmSittingOut && round?.status !== 'resolved' && <>Du setzt diese Runde aus — nächste Runde bist du wieder dabei.</>}
          {!round && dealt && !readyPhase?.startedAt && <>Klick auf den Ring oder dein Bild, wenn du bereit für die nächste Runde bist.</>}
        </div>

        <div className="pb-deck">
          <div className="pb-center-control">
            <CenterControl
              ringMark={ringMark}
              ringLabel={ringLabel}
              progress={progress}
              frontState={frontState}
              flipped={flipped}
              revealTrailer={lastResolvedRound ? { title: lastResolvedRound.trailerTitle ?? '', year: lastResolvedRound.trailerYear ?? 0 } : null}
              onClick={canReadyNow ? () => handleSetReady(true) : () => undefined}
              wrapRef={(el) => (ringWrapRef.current = el)}
            />
            <div className="pb-deck-caption">{deckCaption || '30s Bereit-Fenster · 3s Countdown · 25s Trailer · 10s Einordnen'}</div>
          </div>

          <div className="pb-status-card">
            <div className="pb-status-row">
              <span>Letzter Trailer</span>
              <b>{lastResolvedRound ? `${lastResolvedRound.trailerTitle} (${lastResolvedRound.trailerYear})` : '—'}</b>
            </div>
            <div className="pb-status-row">
              <span>Karten</span>
              <b>{you?.timeline.length ?? 0}/{SLOT_COUNT}</b>
            </div>
          </div>
        </div>
      </div>

      <ExitModal open={exitOpen} karmaPenalty={karmaLeavePenalty(state.players.length)} onCancel={() => setExitOpen(false)} onConfirm={confirmExit} />
      <HelpModal open={helpOpen} onClose={() => setHelpOpen(false)} />

      {state.status === 'finished' &&
        revealUntil === null &&
        (() => {
          const winner = state.players.find((p) => p.userId === state.winnerUserId);
          const standings = [...state.players].sort((a, b) => b.timeline.length - a.timeline.length);
          const deadline = state.matchEndedAt ? new Date(state.matchEndedAt).getTime() + state.matchCloseWindowMs : null;
          const remainingS = deadline ? Math.max(0, Math.ceil((deadline - now) / 1000)) : null;

          return (
            <div className="pb-winner-overlay">
              <div className="pb-confetti" aria-hidden="true">
                {confettiPieces.map((p, i) => (
                  <span
                    key={i}
                    className="pb-confetto"
                    style={{
                      left: `${p.left}%`,
                      background: p.color,
                      animationDuration: `${p.duration}s`,
                      animationDelay: `${p.delay}s`,
                    }}
                  />
                ))}
              </div>
              <div className="pb-winner-card">
                <span className="pb-winner-crown" role="img" aria-label="Krone">
                  &#128081;
                </span>
                <div className="pb-winner-eyebrow">Partie beendet</div>
                <div className="pb-winner-name">{winner?.username ?? 'Unentschieden'} gewinnt!</div>
                <div className="pb-winner-sub">Erste:r mit 10 richtig platzierten Karten.</div>

                <ReactionBar phase="finished" reactions={state.reactionConfig.finished} sending={sendingReaction} onReact={handleReaction} />

                <ol className="pb-winner-standings">
                  {standings.map((p, i) => (
                    <li key={p.userId} className={`pb-winner-row${p.userId === you?.userId ? ' pb-winner-you' : ''}`}>
                      <span className="pb-winner-rank">#{i + 1}</span>
                      <span className="pb-winner-row-name">
                        {p.username}
                        {p.userId === state.winnerUserId ? ' 👑' : ''}
                      </span>
                      <span className="pb-winner-row-cards">{p.timeline.length}/10</span>
                    </li>
                  ))}
                </ol>

                <div className="pb-winner-actions">
                  <button className="pb-winner-restart" onClick={handleRestart} disabled={restarting}>
                    {restarting ? 'Startet neu…' : '🔁 Nochmal spielen'}
                  </button>
                  <button className="pb-winner-exit" onClick={handleExportPdf}>
                    📄 Als PDF speichern
                  </button>
                  {remainingS !== null && (
                    <div className="pb-winner-countdown">
                      Tisch schließt in <b>{remainingS}s</b>, falls niemand neu startet
                    </div>
                  )}
                  <button className="pb-winner-exit" onClick={() => navigate('/lobby')}>
                    Jetzt zur Lobby
                  </button>
                </div>
              </div>
            </div>
          );
        })()}
    </div>
  );
}
