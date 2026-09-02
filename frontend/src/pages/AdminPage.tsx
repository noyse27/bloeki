import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import './pages.css';
import { useAuth } from '../auth/AuthContext';
import { apiFetch } from '../api';
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
      </div>
    </div>
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

// Ersatz fuer songsters "Musikquelle"/Song-Pool/Playlist-Abschnitte: bloeki
// hat keinen externen Lieferant zu konfigurieren - die Trailer-Bibliothek
// befuellt sich automatisch aus dem lokal gemounteten Snippet-Ordner (siehe
// backend/src/services/trailerScan.ts), diese Sektion zeigt nur den
// aktuellen Bestand und erlaubt einen manuellen Scan-Trigger zusaetzlich
// zum zyklischen 15-Minuten-Job.
function TrailersSection({ token }: { token: string }) {
  const [trailers, setTrailers] = useState<AdminTrailer[]>([]);
  const [scanning, setScanning] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  function load() {
    apiFetch<{ total: number; trailers: AdminTrailer[] }>('/admin/trailers', { token })
      .then((r) => setTrailers(r.trailers))
      .catch(() => {});
  }
  useEffect(load, [token]);

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
      <p style={{ fontSize: 13, color: 'var(--sh-text-dim)', marginBottom: 4 }}>
        {trailers.length} Trailer bekannt, {readyCount} spielbereit. Der Snippet-Ordner wird alle 15 Minuten
        automatisch neu gescannt - Trailer schneidet <code>tools/snippet-cutter</code> lokal zu (siehe README).
      </p>
      {message && <div className="sh-info" style={{ marginBottom: 12 }}>{message}</div>}
      <button className="admin-btn-sm" type="button" disabled={scanning} onClick={triggerScan}>
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
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);

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

  return (
    <>
      <p style={{ fontSize: 12, color: 'var(--sh-text-faint)', marginBottom: 12 }}>{users.length} Nutzer</p>
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
                <td>{u.role === 'admin' ? <span className="admin-pill">Admin</span> : 'Mitglied'}</td>
                <td>
                  {u.status === 'active' ? <span className="admin-pill">aktiv</span> : <span className="admin-pill bad">gesperrt</span>}
                </td>
                <td>
                  {u.scorePoints} / {u.karmaPoints}
                </td>
                <td>{u.canCreateInvites ? 'ja' : 'nein'}</td>
                <td style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
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
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
