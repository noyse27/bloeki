import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import './pages.css';
import { useAuth } from '../auth/AuthContext';
import { apiFetch } from '../api';

interface LeaderboardEntry {
  userId: string;
  username: string;
  scorePoints: number;
  karmaPoints: number;
  gamesPlayed: number;
}

interface OwnStats {
  id: string;
  username: string;
  scorePoints: number;
  karmaPoints: number;
  gamesPlayed: number;
  rankPosition: number;
}

export function LeaderboardPage() {
  const { auth } = useAuth();
  const [top, setTop] = useState<LeaderboardEntry[]>([]);
  const [own, setOwn] = useState<OwnStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!auth) return;
    Promise.all([
      apiFetch<{ leaderboard: LeaderboardEntry[] }>('/leaderboard', { token: auth.accessToken }),
      apiFetch<OwnStats>('/users/me', { token: auth.accessToken }),
    ])
      .then(([lb, me]) => {
        setTop(lb.leaderboard.slice(0, 10));
        setOwn(me);
      })
      .catch(() => setError('Rangliste konnte nicht geladen werden.'));
  }, [auth]);

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

  const ownInTop10 = own ? top.some((e) => e.userId === own.id) : true;

  return (
    <div className="app-shell">
      <div className="sh-card admin-shell" style={{ maxWidth: 640 }}>
        <Link className="sh-back" to="/">
          &larr; Zurück
        </Link>
        <h2>Rangliste</h2>

        {error && <div className="sh-error" style={{ marginBottom: 14 }}>{error}</div>}

        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Rang</th>
                <th>Name</th>
                <th>Punkte</th>
                <th>Karma-Punkte</th>
                <th>Spiele</th>
              </tr>
            </thead>
            <tbody>
              {top.map((e, i) => (
                <tr key={e.userId} style={e.userId === own?.id ? { color: 'var(--adolar-cyan)' } : undefined}>
                  <td>#{i + 1}</td>
                  <td>{e.username}</td>
                  <td>{e.scorePoints}</td>
                  <td>{e.karmaPoints}</td>
                  <td>{e.gamesPlayed}</td>
                </tr>
              ))}
              {top.length === 0 && (
                <tr>
                  <td colSpan={5} style={{ color: 'var(--sh-text-faint)' }}>
                    Noch keine Einträge.
                  </td>
                </tr>
              )}
              {own && !ownInTop10 && (
                <>
                  <tr>
                    <td colSpan={5} style={{ textAlign: 'center', color: 'var(--sh-text-faint)', fontSize: 12 }}>
                      &middot;&middot;&middot;
                    </td>
                  </tr>
                  <tr style={{ color: 'var(--adolar-cyan)' }}>
                    <td>#{own.rankPosition}</td>
                    <td>{own.username}</td>
                    <td>{own.scorePoints}</td>
                    <td>{own.karmaPoints}</td>
                    <td>{own.gamesPlayed}</td>
                  </tr>
                </>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
