import { FormEvent, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import './pages.css';
import { useAuth } from '../auth/AuthContext';
import { apiFetch, ApiError } from '../api';
import { InvitesSection } from './InvitesSection';
import { CollapsibleSection } from './CollapsibleSection';
import { CommunicationSettingsSection } from './CommunicationSettingsSection';

interface AdminUser {
  userId: string;
  username: string;
  email: string;
  role: 'user' | 'admin';
  status: 'active' | 'blocked';
  canCreateInvites: boolean;
  karmaPoints: number;
  scorePoints: number;
  createdAt: string;
  mustChangePassword: boolean;
  passwordResetRequestedAt: string | null;
  isSuperAdmin: boolean;
}

export function AdminPage() {
  const { auth } = useAuth();
  const token = auth?.accessToken;

  if (!auth) {
    return (
      <div className="app-shell">
        <div className="sh-card">
          <p>
            Bitte zuerst <Link to="/login">anmelden</Link>.
          </p>
        </div>
      </div>
    );
  }
  if (auth.user.role !== 'admin') {
    return (
      <div className="app-shell">
        <div className="sh-card">
          <p>Dieser Bereich ist nur für Admins.</p>
          <Link to="/">Zurück zur Startseite</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <div className="sh-card admin-shell" style={{ maxWidth: 880 }}>
        <Link className="sh-back" to="/">
          &larr; Zurück
        </Link>
        <h2>Admin-Bereich</h2>

        <CollapsibleSection title="Trailer-Bibliothek">
          <TrailersSection token={token as string} />
        </CollapsibleSection>
        <CollapsibleSection title="Trailer-Playlist-Suche">
          <TrailerPlaylistsSection token={token as string} />
        </CollapsibleSection>
        <CollapsibleSection title="Chateinstellungen">
          <CommunicationSettingsSection token={token as string} />
        </CollapsibleSection>
        <CollapsibleSection title="Einladungen">
          <InvitesSection token={token as string} isAdmin collapsible />
        </CollapsibleSection>
        <CollapsibleSection title="Tische">
          <TablesSection token={token as string} />
        </CollapsibleSection>
        <CollapsibleSection title="Nutzer">
          <UsersSection token={token as string} />
        </CollapsibleSection>
        <CollapsibleSection title="Debug">
          <DebugSection token={token as string} />
        </CollapsibleSection>
      </div>
    </div>
  );
}

interface DebugSettings {
  enabled: boolean;
  captureId: string | null;
  enabledAt: string | null;
  retentionDays: number;
}

interface DebugTableResult {
  tableId: string;
  tableName: string;
  isSolo: boolean;
  gameCount: number;
  lastEventAt: string;
}

interface DebugGameResult {
  captureId: string;
  gameId: string;
  tableId: string;
  tableName: string;
  isSolo: boolean;
  gameStartedAt: string;
  lastEventAt: string;
  captureDisabledAt: string | null;
  expiresAt: string | null;
  serverEventCount: number;
  clientEventCount: number;
}

function DebugSection({ token }: { token: string }) {
  const [settings, setSettings] = useState<DebugSettings | null>(null);
  const [query, setQuery] = useState('');
  const [tables, setTables] = useState<DebugTableResult[]>([]);
  const [selectedTable, setSelectedTable] = useState<DebugTableResult | null>(null);
  const [games, setGames] = useState<DebugGameResult[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<DebugSettings>('/admin/debug/settings', { token })
      .then(setSettings)
      .catch(() => setError('Debug-Einstellungen konnten nicht geladen werden.'));
  }, [token]);

  async function toggleLogging() {
    if (!settings) return;
    setBusy(true);
    setError(null);
    try {
      setSettings(await apiFetch<DebugSettings>('/admin/debug/settings', {
        method: 'PUT',
        body: { enabled: !settings.enabled },
        token,
      }));
    } catch {
      setError('Erweitertes Logging konnte nicht umgeschaltet werden.');
    } finally {
      setBusy(false);
    }
  }

  async function search(event: FormEvent) {
    event.preventDefault();
    const value = query.trim();
    if (value.length < 2) return;
    setBusy(true);
    setError(null);
    setSelectedTable(null);
    setGames([]);
    try {
      const result = await apiFetch<{ tables: DebugTableResult[] }>(
        `/admin/debug/tables?query=${encodeURIComponent(value)}`,
        { token },
      );
      setTables(result.tables);
    } catch {
      setError('Tischsuche fehlgeschlagen.');
    } finally {
      setBusy(false);
    }
  }

  async function selectTable(table: DebugTableResult) {
    setSelectedTable(table);
    setBusy(true);
    setError(null);
    try {
      const result = await apiFetch<{ games: DebugGameResult[] }>(
        `/admin/debug/tables/${table.tableId}/games`,
        { token },
      );
      setGames(result.games);
    } catch {
      setError('Spiele für diesen Tisch konnten nicht geladen werden.');
    } finally {
      setBusy(false);
    }
  }

  async function downloadGame(game: DebugGameResult) {
    setBusy(true);
    setError(null);
    try {
      const data = await apiFetch<Record<string, unknown>>(
        `/admin/debug/captures/${game.captureId}/games/${game.gameId}`,
        { token },
      );
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `bloeki-debug-${game.gameId}.json`;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch {
      setError('Debug-Datei konnte nicht heruntergeladen werden.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <p style={{ fontSize: 13, color: 'var(--sh-text-dim)', marginBottom: 12 }}>
        Zeichnet Runden-, Trailer-Cache-, Stream-, Socket- und Player-Ereignisse tisch- und spielbezogen auf.
        Nach dem Abschalten bleiben die Aufzeichnungen noch sieben Tage abrufbar.
      </p>
      {settings && (
        <div className={settings.enabled ? 'sh-info' : 'admin-debug-off'} style={{ marginBottom: 14 }}>
          <strong>{settings.enabled ? 'Erweitertes Logging ist aktiv.' : 'Erweitertes Logging ist ausgeschaltet.'}</strong>
          {settings.enabledAt && <span> Seit {formatDateTime(settings.enabledAt)}</span>}
          <button className="admin-btn-sm" type="button" disabled={busy} onClick={toggleLogging} style={{ marginLeft: 12 }}>
            {settings.enabled ? 'Logging abschalten' : 'Logging einschalten'}
          </button>
        </div>
      )}
      {error && <div className="sh-error" style={{ marginBottom: 12 }}>{error}</div>}
      <form className="admin-inline-form" onSubmit={search}>
        <input
          className="admin-search-input"
          placeholder="Tischname oder Tisch-ID eingeben…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          style={{ marginBottom: 0, flex: 1 }}
        />
        <button className="admin-btn-sm" type="submit" disabled={busy || query.trim().length < 2}>Suchen</button>
      </form>
      {tables.length > 0 && (
        <div className="admin-table-wrap" style={{ marginBottom: 14 }}>
          <table className="admin-table">
            <thead><tr><th>Tisch</th><th>Modus</th><th>Spiele</th><th>Letztes Ereignis</th><th></th></tr></thead>
            <tbody>{tables.map((table) => (
              <tr key={table.tableId}>
                <td><strong>{table.tableName}</strong><br /><code>{table.tableId}</code></td>
                <td>{table.isSolo ? 'Solo' : 'Mehrspieler'}</td>
                <td>{table.gameCount}</td>
                <td>{formatDateTime(table.lastEventAt)}</td>
                <td><button className="admin-btn-sm" type="button" onClick={() => void selectTable(table)}>Spiele anzeigen</button></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      {selectedTable && (
        <div>
          <p style={{ fontSize: 13, color: 'var(--sh-text-dim)' }}>
            Aufzeichnungen für <strong>{selectedTable.tableName}</strong>
          </p>
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead><tr><th>Spielstart</th><th>Spiel-ID</th><th>Ereignisse</th><th>Verfügbar bis</th><th></th></tr></thead>
              <tbody>
                {games.map((game) => (
                  <tr key={`${game.captureId}:${game.gameId}`}>
                    <td>{formatDateTime(game.gameStartedAt)}</td>
                    <td><code>{game.gameId}</code></td>
                    <td>{game.serverEventCount} Server / {game.clientEventCount} Clients</td>
                    <td>{game.expiresAt ? formatDateTime(game.expiresAt) : 'Logging aktiv'}</td>
                    <td><button className="admin-btn-sm" type="button" disabled={busy} onClick={() => void downloadGame(game)}>JSON herunterladen</button></td>
                  </tr>
                ))}
                {games.length === 0 && <tr><td colSpan={5}>Keine aufgezeichneten Spiele vorhanden.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}

interface TrailerPlaylistSuggestion {
  playlistId: string;
  tableName: string;
  createdAt: string;
  expiresAt: string;
}

interface TrailerPlaylist extends TrailerPlaylistSuggestion {
  tableId: string;
  gameId: string;
  trailers: { itemId: string; position: number; trailerId: string | null; imdbId: string; title: string; year: number }[];
}

function TrailerPlaylistsSection({ token }: { token: string }) {
  const [playlistId, setPlaylistId] = useState('');
  const [suggestions, setSuggestions] = useState<TrailerPlaylistSuggestion[]>([]);
  const [playlist, setPlaylist] = useState<TrailerPlaylist | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const prefix = playlistId.trim();
    if (prefix.length < 3 || playlist?.playlistId === prefix) {
      setSuggestions([]);
      setLoadingSuggestions(false);
      return;
    }
    let cancelled = false;
    setLoadingSuggestions(true);
    const timeout = window.setTimeout(() => {
      apiFetch<{ playlists: TrailerPlaylistSuggestion[] }>(
        `/admin/trailer-playlists/search?prefix=${encodeURIComponent(prefix)}`,
        { token },
      )
        .then((result) => { if (!cancelled) setSuggestions(result.playlists); })
        .catch(() => { if (!cancelled) setSuggestions([]); })
        .finally(() => { if (!cancelled) setLoadingSuggestions(false); });
    }, 200);
    return () => { cancelled = true; window.clearTimeout(timeout); };
  }, [playlistId, playlist?.playlistId, token]);

  async function loadPlaylist(id: string) {
    setLoading(true);
    setError(null);
    setPlaylist(null);
    try {
      setPlaylist(await apiFetch<TrailerPlaylist>(`/admin/trailer-playlists/${id}`, { token }));
      setSuggestions([]);
    } catch {
      setError('Trailer-Playlist nicht gefunden (falsche ID oder älter als 1 Woche).');
    } finally {
      setLoading(false);
    }
  }

  function search(event: FormEvent) {
    event.preventDefault();
    const id = playlistId.trim();
    if (id) void loadPlaylist(id);
  }

  return (
    <>
      <p style={{ fontSize: 13, color: 'var(--sh-text-dim)', marginBottom: 12 }}>
        Jede Partie speichert die tatsächlich gespielten Trailer für eine Woche unter ihrer Playlist-ID.
      </p>
      <form className="admin-inline-form" onSubmit={search}>
        <input className="admin-search-input" placeholder="Playlist-ID einfügen…" value={playlistId}
          onChange={(event) => { setPlaylistId(event.target.value); setPlaylist(null); setError(null); }} />
        <button className="admin-btn-sm" type="submit" disabled={loading}>{loading ? 'Suche…' : 'Suchen'}</button>
      </form>
      {(loadingSuggestions || suggestions.length > 0) && (
        <div className="playlist-suggestions">
          {loadingSuggestions && suggestions.length === 0 && <div className="playlist-suggestions-empty">Suche passende IDs…</div>}
          {suggestions.map((suggestion) => (
            <button key={suggestion.playlistId} type="button" onClick={() => { setPlaylistId(suggestion.playlistId); void loadPlaylist(suggestion.playlistId); }}>
              <code>{suggestion.playlistId}</code>
              <span>{suggestion.tableName} · {new Date(suggestion.createdAt).toLocaleString()}</span>
            </button>
          ))}
        </div>
      )}
      {error && <div className="sh-error" style={{ marginTop: 12 }}>{error}</div>}
      {playlist && (
        <div style={{ marginTop: 16 }}>
          <p style={{ fontSize: 13, color: 'var(--sh-text-dim)' }}>
            Tisch: <strong>{playlist.tableName}</strong> (<code>{playlist.tableId}</code>) · erstellt{' '}
            {new Date(playlist.createdAt).toLocaleString()} · läuft ab {new Date(playlist.expiresAt).toLocaleString()}
          </p>
          <div className="admin-table-wrap">
            <table className="admin-table"><thead><tr><th>#</th><th>Titel</th><th>Jahr</th><th>IMDb</th></tr></thead>
              <tbody>
                {playlist.trailers.map((trailer) => <tr key={trailer.itemId}><td>{trailer.position}</td><td>{trailer.title}</td><td>{trailer.year}</td><td>{trailer.imdbId}</td></tr>)}
                {playlist.trailers.length === 0 && <tr><td colSpan={4}>Noch keine beendete Partie bzw. keine Trailer gespeichert.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}

interface AdminTrailer {
  trailerId: string;
  imdbId: string;
  title: string;
  year: number;
  clipStatus: 'ready' | 'missing';
  isValid: boolean;
  lastPlayedAt: string | null;
  updatedAt: string;
}

interface TrailerLibraryConfig {
  configured: boolean;
  path: string | null;
  hostPath: string | null;
  source: 'environment' | 'database' | 'unset';
  editable: boolean;
  readable: boolean;
  error: string | null;
}

// Ersatz fuer songsters "Musikquelle"/Song-Pool/Playlist-Abschnitte: bloeki
// hat keinen externen Lieferant zu konfigurieren - die Trailer-Bibliothek
// befuellt sich automatisch aus dem lokal gemounteten Snippet-Ordner (siehe
// backend/src/services/trailerScan.ts), diese Sektion zeigt nur den
// aktuellen Bestand und erlaubt einen manuellen Scan-Trigger zusaetzlich
// zum zyklischen 15-Minuten-Job.
function TrailersSection({ token }: { token: string }) {
  const [trailers, setTrailers] = useState<AdminTrailer[]>([]);
  const [library, setLibrary] = useState<TrailerLibraryConfig | null>(null);
  const [libraryPath, setLibraryPath] = useState('');
  const [scanning, setScanning] = useState(false);
  const [savingLibrary, setSavingLibrary] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  function load() {
    apiFetch<{ total: number; trailers: AdminTrailer[] }>('/admin/trailers', { token })
      .then((r) => setTrailers(r.trailers))
      .catch(() => {});
  }
  function loadLibrary() {
    apiFetch<TrailerLibraryConfig>('/admin/trailers/library', { token })
      .then((result) => {
        setLibrary(result);
        setLibraryPath(result.path ?? '');
      })
      .catch(() => {});
  }
  useEffect(() => {
    load();
    loadLibrary();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function saveLibrary() {
    setSavingLibrary(true);
    setMessage(null);
    try {
      const result = await apiFetch<TrailerLibraryConfig & {
        scan: { scanned: number; upserted: number; markedMissing: number; unmatched: string[] };
      }>('/admin/trailers/library', { method: 'PUT', token, body: { path: libraryPath } });
      setLibrary(result);
      setLibraryPath(result.path ?? '');
      setMessage(`Bibliothek gespeichert und gescannt: ${result.scan.scanned} Datei(en) gefunden.`);
      load();
    } catch (err) {
      setMessage(describeAdminError(err, 'Bibliothekspfad konnte nicht gespeichert werden.'));
    } finally {
      setSavingLibrary(false);
    }
  }

  async function triggerScan() {
    setScanning(true);
    setMessage(null);
    try {
      const result = await apiFetch<{ scanned: number; upserted: number; markedMissing: number; unmatched: string[] }>(
        '/admin/trailers/scan',
        { method: 'POST', token },
      );
      setMessage(
        `Scan fertig: ${result.scanned} Datei(en) gefunden, ${result.upserted} aktualisiert, ${result.markedMissing} als fehlend markiert` +
          (result.unmatched.length > 0 ? `, ${result.unmatched.length} ohne passendes Namensmuster.` : '.'),
      );
      load();
    } catch {
      setMessage('Scan fehlgeschlagen.');
    } finally {
      setScanning(false);
    }
  }

  const readyCount = trailers.filter((t) => t.clipStatus === 'ready').length;

  return (
    <>
      <div className="sh-info" style={{ marginBottom: 12 }}>
        <strong>Clipbibliothek</strong>
        {library ? (
          <>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8, flexWrap: 'wrap' }}>
              <input
                aria-label="Pfad der Clipbibliothek"
                value={libraryPath}
                disabled={!library.editable || savingLibrary}
                onChange={(event) => setLibraryPath(event.target.value)}
                style={{ flex: '1 1 360px' }}
              />
              {library.editable && (
                <button className="admin-btn-sm" type="button" disabled={savingLibrary} onClick={saveLibrary}>
                  {savingLibrary ? 'Speichere…' : 'Pfad speichern'}
                </button>
              )}
            </div>
            <p style={{ fontSize: 12, margin: '6px 0 0' }}>
              {library.source === 'environment'
                ? 'Durch TRAILER_CLIP_DIR fest vorgegeben. Den Docker-Hostordner änderst du mit TRAILER_CLIP_HOST_DIR und startest den Container neu.'
                : library.configured
                  ? 'Im Adminbereich gespeichert.'
                  : 'Noch nicht eingerichtet.'}{' '}
              {library.readable ? 'Verzeichnis ist lesbar.' : library.error ?? ''}
            </p>
            <p style={{ fontSize: 12, margin: '4px 0 0' }}>
              Docker-Hostpfad:{' '}
              {library.hostPath ? <code>{library.hostPath}</code> : <span>TRAILER_CLIP_HOST_DIR nicht gesetzt</span>}
            </p>
          </>
        ) : (
          <p>Lade Bibliothekseinstellung…</p>
        )}
      </div>
      <p style={{ fontSize: 13, color: 'var(--sh-text-dim)', marginBottom: 4 }}>
        {trailers.length} Trailer bekannt, {readyCount} spielbereit. Der Snippet-Ordner wird alle 15 Minuten
        automatisch neu gescannt - Trailer schneidet <code>tools/snippet-cutter</code> lokal zu (siehe README).
      </p>
      {message && <div className="sh-info" style={{ marginBottom: 12 }}>{message}</div>}
      <button
        className="admin-btn-sm"
        type="button"
        disabled={scanning || !library?.readable}
        onClick={triggerScan}
      >
        {scanning ? 'Scanne…' : 'Jetzt scannen'}
      </button>
      <div className="admin-table-wrap admin-table-scroll" style={{ marginTop: 12 }}>
        <table className="admin-table">
          <thead>
            <tr>
              <th>Titel</th>
              <th>Jahr</th>
              <th>IMDb</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {trailers.map((t) => (
              <tr key={t.trailerId}>
                <td>{t.title}</td>
                <td>{t.year}</td>
                <td>{t.imdbId}</td>
                <td>
                  {t.clipStatus === 'ready' ? (
                    <span className="admin-pill">bereit</span>
                  ) : (
                    <span className="admin-pill warn">fehlt</span>
                  )}
                </td>
              </tr>
            ))}
            {trailers.length === 0 && (
              <tr>
                <td colSpan={4} style={{ color: 'var(--sh-text-faint)' }}>
                  Noch keine Trailer gefunden - tools/snippet-cutter ausfuehren und Scan abwarten.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

function describeAdminError(err: unknown, fallback: string): string {
  if (err instanceof ApiError) {
    const body = err.body as { error?: string; message?: string } | null;
    return body?.message ?? body?.error ?? fallback;
  }
  return fallback;
}

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

interface AdminTable {
  tableId: string;
  name: string;
  visibility: string;
  state: string;
  ownerUsername: string;
  activePlayers: number;
  activeSpectators: number;
  createdAt: string;
  lastActivityAt: string;
  inactive: boolean;
}

function TablesSection({ token }: { token: string }) {
  const [tables, setTables] = useState<AdminTable[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function load() {
    apiFetch<{ tables: AdminTable[] }>('/admin/tables', { token })
      .then((r) => setTables(r.tables))
      .catch(() => {});
  }
  useEffect(load, [token]);

  async function deleteTable(table: AdminTable) {
    const confirmed = window.confirm(`Tisch "${table.name}" wirklich löschen? Das entfernt auch laufende/gespeicherte Spieldaten dieses Tisches.`);
    if (!confirmed) return;

    setBusyId(table.tableId);
    setError(null);
    try {
      await apiFetch<null>(`/admin/tables/${table.tableId}`, { method: 'DELETE', token });
      setTables((prev) => prev.filter((entry) => entry.tableId !== table.tableId));
    } catch {
      setError('Tisch konnte nicht gelöscht werden.');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      <p style={{ fontSize: 12, color: 'var(--sh-text-faint)', marginBottom: 12 }}>
        {tables.length} Tische - "Inaktiv" = seit 30 Minuten keine Interaktion. Ohne jede Interaktion für 60 Minuten
        wird ein Tisch automatisch gelöscht.
      </p>
      {error && <div className="sh-error" style={{ marginBottom: 12 }}>{error}</div>}
      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Name</th>
              <th aria-label="Erstellt"></th>
              <th>Besitzer</th>
              <th>Sichtbarkeit</th>
              <th>Status</th>
              <th>Spieler</th>
              <th>Zuschauer</th>
              <th>Aktivität</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {tables.map((t) => (
              <tr key={t.tableId}>
                <td>{t.name}</td>
                <td>
                  <span
                    className="admin-clock-icon"
                    title={`Erstellt: ${formatDateTime(t.createdAt)}`}
                    aria-label={`Erstellt: ${formatDateTime(t.createdAt)}`}
                  />
                </td>
                <td>{t.ownerUsername}</td>
                <td>{t.visibility === 'public' ? 'Öffentlich' : 'Privat'}</td>
                <td>{t.state}</td>
                <td>{t.activePlayers}</td>
                <td>{t.activeSpectators}</td>
                <td>
                  {t.inactive ? (
                    <span className="admin-pill warn">inaktiv</span>
                  ) : (
                    <span className="admin-pill">aktiv</span>
                  )}
                </td>
                <td>
                  <button className="admin-btn-sm admin-btn-danger" type="button" disabled={busyId === t.tableId} onClick={() => deleteTable(t)}>
                    {busyId === t.tableId ? 'Löscht…' : 'Löschen'}
                  </button>
                </td>
              </tr>
            ))}
            {tables.length === 0 && (
              <tr>
                <td colSpan={9} style={{ color: 'var(--sh-text-faint)' }}>
                  Keine Tische vorhanden.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

function UsersSection({ token }: { token: string }) {
  const { auth } = useAuth();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [tempPasswordModal, setTempPasswordModal] = useState<{ username: string; password: string } | null>(null);
  const [roleError, setRoleError] = useState<string | null>(null);

  function load() {
    apiFetch<{ users: AdminUser[] }>('/admin/users', { token })
      .then((r) => setUsers(r.users))
      .catch(() => {});
  }
  useEffect(load, [token]);

  async function toggleInvitePermission(user: AdminUser) {
    setBusyId(user.userId);
    try {
      await apiFetch(`/admin/users/${user.userId}/invite-permission`, {
        method: 'POST',
        body: { canCreateInvites: !user.canCreateInvites },
        token,
      });
      load();
    } finally {
      setBusyId(null);
    }
  }

  async function revoke(user: AdminUser) {
    setBusyId(user.userId);
    try {
      await apiFetch(`/admin/users/${user.userId}/revoke-invites`, {
        method: 'POST',
        body: { invalidateCreatedInvites: true, deactivateRegisteredUsers: false },
        token,
      });
      load();
    } finally {
      setBusyId(null);
    }
  }

  async function resetQuota(user: AdminUser) {
    setBusyId(user.userId);
    try {
      await apiFetch(`/admin/users/${user.userId}/reset-invite-quota`, { method: 'POST', token });
      load();
    } finally {
      setBusyId(null);
    }
  }

  async function setRole(user: AdminUser, role: 'user' | 'admin') {
    setBusyId(user.userId);
    setRoleError(null);
    try {
      await apiFetch(`/admin/users/${user.userId}/role`, { method: 'POST', body: { role }, token });
      load();
    } catch (err) {
      setRoleError(
        err instanceof ApiError && err.status === 409
          ? 'Der letzte verbleibende Admin kann nicht degradiert werden.'
          : 'Rolle konnte nicht geändert werden.',
      );
    } finally {
      setBusyId(null);
    }
  }

  async function resetPassword(user: AdminUser) {
    setBusyId(user.userId);
    try {
      const result = await apiFetch<{ temporaryPassword: string }>(`/admin/users/${user.userId}/reset-password`, {
        method: 'POST',
        token,
      });
      setTempPasswordModal({ username: user.username, password: result.temporaryPassword });
      load();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      <p style={{ fontSize: 12, color: 'var(--sh-text-faint)', marginBottom: 12 }}>{users.length} Nutzer</p>
      {roleError && <div className="sh-error" style={{ marginBottom: 12 }}>{roleError}</div>}
      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Rolle</th>
              <th>Status</th>
              <th>Punkte / Karma</th>
              <th>Einladungsrecht</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.userId}>
                <td>{u.username}</td>
                <td>
                  {u.role === 'admin' ? <span className="admin-pill">Admin</span> : 'Mitglied'}
                  {u.isSuperAdmin && <span className="admin-pill" style={{ marginLeft: 6 }}>Erstadmin</span>}
                </td>
                <td>
                  {u.status === 'active' ? <span className="admin-pill">aktiv</span> : <span className="admin-pill bad">gesperrt</span>}
                  {u.passwordResetRequestedAt && <span className="admin-pill warn" style={{ marginLeft: 6 }}>Reset angefordert</span>}
                </td>
                <td>
                  {u.scorePoints} / {u.karmaPoints}
                </td>
                <td>{u.canCreateInvites ? 'ja' : 'nein'}</td>
                <td style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                  {u.role !== 'admin' && (
                    <>
                      <button className="admin-btn-sm" disabled={busyId === u.userId} onClick={() => toggleInvitePermission(u)}>
                        {u.canCreateInvites ? 'Recht entziehen' : 'Recht erteilen'}
                      </button>
                      <button className="admin-btn-sm" disabled={busyId === u.userId} onClick={() => revoke(u)}>
                        Einladungen sperren
                      </button>
                      <button className="admin-btn-sm" disabled={busyId === u.userId} onClick={() => resetQuota(u)}>
                        Kontingent zurücksetzen
                      </button>
                      {auth?.user.isSuperAdmin && (
                        <button className="admin-btn-sm" disabled={busyId === u.userId} onClick={() => setRole(u, 'admin')}>
                          Zum Admin machen
                        </button>
                      )}
                      <button className="admin-btn-sm" disabled={busyId === u.userId} onClick={() => resetPassword(u)}>
                        Passwort zurücksetzen
                      </button>
                    </>
                  )}
                  {/* Eigene Zeile: hier gibt es nichts sinnvoll zu tun, man ist ja schon
                      eingeloggt - weder sich selbst degradieren noch sich selbst das
                      Passwort zurücksetzen bringt etwas. */}
                  {u.role === 'admin' && u.userId !== auth?.user.id && (
                    <>
                      {auth?.user.isSuperAdmin && !u.isSuperAdmin && (
                        <button className="admin-btn-sm" disabled={busyId === u.userId} onClick={() => setRole(u, 'user')}>
                          Admin-Recht entziehen
                        </button>
                      )}
                      <button className="admin-btn-sm" disabled={busyId === u.userId} onClick={() => resetPassword(u)}>
                        Passwort zurücksetzen
                      </button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {tempPasswordModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.6)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}
          onClick={(e) => e.target === e.currentTarget && setTempPasswordModal(null)}
        >
          <div className="sh-card" style={{ maxWidth: 420 }}>
            <h2 style={{ fontSize: 15 }}>Neues Temp-Passwort für {tempPasswordModal.username}</h2>
            <p style={{ fontSize: 13, color: 'var(--sh-text-faint)' }}>
              Gib dieses Passwort an {tempPasswordModal.username} weiter. Beim nächsten Login muss sofort ein neues
              eigenes Passwort gesetzt werden.
            </p>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 10,
                padding: '10px 12px',
                borderRadius: 8,
                background: 'var(--sh-bg-alt, rgba(255,255,255,0.06))',
                margin: '14px 0',
              }}
            >
              <code style={{ fontSize: 16, letterSpacing: 0.5 }}>{tempPasswordModal.password}</code>
              <button
                className="admin-btn-sm"
                type="button"
                onClick={() => navigator.clipboard?.writeText(tempPasswordModal.password).catch(() => {})}
              >
                Kopieren
              </button>
            </div>
            <button className="sh-submit" type="button" onClick={() => setTempPasswordModal(null)}>
              Schließen
            </button>
          </div>
        </div>
      )}
    </>
  );
}
