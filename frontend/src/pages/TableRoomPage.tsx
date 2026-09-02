import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import './pages.css';
import { useAuth } from '../auth/AuthContext';
import { apiFetch, ApiError } from '../api';
import { getSocket } from '../realtime/socket';
import { QrCodeButton } from '../components/QrCodeButton';
import { ChatPanel } from '../components/ChatPanel';

interface Seat {
  userId: string;
  username: string;
  seatType: string;
  ready: boolean;
}

interface TableDetail {
  tableId: string;
  name: string;
  visibility: string;
  joinCode: string | null;
  allowSpectators: boolean;
  maxPlayers: number;
  maxSpectators: number;
  state: string;
  ownerUserId: string;
  activePlayers: number;
  activeSpectators: number;
  minKarmaPoints: number | null;
  minScorePoints: number | null;
  minGamesPlayed: number | null;
  lastActivityAt: string;
  seats: Seat[];
  latestGameId: string | null;
}

// H-01: safe to fetch before joining (no joinCode/seats/ownerUserId/
// latestGameId) - GET /tables/:tableId itself now requires an active seat,
// see backend/src/routes/tables.ts.
interface TablePreview {
  tableId: string;
  name: string;
  visibility: string;
  state: string;
  allowSpectators: boolean;
  maxPlayers: number;
  maxSpectators: number;
  activePlayers: number;
  activeSpectators: number;
  minKarmaPoints: number | null;
  minScorePoints: number | null;
  minGamesPlayed: number | null;
}

interface HostDevice {
  id: string;
  label: string;
  online: boolean;
}

// Mirrors services/tableActivity.ts's INACTIVITY_DELETE_MS/WARNING_MS -
// keep in sync.
const INACTIVITY_DELETE_MS = 60 * 60 * 1000;
const INACTIVITY_WARNING_MS = 59 * 60 * 1000;

export function TableRoomPage() {
  const { auth } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { tableId } = useParams<{ tableId: string }>();
  const [searchParams] = useSearchParams();
  const joinCodeFromLink = searchParams.get('code') ?? '';

  const [preview, setPreview] = useState<TablePreview | null>(null);
  const [table, setTable] = useState<TableDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [joining, setJoining] = useState(false);
  const [starting, setStarting] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [togglingReady, setTogglingReady] = useState(false);
  const [codeInput, setCodeInput] = useState(joinCodeFromLink);
  const [now, setNow] = useState(Date.now());
  const [keepingAlive, setKeepingAlive] = useState(false);
  const [creatingDisplayLink, setCreatingDisplayLink] = useState(false);
  const [displayLink, setDisplayLink] = useState<string | null>(null);
  const [hostDevices, setHostDevices] = useState<HostDevice[]>([]);
  const [attachingHostDevice, setAttachingHostDevice] = useState<string | null>(null);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 5000);
    return () => window.clearInterval(id);
  }, []);

  // H-01: the preview is safe to fetch before joining and is what powers
  // the "Beitreten" section below (name, capacity, requirements,
  // visibility) - it's the only thing available if this account has never
  // joined this table, since the full detail fetch right below now 404s
  // for non-members.
  useEffect(() => {
    if (!auth || !tableId) return;
    apiFetch<TablePreview>(`/tables/${tableId}/preview`, { token: auth.accessToken })
      .then(setPreview)
      .catch((err) => {
        if (err instanceof ApiError && err.status === 404) setNotFound(true);
        else setError('Tisch konnte nicht geladen werden.');
      });
  }, [auth, tableId]);

  // Full detail (seats, joinCode, latestGameId) only succeeds once this
  // account actually has an active seat here. A 403/404 here just means
  // "not a member yet" - the preview above already covers that case, so
  // there's nothing to surface as an error.
  useEffect(() => {
    if (!auth || !tableId) return;
    let cancelled = false;
    apiFetch<TableDetail>(`/tables/${tableId}`, { token: auth.accessToken })
      .then((detail) => {
        if (!cancelled) setTable(detail);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [auth, tableId]);

  const hasSeat = table !== null;

  // Only subscribe to the table's live-update room once REST has confirmed
  // membership (`table` is set) - joining earlier would just be denied by
  // the server now that room-joins are authorized the same way (H-02), and
  // silently doing nothing until then is simpler than reacting to that
  // denial in the UI.
  useEffect(() => {
    if (!auth || !tableId || !hasSeat) return;
    const socket = getSocket(auth.accessToken);
    socket.emit('table:join-room', tableId);
    // A dropped-and-restored socket (e.g. a flaky WLAN) starts a brand-new
    // server session with no room memberships - without rejoining on
    // 'connect', this page would silently stop receiving table:update
    // broadcasts until reloaded.
    const onReconnect = () => {
      socket.emit('table:join-room', tableId);
      apiFetch<TableDetail>(`/tables/${tableId}`, { token: auth.accessToken }).then(setTable).catch(() => undefined);
    };
    socket.on('connect', onReconnect);
    const onUpdate = (payload: TableDetail) => setTable(payload);
    socket.on('table:update', onUpdate);
    return () => {
      socket.off('connect', onReconnect);
      socket.off('table:update', onUpdate);
      socket.emit('table:leave-room', tableId);
    };
  }, [auth, tableId, hasSeat]);

  const mySeat = useMemo(() => table?.seats.find((s) => s.userId === auth?.user.id) ?? null, [table, auth]);
  const isOwner = table?.ownerUserId === auth?.user.id;
  const players = table?.seats.filter((s) => s.seatType === 'player') ?? [];
  const spectators = table?.seats.filter((s) => s.seatType === 'spectator') ?? [];

  useEffect(() => {
    if (!auth || !mySeat || !isOwner || table?.visibility !== 'private') return;
    apiFetch<{ devices: HostDevice[] }>('/host-devices/available', { token: auth.accessToken })
      .then((res) => setHostDevices(res.devices))
      .catch(() => {});
  }, [auth, mySeat, isOwner, table?.visibility]);

  // System-inactive-table cleanup (services/tableCleanup.ts): a table
  // nobody interacts with for an hour gets hard-deleted for performance
  // reasons. This shows a dismissible warning in the last minute of that
  // window - clicking it just re-touches activity, same as any other
  // interaction would, resetting the whole hour.
  const msSinceActivity = table ? now - new Date(table.lastActivityAt).getTime() : 0;
  const showInactivityWarning = Boolean(mySeat) && msSinceActivity >= INACTIVITY_WARNING_MS;
  const secondsUntilDeletion = Math.max(0, Math.ceil((INACTIVITY_DELETE_MS - msSinceActivity) / 1000));

  async function handleKeepAlive() {
    if (!auth || !tableId) return;
    setKeepingAlive(true);
    try {
      await apiFetch(`/tables/${tableId}/keep-alive`, { method: 'POST', token: auth.accessToken });
    } catch {
      setError('Konnte die Inaktivitäts-Uhr nicht zurücksetzen.');
    } finally {
      setKeepingAlive(false);
    }
  }

  // The table auto-starts the moment everyone's ready (or the admin force-
  // starts early) - nobody has to click anything else once that happens,
  // so just follow everyone straight into the live game.
  useEffect(() => {
    if (table?.state === 'running' && table.latestGameId) {
      navigate(`/spiel/${table.latestGameId}`);
    }
  }, [table?.state, table?.latestGameId, navigate]);

  async function handleJoin(joinAs: 'player' | 'spectator') {
    if (!auth || !tableId) return;
    setJoining(true);
    setError(null);
    try {
      await apiFetch(`/tables/${tableId}/join`, {
        method: 'POST',
        body: { joinAs, joinCode: preview?.visibility === 'private' ? codeInput : undefined },
        token: auth.accessToken,
      });
      const fresh = await apiFetch<TableDetail>(`/tables/${tableId}`, { token: auth.accessToken });
      setTable(fresh);
    } catch (err) {
      setError(describeJoinError(err));
    } finally {
      setJoining(false);
    }
  }

  async function handleToggleReady() {
    if (!auth || !tableId || !mySeat) return;
    setTogglingReady(true);
    setError(null);
    try {
      await apiFetch(`/tables/${tableId}/ready`, { method: 'POST', body: { ready: !mySeat.ready }, token: auth.accessToken });
    } catch {
      setError('Bereit-Status konnte nicht gesetzt werden.');
    } finally {
      setTogglingReady(false);
    }
  }

  async function handleStart() {
    if (!auth || !tableId) return;
    setStarting(true);
    setError(null);
    try {
      await apiFetch(`/tables/${tableId}/start`, { method: 'POST', token: auth.accessToken });
    } catch (err) {
      if (err instanceof ApiError) {
        const body = err.body as { error?: string } | null;
        setError(body?.error ?? 'Start fehlgeschlagen.');
      } else {
        setError('Start fehlgeschlagen.');
      }
    } finally {
      setStarting(false);
    }
  }

  // Hostmodus (gemeinsames Anzeigegerät): only the owner of a private table
  // can mint a link for the shared screen (see POST /tables/:tableId/display-link) -
  // matches the backend restriction in tables.ts.
  async function handleCreateDisplayLink() {
    if (!auth || !tableId) return;
    setCreatingDisplayLink(true);
    setError(null);
    try {
      const result = await apiFetch<{ displayToken: string }>(`/tables/${tableId}/display-link`, {
        method: 'POST',
        token: auth.accessToken,
      });
      setDisplayLink(`${window.location.origin}/display/${result.displayToken}`);
    } catch {
      setError('Anzeige-Link konnte nicht erzeugt werden.');
    } finally {
      setCreatingDisplayLink(false);
    }
  }

  async function handleAttachHostDevice(deviceId: string) {
    if (!auth || !tableId) return;
    setAttachingHostDevice(deviceId);
    setError(null);
    try {
      await apiFetch(`/tables/${tableId}/host-device`, {
        method: 'POST',
        body: { deviceId },
        token: auth.accessToken,
      });
      setError(null);
    } catch {
      setError('Host-App konnte nicht an diesen Tisch gesetzt werden.');
    } finally {
      setAttachingHostDevice(null);
    }
  }

  async function handleLeave() {
    if (!auth || !tableId) return;
    setLeaving(true);
    try {
      await apiFetch(`/tables/${tableId}/leave`, { method: 'POST', token: auth.accessToken });
      navigate('/lobby');
    } catch {
      setError('Verlassen fehlgeschlagen.');
      setLeaving(false);
    }
  }

  if (!auth) {
    return (
      <div className="app-shell">
        <div className="sh-card">
          <p>
            Bitte zuerst{' '}
            <Link to="/login" state={{ next: location.pathname + location.search }}>
              anmelden
            </Link>
            .
          </p>
        </div>
      </div>
    );
  }
  if (notFound) {
    return (
      <div className="app-shell">
        <div className="sh-card">
          <p>Diesen Tisch gibt es nicht (mehr).</p>
          <Link to="/lobby">Zurück zur Lobby</Link>
        </div>
      </div>
    );
  }
  if (!preview) {
    return (
      <div className="app-shell">
        <div className="sh-card">
          <p>Lade…</p>
        </div>
      </div>
    );
  }

  const shareLink =
    table && table.visibility === 'private' && table.joinCode
      ? `${window.location.origin}/tisch/${table.tableId}?code=${table.joinCode}`
      : null;
  const browserHostLink = `${window.location.origin}/host`;

  return (
    <div className="app-shell">
      <div className="sh-card admin-shell" style={{ maxWidth: 640 }}>
        <Link className="sh-back" to="/lobby">
          &larr; Zurück zur Lobby
        </Link>
        <h2>{table?.name ?? preview.name}</h2>

        {error && <div className="sh-error" style={{ marginBottom: 14 }}>{error}</div>}

        {showInactivityWarning && (
          <div className="sh-error" style={{ marginBottom: 14, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <span>
              Dieser Tisch war lange inaktiv und wird in {Math.floor(secondsUntilDeletion / 60)}:
              {String(secondsUntilDeletion % 60).padStart(2, '0')} min automatisch geschlossen.
            </span>
            <button className="admin-btn-sm" disabled={keepingAlive} onClick={handleKeepAlive}>
              Ich bin noch da
            </button>
          </div>
        )}

        {shareLink && isOwner && (
          <div className="sh-info" style={{ marginBottom: 16, wordBreak: 'break-all' }}>
            <div>
              Einladungslink: <code>{shareLink}</code>
            </div>
            <div style={{ marginTop: 8 }}>
              <QrCodeButton value={shareLink} label="Einladungs-QR-Code anzeigen" />
            </div>
          </div>
        )}

        {mySeat && table && table.state === 'open' && isOwner && table.visibility === 'private' && (
          <div className="sh-info" style={{ marginBottom: 16 }}>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>Hostmodus: Anzeigegerät</div>
            <p style={{ fontSize: 13, color: 'var(--sh-text-faint)', margin: '0 0 8px' }}>
              Öffne <code>{browserHostLink}</code> auf Fernseher, iPad oder Tablet. Dort erscheint ein QR-Code zur
              Bestätigung; danach kannst du das Gerät hier direkt als Hostanzeige verwenden.
            </p>
            <div style={{ marginBottom: 10 }}>
              <QrCodeButton value={browserHostLink} label="Browser-Host-QR anzeigen" />
            </div>
            {!displayLink ? (
              <button className="admin-btn-sm" disabled={creatingDisplayLink} onClick={handleCreateDisplayLink}>
                {creatingDisplayLink ? 'Erzeugt…' : 'Direkten Anzeige-Link erzeugen'}
              </button>
            ) : (
              <div style={{ wordBreak: 'break-all' }}>
                <code>{displayLink}</code>
                <div style={{ marginTop: 8 }}>
                  <QrCodeButton value={displayLink} label="Anzeige-QR-Code anzeigen" />
                </div>
              </div>
            )}
            {hostDevices.length > 0 && (
              <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ fontSize: 13, color: 'var(--sh-text-faint)' }}>Oder direkt an eine verbundene Host-App senden:</div>
                {hostDevices.map((device) => (
                  <button
                    key={device.id}
                    className="admin-btn-sm"
                    disabled={attachingHostDevice !== null}
                    onClick={() => handleAttachHostDevice(device.id)}
                  >
                    {attachingHostDevice === device.id ? 'Sendet…' : `${device.label} verwenden`}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {!mySeat && (
          <section className="admin-section">
            <h3>Beitreten</h3>
            {(() => {
              const requirements = [
                preview.minKarmaPoints !== null ? `Karma ≥ ${preview.minKarmaPoints}` : null,
                preview.minScorePoints !== null ? `Punkte ≥ ${preview.minScorePoints}` : null,
                preview.minGamesPlayed !== null ? `Spiele ≥ ${preview.minGamesPlayed}` : null,
              ].filter((r): r is string => r !== null);
              return (
                requirements.length > 0 && (
                  <p style={{ fontSize: 12, color: 'var(--sh-text-faint)', marginBottom: 10 }}>
                    Anforderungen für Spieler: {requirements.join(', ')}
                  </p>
                )
              );
            })()}
            {preview.visibility === 'private' && (
              <div className="sh-field" style={{ marginBottom: 10, maxWidth: 220 }}>
                <label htmlFor="joinCode">Tischcode</label>
                <input id="joinCode" value={codeInput} onChange={(e) => setCodeInput(e.target.value)} />
              </div>
            )}
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="admin-btn-sm" disabled={joining || preview.activePlayers >= preview.maxPlayers} onClick={() => handleJoin('player')}>
                Als Spieler beitreten
              </button>
              {preview.allowSpectators && (
                <button
                  className="admin-btn-sm"
                  disabled={joining || preview.activeSpectators >= preview.maxSpectators}
                  onClick={() => handleJoin('spectator')}
                >
                  Als Zuschauer beitreten
                </button>
              )}
            </div>
          </section>
        )}

        {mySeat && table && (
          <>
            <section className="admin-section">
              <h3>
                Spieler ({players.length}/{table.maxPlayers})
              </h3>
              <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
                {players.map((p) => (
                  <li
                    key={p.userId}
                    style={{
                      fontSize: 14,
                      color: 'var(--sh-text-dim)',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                    }}
                  >
                    <span className={`admin-pill${p.ready ? '' : ' warn'}`}>{p.ready ? 'bereit' : 'nicht bereit'}</span>
                    {p.username}
                    {p.userId === table.ownerUserId ? ' (Admin)' : ''}
                  </li>
                ))}
              </ul>
              {table.state === 'open' && mySeat?.seatType === 'player' && (
                <button className="admin-btn-sm" style={{ marginTop: 10 }} disabled={togglingReady} onClick={handleToggleReady}>
                  {mySeat.ready ? 'Nicht mehr bereit' : 'Bereit melden'}
                </button>
              )}
            </section>

            {table.allowSpectators && (
              <section className="admin-section">
                <h3>
                  Zuschauer ({spectators.length}/{table.maxSpectators})
                </h3>
                <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {spectators.map((p) => (
                    <li key={p.userId} style={{ fontSize: 14, color: 'var(--sh-text-dim)' }}>
                      {p.username}
                    </li>
                  ))}
                  {spectators.length === 0 && <li style={{ fontSize: 13, color: 'var(--sh-text-faint)' }}>Niemand.</li>}
                </ul>
              </section>
            )}

            <ChatPanel
              title="Tisch-Chat"
              scope="table"
              tableId={table.tableId}
              endpoint={`/tables/${table.tableId}/messages`}
              hint="Nur für Spieler und Zuschauer an diesem Tisch."
            />

            {table.state === 'open' && (() => {
              const allReady = players.length >= 2 && players.every((p) => p.ready);
              const atCapacity = players.length === table.maxPlayers;
              return (
                <>
                  {isOwner && (
                    <button
                      className="sh-submit"
                      disabled={starting || players.length < 2 || !allReady}
                      onClick={handleStart}
                    >
                      {starting
                        ? 'Startet…'
                        : players.length < 2
                          ? 'Mind. 2 Spieler nötig'
                          : !allReady
                            ? 'Warte, bis alle bereit sind'
                            : 'Jetzt starten'}
                    </button>
                  )}
                  {!isOwner && (
                    <p style={{ fontSize: 13, color: 'var(--sh-text-faint)' }}>
                      {allReady
                        ? atCapacity
                          ? 'Alle bereit — Spiel startet…'
                          : 'Alle bereit — wartet auf den Tisch-Admin oder mehr Spieler.'
                        : 'Warte, bis alle Spieler bereit sind.'}
                    </p>
                  )}
                </>
              );
            })()}

            <button
              className="admin-btn-sm"
              style={{ marginTop: 16 }}
              disabled={leaving}
              onClick={handleLeave}
            >
              Tisch verlassen
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function describeJoinError(err: unknown): string {
  if (err instanceof ApiError) {
    const body = err.body as { error?: string } | null;
    if (body?.error === 'TABLE_JOIN_CODE_INVALID') return 'Tischcode ist falsch.';
    if (body?.error === 'TABLE_FULL') return 'Tisch ist voll.';
    if (body?.error === 'TABLE_NOT_JOINABLE') return 'Diesem Tisch kann gerade nicht beigetreten werden.';
    if (body?.error === 'PLAYER_REQUIREMENTS_NOT_MET') {
      return 'Du erfüllst die Mindestanforderungen für Spieler nicht - Beitritt als Zuschauer ist möglich.';
    }
    return body?.error ?? 'Beitritt fehlgeschlagen.';
  }
  return 'Backend nicht erreichbar.';
}
