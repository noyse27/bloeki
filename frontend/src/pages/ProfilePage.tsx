import { FormEvent, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import './pages.css';
import { useAuth } from '../auth/AuthContext';
import { apiFetch, ApiError } from '../api';

interface Profile {
  id: string;
  username: string;
  email: string;
  role: 'user' | 'admin';
  canCreateInvites: boolean;
  karmaPoints: number;
  scorePoints: number;
  gamesPlayed: number;
  createdAt: string;
}

interface LeaderboardEntry {
  userId: string;
  username: string;
  scorePoints: number;
  karmaPoints: number;
}

interface HostDevice {
  id: string;
  label: string;
  online: boolean;
  lastSeenAt: string | null;
  currentTableId: string | null;
  authorizedAt: string | null;
}

export function ProfilePage() {
  const { auth } = useAuth();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [rank, setRank] = useState<number | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newPassword2, setNewPassword2] = useState('');
  const [pwError, setPwError] = useState<string | null>(null);
  const [pwSuccess, setPwSuccess] = useState(false);
  const [pwSubmitting, setPwSubmitting] = useState(false);
  const [hostDevices, setHostDevices] = useState<HostDevice[]>([]);
  const [pairingCode, setPairingCode] = useState('');
  const [hostError, setHostError] = useState<string | null>(null);
  const [hostSuccess, setHostSuccess] = useState<string | null>(null);
  const [hostSubmitting, setHostSubmitting] = useState(false);

  useEffect(() => {
    if (!auth) return;
    apiFetch<Profile>('/users/me', { token: auth.accessToken })
      .then(setProfile)
      .catch(() => setLoadError('Profil konnte nicht geladen werden.'));
    apiFetch<{ leaderboard: LeaderboardEntry[] }>('/leaderboard', { token: auth.accessToken })
      .then((res) => {
        const idx = res.leaderboard.findIndex((e) => e.userId === auth.user.id);
        setRank(idx >= 0 ? idx + 1 : null);
      })
      .catch(() => {});
    loadHostDevices(auth.accessToken);
  }, [auth]);

  async function loadHostDevices(token: string) {
    apiFetch<{ devices: HostDevice[] }>('/users/me/host-devices', { token })
      .then((res) => setHostDevices(res.devices))
      .catch(() => {});
  }

  async function handleChangePassword(event: FormEvent) {
    event.preventDefault();
    setPwError(null);
    setPwSuccess(false);
    if (newPassword !== newPassword2) {
      setPwError('Die neuen Passwörter stimmen nicht überein.');
      return;
    }
    setPwSubmitting(true);
    try {
      await apiFetch('/users/me/change-password', {
        method: 'POST',
        body: { currentPassword, newPassword },
        token: auth?.accessToken,
      });
      setPwSuccess(true);
      setCurrentPassword('');
      setNewPassword('');
      setNewPassword2('');
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setPwError('Aktuelles Passwort ist falsch.');
      } else {
        setPwError('Passwort konnte nicht geändert werden.');
      }
    } finally {
      setPwSubmitting(false);
    }
  }

  async function handleAuthorizeHostDevice(event: FormEvent) {
    event.preventDefault();
    if (!auth) return;
    setHostSubmitting(true);
    setHostError(null);
    setHostSuccess(null);
    try {
      const result = await apiFetch<{ device: { label: string } }>('/host-devices/authorize', {
        method: 'POST',
        body: { pairingCode },
        token: auth.accessToken,
      });
      setPairingCode('');
      setHostSuccess(`${result.device.label} verbunden.`);
      await loadHostDevices(auth.accessToken);
    } catch {
      setHostError('Code ist ungültig oder abgelaufen.');
    } finally {
      setHostSubmitting(false);
    }
  }

  async function handleRevokeHostDevice(deviceId: string) {
    if (!auth) return;
    setHostError(null);
    try {
      await apiFetch(`/users/me/host-devices/${deviceId}`, { method: 'DELETE', token: auth.accessToken });
      await loadHostDevices(auth.accessToken);
    } catch {
      setHostError('Hostgerät konnte nicht getrennt werden.');
    }
  }

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

  return (
    <div className="app-shell">
      <div className="sh-card">
        <Link className="sh-back" to="/">
          &larr; Zurück
        </Link>
        <h2>Dein Profil</h2>

        {loadError && <div className="sh-error" style={{ marginBottom: 14 }}>{loadError}</div>}

        {profile && (
          <div className="admin-stat-grid" style={{ marginBottom: 22 }}>
            <div className="admin-stat">
              <span>Benutzername</span>
              <b>{profile.username}</b>
            </div>
            <div className="admin-stat">
              <span>E-Mail</span>
              <b>{profile.email}</b>
            </div>
            <div className="admin-stat">
              <span>Punkte</span>
              <b>{profile.scorePoints}</b>
            </div>
            <div className="admin-stat">
              <span>Karma-Punkte</span>
              <b>{profile.karmaPoints}</b>
            </div>
            <div className="admin-stat">
              <span>Gespielte Spiele</span>
              <b>{profile.gamesPlayed}</b>
            </div>
            <div className="admin-stat">
              <span>Rang</span>
              <b>{rank ? `#${rank}` : '—'}</b>
            </div>
            <div className="admin-stat">
              <span>Rolle</span>
              <b>{profile.role === 'admin' ? 'Admin' : 'Mitglied'}</b>
            </div>
          </div>
        )}

        <h2 style={{ fontSize: 15 }}>Host-App</h2>
        {hostError && <div className="sh-error" style={{ marginBottom: 14 }}>{hostError}</div>}
        {hostSuccess && <div className="sh-info" style={{ marginBottom: 14 }}>{hostSuccess}</div>}
        <form className="admin-inline-form" onSubmit={handleAuthorizeHostDevice}>
          <input
            aria-label="Host-App-Code"
            placeholder="Fire-TV-Code"
            value={pairingCode}
            onChange={(e) => setPairingCode(e.target.value.toUpperCase())}
          />
          <button className="admin-btn-sm" disabled={hostSubmitting || pairingCode.trim().length < 4}>
            {hostSubmitting ? 'Verbindet…' : 'Hostgerät verbinden'}
          </button>
        </form>
        <div className="admin-section" style={{ marginBottom: 22 }}>
          <h3>Verbundene Hostgeräte</h3>
          {hostDevices.length === 0 ? (
            <p style={{ fontSize: 13, color: 'var(--sh-text-faint)' }}>Noch keine Host-App verbunden.</p>
          ) : (
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {hostDevices.map((device) => (
                <li key={device.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
                  <span style={{ color: 'var(--sh-text-dim)' }}>
                    <span className={`admin-pill${device.online ? '' : ' warn'}`}>{device.online ? 'online' : 'offline'}</span>{' '}
                    {device.label}
                  </span>
                  <button className="admin-btn-sm" onClick={() => handleRevokeHostDevice(device.id)}>
                    Trennen
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <h2 style={{ fontSize: 15 }}>Passwort ändern</h2>
        {pwError && <div className="sh-error" style={{ marginBottom: 14 }}>{pwError}</div>}
        {pwSuccess && <div className="sh-info" style={{ marginBottom: 14 }}>Passwort geändert.</div>}
        <form className="sh-form" onSubmit={handleChangePassword}>
          <div className="sh-field">
            <label htmlFor="currentPassword">Aktuelles Passwort</label>
            <input
              id="currentPassword"
              type="password"
              required
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
            />
          </div>
          <div className="sh-field">
            <label htmlFor="newPassword">Neues Passwort</label>
            <input
              id="newPassword"
              type="password"
              required
              minLength={8}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
          </div>
          <div className="sh-field">
            <label htmlFor="newPassword2">Neues Passwort (Wiederholung)</label>
            <input
              id="newPassword2"
              type="password"
              required
              minLength={8}
              value={newPassword2}
              onChange={(e) => setNewPassword2(e.target.value)}
            />
          </div>
          <button className="sh-submit" type="submit" disabled={pwSubmitting}>
            {pwSubmitting ? 'Ändern…' : 'Passwort ändern'}
          </button>
        </form>
      </div>
    </div>
  );
}
