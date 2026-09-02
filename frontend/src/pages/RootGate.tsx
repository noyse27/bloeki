import { useEffect, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { apiFetch, ApiError } from '../api';
import { HomePage } from './HomePage';
import './pages.css';

type Status = 'checking' | 'needsSetup' | 'ready' | 'unreachable' | 'rateLimited';

/** FR-061/FR-062: a fresh install has no admin yet and must go through the
 * setup wizard first. Once an admin exists, "/" is the normal home screen. */
export function RootGate() {
  const [status, setStatus] = useState<Status>('checking');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    apiFetch<{ adminExists: boolean }>('/setup/status')
      .then((s) => {
        if (!cancelled) setStatus(s.adminExists ? 'ready' : 'needsSetup');
      })
      .catch((err) => {
        if (cancelled) return;
        // A 429 means the backend is up and answered - just declining this
        // one request. Previously reported as "backend unreachable" too,
        // which sent people down the wrong troubleshooting path entirely
        // (checking Docker/network) for what was actually a rate-limit
        // hit, most often several players sharing one connection.
        setStatus(err instanceof ApiError && err.status === 429 ? 'rateLimited' : 'unreachable');
      });
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  // A momentary blip (backend restarting, NAS under load, a rate-limit
  // window passing) shouldn't strand someone here with no way forward -
  // retry quietly in the background so it self-heals, on top of the manual
  // button below for "check right now".
  useEffect(() => {
    if (status !== 'unreachable' && status !== 'rateLimited') return;
    const id = window.setInterval(() => setAttempt((a) => a + 1), 4000);
    return () => window.clearInterval(id);
  }, [status]);

  if (status === 'checking') {
    return (
      <div className="app-shell">
        <p>Lade…</p>
      </div>
    );
  }
  if (status === 'needsSetup') return <Navigate to="/setup" replace />;
  if (status === 'unreachable' || status === 'rateLimited') {
    return (
      <div className="app-shell">
        <div className="sh-card">
          <p className="sh-error">
            {status === 'rateLimited'
              ? 'Gerade zu viele Anfragen - das Backend läuft, versucht es aber gleich automatisch erneut.'
              : 'Backend nicht erreichbar. Bitte Setup pruefen (siehe README).'}
          </p>
          <div className="sh-actions">
            <button className="sh-action sh-primary" onClick={() => setAttempt((a) => a + 1)}>
              Erneut versuchen <span className="sh-action-arrow">→</span>
            </button>
            <Link className="sh-action" to="/login">
              Zum Login <span className="sh-action-arrow">→</span>
            </Link>
            <Link className="sh-action" to="/lobby">
              Zur Lobby <span className="sh-action-arrow">→</span>
            </Link>
          </div>
        </div>
      </div>
    );
  }
  return <HomePage />;
}
