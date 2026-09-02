import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { io, Socket } from 'socket.io-client';
import QRCode from 'qrcode';
import '../playboard/Playboard.css';
import './pages.css';
import { apiFetch, ApiError, API_BASE_URL } from '../api';
import { useWakeLock } from '../hooks/useWakeLock';
import { CurrentRoundState, GameState } from '../game/types';
import { embedTimeline, packedIndexToBoxIndex, SLOT_COUNT } from '../game/timelineSlots';
import { placeAt } from '../playboard/gameLogic';
import { PlayerRow } from '../playboard/PlayerRow';
import { CenterControl } from '../playboard/CenterControl';
import { PendingResult, PlayerState } from '../playboard/types';
import { GameReactionEvent, ReactionConfig } from '../game/reactions';
import { keepNewestGameState } from '../game/stateOrdering';
import { describeAudioElement, flushClientDebugEvents, logClientEvent, snapshotClientDebugContext } from '../debugLogging';

interface DisplayTableDetail {
  tableId: string;
  name: string;
  visibility: string;
  joinCode: string | null;
  state: string;
  latestGameId: string | null;
}

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}

/*
 * Hostmodus (gemeinsames Anzeigegerät): a read-only shared-screen view of
 * the Playboard, reached via a display token instead of a normal login (see
 * backend/src/services/displayToken.ts) - there is no `you`, no ready
 * toggle, no guess submission here, just the same PlayerRow/CenterControl
 * components LiveGameBoard uses, fed with everything hidden that would
 * require a per-user identity. This is the device that actually plays the
 * trailer video for everyone at the table - every player's own phone stays
 * muted while a display anchor is connected (see LiveGameBoard's `compact`
 * mode).
 */
export function DisplayPage({ displayToken }: { displayToken?: string }) {
  const { token: routeToken } = useParams<{ token: string }>();
  const token = displayToken ?? routeToken;

  const [table, setTable] = useState<DisplayTableDetail | null>(null);
  const [state, setState] = useState<GameState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [videoMuted, setVideoMuted] = useState(false);
  const [revealUntil, setRevealUntil] = useState<number | null>(null);
  const [lastResolvedRound, setLastResolvedRound] = useState<CurrentRoundState | null>(null);
  const [reactionsByUser, setReactionsByUser] = useState<Record<string, GameReactionEvent>>({});

  const socketRef = useRef<Socket | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const reactionTimersRef = useRef<Map<string, number>>(new Map());

  function debugRoundPayload(extra: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      clientKind: 'display',
      tableId: state?.tableId ?? table?.tableId ?? null,
      gameId: state?.gameId ?? table?.latestGameId ?? null,
      roundId: state?.currentRound?.roundId ?? null,
      roundIndex: state?.currentRound?.indexNo ?? null,
      roundStatus: state?.currentRound?.status ?? null,
      videoMuted,
      ...extra,
    };
  }

  // A dedicated socket, deliberately not the shared getSocket() singleton
  // from realtime/socket.ts - that one is keyed to a logged-in player's
  // token, and this page authenticates as a display, never a player.
  useEffect(() => {
    if (!token) return;
    const socket = io({ auth: { token }, transports: ['websocket', 'polling'] });
    socketRef.current = socket;
    socket.on('connect', () => {
      logClientEvent({ eventType: 'socket_connect', clientKind: 'display', payload: debugRoundPayload({ socketId: socket.id }) });
    });
    socket.on('disconnect', (reason) => {
      logClientEvent({ eventType: 'socket_disconnect', clientKind: 'display', payload: debugRoundPayload({ reason }) });
      void flushClientDebugEvents();
    });
    socket.on('connect_error', (err) => {
      logClientEvent({ eventType: 'socket_connect_error', clientKind: 'display', payload: debugRoundPayload({ message: err.message }) });
      void flushClientDebugEvents(true);
    });
    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => {
    if (!token) return;
    apiFetch<DisplayTableDetail>(`/tables/display/${token}`)
      .then((payload) => {
        logClientEvent({
          eventType: 'display_table_loaded',
          clientKind: 'display',
          tableId: payload.tableId,
          payload: { state: payload.state, latestGameId: payload.latestGameId },
        });
        setTable(payload);
      })
      .catch((err) => {
        if (err instanceof ApiError && (err.status === 401 || err.status === 404)) setNotFound(true);
        else setError('Tisch konnte nicht geladen werden.');
      });
  }, [token]);

  const tableId = table?.tableId ?? null;
  useEffect(() => {
    const socket = socketRef.current;
    if (!socket || !tableId) return;
    socket.emit('table:join-room', tableId);
    const onReconnect = () => {
      logClientEvent({ eventType: 'socket_table_rejoin_after_reconnect', clientKind: 'display', tableId, payload: debugRoundPayload({ socketId: socket.id }) });
      socket.emit('table:join-room', tableId);
    };
    socket.on('connect', onReconnect);
    const onTableUpdate = (payload: DisplayTableDetail) => {
      logClientEvent({
        eventType: 'table_update_received',
        clientKind: 'display',
        tableId: payload.tableId,
        payload: { state: payload.state, latestGameId: payload.latestGameId },
      });
      setTable(payload);
    };
    socket.on('table:update', onTableUpdate);
    return () => {
      socket.off('connect', onReconnect);
      socket.off('table:update', onTableUpdate);
      socket.emit('table:leave-room', tableId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tableId]);

  const gameId = table?.latestGameId ?? null;
  useEffect(() => {
    if (!token || !gameId) {
      setState(null);
      return;
    }
    apiFetch<GameState>(`/games/display/${token}/${gameId}`)
      .then((payload) => {
        logClientEvent({
          eventType: 'game_state_initial_loaded',
          clientKind: 'display',
          tableId: payload.tableId,
          gameId: payload.gameId,
          roundId: payload.currentRound?.roundId ?? null,
          roundIndex: payload.currentRound?.indexNo ?? null,
          payload: {
            status: payload.currentRound?.status ?? null,
            playerCount: payload.players.length,
          },
        });
        setState(payload);
      })
      .catch(() => setError('Spielstand konnte nicht geladen werden.'));

    const socket = socketRef.current;
    if (!socket) return;
    const reactionTimers = reactionTimersRef.current;
    socket.emit('game:join-room', gameId);
    const onReconnect = () => {
      logClientEvent({ eventType: 'socket_game_rejoin_after_reconnect', clientKind: 'display', tableId, gameId, payload: debugRoundPayload({ socketId: socket.id }) });
      socket.emit('game:join-room', gameId);
      apiFetch<GameState>(`/games/display/${token}/${gameId}`)
        .then((payload) => setState((current) => keepNewestGameState(current, payload)))
        .catch(() => undefined);
    };
    socket.on('connect', onReconnect);
    const onGameUpdate = (payload: GameState) => {
      logClientEvent({
        eventType: 'game_update_received',
        clientKind: 'display',
        tableId: payload.tableId,
        gameId: payload.gameId,
        roundId: payload.currentRound?.roundId ?? null,
        roundIndex: payload.currentRound?.indexNo ?? null,
        payload: {
          status: payload.currentRound?.status ?? null,
          playerCount: payload.players.length,
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
    socket.on('game:update', onGameUpdate);
    socket.on('game:reaction', onReaction);
    socket.on('communication:config-updated', onConfigUpdate);
    return () => {
      socket.off('connect', onReconnect);
      socket.off('game:update', onGameUpdate);
      socket.off('game:reaction', onReaction);
      socket.off('communication:config-updated', onConfigUpdate);
      socket.emit('game:leave-room', gameId);
      for (const timer of reactionTimers.values()) window.clearTimeout(timer);
      reactionTimers.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, gameId]);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 200);
    return () => window.clearInterval(id);
  }, []);

  useWakeLock(true);

  const round = state?.currentRound ?? null;
  const roundId = round?.roundId;
  const trailerStreamPath = round?.trailerStreamPath;
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (!trailerStreamPath) {
      video.removeAttribute('src');
      video.load();
      return;
    }
    video.src = `${API_BASE_URL}${trailerStreamPath}`;
    video.load();
    logClientEvent({
      eventType: 'video_load_start',
      clientKind: 'display',
      tableId: state?.tableId ?? table?.tableId ?? null,
      gameId,
      roundId,
      roundIndex: round?.indexNo ?? null,
      payload: debugRoundPayload({ trailerStreamPath, video: describeAudioElement(video) }),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roundId]);

  const roundStatus = round?.status;
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
            clientKind: 'display',
            tableId: state?.tableId ?? table?.tableId ?? null,
            gameId,
            roundId,
            roundIndex: round?.indexNo ?? null,
            payload: debugRoundPayload({ video: describeAudioElement(video) }),
          });
        })
        .catch((err) => {
          logClientEvent({
            eventType: 'video_play_rejected',
            clientKind: 'display',
            tableId: state?.tableId ?? table?.tableId ?? null,
            gameId,
            roundId,
            roundIndex: round?.indexNo ?? null,
            payload: snapshotClientDebugContext(
              debugRoundPayload({ errorName: err.name, errorMessage: err.message, video: describeAudioElement(video) }),
            ),
          });
          void flushClientDebugEvents(true);
        });
    } else {
      video.pause();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roundStatus, roundId]);

  // Remembers the last resolved round's trailer, and holds the ring flipped
  // to the reveal face for a fixed 5s once a round resolves - keyed on
  // wall-clock time rather than round.status === 'resolved', since a fully
  // auto-ready table auto-starts the next round the instant this one
  // resolves. Mirrors LiveGameBoard.tsx.
  useEffect(() => {
    if (roundStatus !== 'resolved' || !roundId || !round) return;
    setLastResolvedRound((prev) => (prev?.roundId === roundId ? prev : round));
    setRevealUntil((prev) => (prev !== null ? prev : Date.now() + 5000));
  }, [roundStatus, roundId, round]);

  useEffect(() => {
    if (revealUntil === null || !lastResolvedRound || round?.indexNo == null) return;
    if (round.indexNo <= lastResolvedRound.indexNo) return;
    if (round.status === 'countdown') return;
    setRevealUntil(null);
  }, [revealUntil, lastResolvedRound, round?.indexNo, round?.status]);

  useEffect(() => {
    if (revealUntil === null || now < revealUntil) return;
    setRevealUntil(null);
  }, [revealUntil, now]);

  const maxScore = useMemo(() => Math.max(0, ...(state?.players.map((p) => p.timeline.length) ?? [0])), [state]);
  const rankMap = useMemo(() => {
    const map: Record<string, number> = {};
    for (const p of state?.players ?? []) map[p.userId] = p.globalRank;
    return map;
  }, [state]);

  const shareLink =
    table && table.visibility === 'private' && table.joinCode
      ? `${window.location.origin}/tisch/${table.tableId}?code=${table.joinCode}`
      : table
        ? `${window.location.origin}/tisch/${table.tableId}`
        : null;

  if (notFound) {
    return (
      <div className="app-shell">
        <div className="sh-card">
          <p>Dieser Anzeige-Link ist ungültig oder abgelaufen.</p>
        </div>
      </div>
    );
  }
  if (!table) {
    return (
      <div className="app-shell">
        <div className="sh-card">
          <p>Lade…</p>
        </div>
      </div>
    );
  }

  // Zwischen Partien: keine laufende Partie - zeigt den Beitritts-QR-Code
  // gross, damit alle vor diesem Bildschirm direkt scannen koennen.
  if (!state || table.state !== 'running') {
    return (
      <div className="app-shell">
        <div className="sh-card" style={{ maxWidth: 480, textAlign: 'center' }}>
          <h2>{table.name}</h2>
          <p style={{ color: 'var(--sh-text-dim)' }}>Mit dem Handy hier beitreten:</p>
          {shareLink && (
            <div style={{ display: 'flex', justifyContent: 'center' }}>
              <QrCodeButtonAlwaysOpen value={shareLink} />
            </div>
          )}
          {error && <div className="sh-error" style={{ marginTop: 14 }}>{error}</div>}
        </div>
      </div>
    );
  }

  let ringMark = '?';
  let ringLabel = 'Bereit?';
  let progress = 0;
  let frontState: '' | 'pb-counting' | 'pb-playing' = '';
  let flipped = false;
  let phaseLabel = 'Bereit für nächste Runde';

  if (revealUntil !== null && now < revealUntil) {
    flipped = true;
    phaseLabel = 'Auflösung';
  } else if (state.roundReadyPhase) {
    const readyPhase = state.roundReadyPhase;
    if (readyPhase.startedAt) {
      const remaining = Math.max(0, readyPhase.windowMs - (now - new Date(readyPhase.startedAt).getTime()));
      ringMark = String(Math.ceil(remaining / 1000));
      progress = clamp01(1 - remaining / readyPhase.windowMs);
      ringLabel = 'Warte…';
      frontState = 'pb-counting';
      phaseLabel = 'Warte auf Mitspieler';
    }
  } else if (round) {
    if (round.status === 'playing') {
      const elapsed = now - new Date(round.startedAt).getTime() - round.countdownMs;
      const remaining = Math.max(0, round.trailerMs - elapsed);
      ringMark = '🎬';
      ringLabel = 'läuft';
      progress = clamp01(elapsed / round.trailerMs);
      frontState = 'pb-playing';
      phaseLabel = `Trailer läuft · ${Math.ceil(remaining / 1000)}s`;
    } else if (round.status === 'guessing') {
      const elapsed = now - new Date(round.startedAt).getTime() - round.countdownMs - round.trailerMs;
      const remaining = Math.max(0, round.guessWindowMs - elapsed);
      ringMark = String(Math.ceil(remaining / 1000) || 1);
      ringLabel = 'einordnen!';
      progress = clamp01(elapsed / round.guessWindowMs);
      frontState = 'pb-counting';
      phaseLabel = `Zeitleiste einordnen · ${Math.ceil(remaining / 1000)}s`;
    }
  }

  return (
    <div className="playboard">
      <div className="pb-app">
        <div className="pb-topbar">
          <div className="pb-brand">
            <button
              className="pb-icon-btn"
              title={videoMuted ? 'Ton einschalten' : 'Ton ausschalten'}
              aria-label="Ton ein/aus"
              onClick={() => setVideoMuted((m) => !m)}
            >
              {videoMuted ? '🔇' : '🔊'}
            </button>
            <div className="pb-brand-mark">B</div>
            <div>
              <div className="pb-brand-title">blöki</div>
              <div className="pb-brand-sub">Anzeigegerät</div>
            </div>
            {state && (
              <div className="pb-brand-ids" title={`Tisch-ID: ${state.tableId}`}>
                <span>Tisch {state.tableId.slice(0, 8)}</span>
              </div>
            )}
          </div>
          <div className="pb-round-pill">
            <span className="pb-round-dot" />
            &nbsp;Runde <b>{round?.indexNo ?? '—'}</b> &middot; <span>{phaseLabel}</span>
          </div>
        </div>

        <video
          ref={videoRef}
          preload="auto"
          muted={videoMuted}
          playsInline
          style={{ width: round?.status === 'playing' ? '100%' : 0, height: round?.status === 'playing' ? 'auto' : 0 }}
          onError={() => void flushClientDebugEvents(true)}
        />

        {error && (
          <div className="sh-error" style={{ marginBottom: 4 }}>
            {error}
          </div>
        )}

        <div className="pb-board">
          {state.players.map((p) => {
            const sittingOut = round?.sitOutUserIds.includes(p.userId) ?? false;
            let slots: (number | null)[];
            let pendingSlot: number | null = null;
            let pendingResult: PendingResult = null;

            if (revealUntil !== null && now < revealUntil) {
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
            } else {
              slots = embedTimeline(p.timeline);
            }

            const playerState: PlayerState = {
              id: p.userId,
              name: p.username,
              you: false,
              initials: p.username.slice(0, 2).toUpperCase(),
              slots,
              roundStartSlots: null,
              pendingSlot,
              pendingResult,
              scorePoints: p.scorePoints,
              karma: p.karmaPoints,
              ready: state.roundReadyPhase?.readyUserIds.includes(p.userId) ?? false,
              autoReady: state.autoReadyUserIds.includes(p.userId),
              sittingOut,
            };

            return (
              <PlayerRow
                key={p.userId}
                player={playerState}
                isLeader={p.timeline.length === maxScore && maxScore > 0}
                rank={rankMap[p.userId]}
                canReady={false}
                onToggleReady={() => undefined}
                currentTrailerYear={round?.trailerYear ?? null}
                reaction={reactionsByUser[p.userId]
                  ? { emoji: reactionsByUser[p.userId].symbol, label: reactionsByUser[p.userId].label }
                  : undefined}
              />
            );
          })}
        </div>

        <div className="pb-deck">
          <div className="pb-center-control">
            <CenterControl
              ringMark={ringMark}
              ringLabel={ringLabel}
              progress={progress}
              frontState={frontState}
              flipped={flipped}
              revealTrailer={
                lastResolvedRound
                  ? { title: lastResolvedRound.trailerTitle ?? '', year: lastResolvedRound.trailerYear ?? 0 }
                  : null
              }
              onClick={() => undefined}
            />
          </div>
          <div className="pb-status-card">
            <div className="pb-status-row">
              <span>Letzter Trailer</span>
              <b>{lastResolvedRound ? `${lastResolvedRound.trailerTitle} (${lastResolvedRound.trailerYear})` : '—'}</b>
            </div>
            <div className="pb-status-row">
              <span>Karten</span>
              <b>bis {SLOT_COUNT}/{SLOT_COUNT}</b>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// The idle/waiting screen always shows the join QR straight away, no toggle
// needed - unlike QrCodeButton's default click-to-reveal (used in the table
// room, where showing it isn't always wanted).
function QrCodeButtonAlwaysOpen({ value }: { value: string }) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(value, { margin: 1, width: 320 }).then((url) => {
      if (!cancelled) setDataUrl(url);
    });
    return () => {
      cancelled = true;
    };
  }, [value]);
  if (!dataUrl) return null;
  return <img src={dataUrl} alt="Beitritts-QR-Code" width={320} height={320} style={{ borderRadius: 8 }} />;
}
