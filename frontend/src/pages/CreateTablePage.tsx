import { FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import './pages.css';
import { useAuth } from '../auth/AuthContext';
import { apiFetch, ApiError } from '../api';

export function CreateTablePage() {
  const { auth } = useAuth();
  const navigate = useNavigate();

  const [name, setName] = useState('');
  const [visibility, setVisibility] = useState<'public' | 'private'>('public');
  const [allowSpectators, setAllowSpectators] = useState(true);
  const [maxPlayers, setMaxPlayers] = useState(5);
  const [maxSpectators, setMaxSpectators] = useState(10);
  // Each requirement is off (null, no restriction at all) unless its
  // checkbox is on - a bare numeric input defaulting to 0 can never
  // represent "not required", since 0 is itself a real, meaningful
  // requirement (excludes negative karma) that a brand-new player with
  // exactly 0 karma/score/games would otherwise be silently subject to.
  const [minKarmaEnabled, setMinKarmaEnabled] = useState(false);
  const [minKarmaPoints, setMinKarmaPoints] = useState(0);
  const [minScoreEnabled, setMinScoreEnabled] = useState(false);
  const [minScorePoints, setMinScorePoints] = useState(0);
  const [minGamesEnabled, setMinGamesEnabled] = useState(false);
  const [minGamesPlayed, setMinGamesPlayed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!auth) return;
    setError(null);
    setSubmitting(true);
    try {
      const result = await apiFetch<{ tableId: string }>('/tables', {
        method: 'POST',
        body: {
          name,
          visibility,
          allowSpectators,
          maxPlayers,
          maxSpectators,
          minKarmaPoints: minKarmaEnabled ? minKarmaPoints : null,
          minScorePoints: minScoreEnabled ? minScorePoints : null,
          minGamesPlayed: minGamesEnabled ? minGamesPlayed : null,
        },
        token: auth.accessToken,
      });
      navigate(`/tisch/${result.tableId}`);
    } catch (err) {
      setError(describeError(err));
    } finally {
      setSubmitting(false);
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
        <Link className="sh-back" to="/lobby">
          &larr; Zurück zur Lobby
        </Link>
        <h2>Tisch erstellen</h2>

        {error && <div className="sh-error" style={{ marginBottom: 14 }}>{error}</div>}

        <form className="sh-form" onSubmit={handleSubmit}>
          <div className="sh-field">
            <label htmlFor="name">Tischname</label>
            <input id="name" required autoFocus value={name} onChange={(e) => setName(e.target.value)} />
          </div>

          <div className="sh-field">
            <label htmlFor="visibility">Sichtbarkeit</label>
            <select
              id="visibility"
              value={visibility}
              onChange={(e) => setVisibility(e.target.value as 'public' | 'private')}
            >
              <option value="public">Öffentlich (in der Lobby sichtbar)</option>
              <option value="private">Privat (nur per Link/Code)</option>
            </select>
          </div>

          <div className="sh-field">
            <label htmlFor="maxPlayers">Max. Spieler (2-5)</label>
            <input
              id="maxPlayers"
              type="number"
              min={2}
              max={5}
              value={maxPlayers}
              onChange={(e) => setMaxPlayers(Number(e.target.value))}
            />
          </div>

          <div className="sh-field">
            <label style={{ flexDirection: 'row', display: 'flex', alignItems: 'center', gap: 8 }}>
              <input type="checkbox" checked={allowSpectators} onChange={(e) => setAllowSpectators(e.target.checked)} />
              Zuschauer erlauben
            </label>
          </div>

          {allowSpectators && (
            <div className="sh-field">
              <label htmlFor="maxSpectators">Max. Zuschauer (0-50)</label>
              <input
                id="maxSpectators"
                type="number"
                min={0}
                max={50}
                value={maxSpectators}
                onChange={(e) => setMaxSpectators(Number(e.target.value))}
              />
            </div>
          )}

          <div className="sh-form-section-label">Zusätzliche Optionen</div>
          <p style={{ fontSize: '0.85em', opacity: 0.8, margin: '-8px 0 0' }}>
            Wer diese Mindestwerte nicht erfüllt, kann dem Tisch nur als Zuschauer beitreten.
          </p>

          <div className="sh-field">
            <label style={{ flexDirection: 'row', display: 'flex', alignItems: 'center', gap: 8 }}>
              <input type="checkbox" checked={minKarmaEnabled} onChange={(e) => setMinKarmaEnabled(e.target.checked)} />
              Karmapunkte min.
            </label>
            {minKarmaEnabled && (
              <input
                id="minKarmaPoints"
                type="number"
                min={0}
                value={minKarmaPoints}
                onChange={(e) => setMinKarmaPoints(Math.max(0, Number(e.target.value)))}
              />
            )}
          </div>

          <div className="sh-field">
            <label style={{ flexDirection: 'row', display: 'flex', alignItems: 'center', gap: 8 }}>
              <input type="checkbox" checked={minScoreEnabled} onChange={(e) => setMinScoreEnabled(e.target.checked)} />
              Spielpunkte min.
            </label>
            {minScoreEnabled && (
              <input
                id="minScorePoints"
                type="number"
                min={0}
                value={minScorePoints}
                onChange={(e) => setMinScorePoints(Math.max(0, Number(e.target.value)))}
              />
            )}
          </div>

          <div className="sh-field">
            <label style={{ flexDirection: 'row', display: 'flex', alignItems: 'center', gap: 8 }}>
              <input type="checkbox" checked={minGamesEnabled} onChange={(e) => setMinGamesEnabled(e.target.checked)} />
              Anzahl Spiele min.
            </label>
            {minGamesEnabled && (
              <input
                id="minGamesPlayed"
                type="number"
                min={0}
                value={minGamesPlayed}
                onChange={(e) => setMinGamesPlayed(Math.max(0, Number(e.target.value)))}
              />
            )}
          </div>

          <button className="sh-submit" type="submit" disabled={submitting}>
            {submitting ? 'Erstellen…' : 'Tisch erstellen'}
          </button>
        </form>
      </div>
    </div>
  );
}

function describeError(err: unknown): string {
  if (err instanceof ApiError) {
    const body = err.body as { error?: string; message?: string } | null;
    return body?.message ?? body?.error ?? 'Tisch konnte nicht erstellt werden.';
  }
  return 'Backend nicht erreichbar.';
}
