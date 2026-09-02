import { FormEvent, useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import './pages.css';
import { apiFetch, ApiError } from '../api';
import { useAuth } from '../auth/AuthContext';

interface AuthorizedDevice {
  device: {
    id: string;
    label: string;
  };
}

export function HostAuthorizePage() {
  const { auth } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const code = searchParams.get('code') ?? '';
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    setError(null);
    setSuccess(null);
  }, [code]);

  async function handleAuthorize(event: FormEvent) {
    event.preventDefault();
    if (!auth || !code) return;
    setSubmitting(true);
    setError(null);
    setSuccess(null);
    try {
      const result = await apiFetch<AuthorizedDevice>('/host-devices/authorize', {
        method: 'POST',
        body: { pairingCode: code },
        token: auth.accessToken,
      });
      setSuccess(`${result.device.label} ist verbunden.`);
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) setError('Dieser Host-Code ist ungültig oder abgelaufen.');
      else setError('Hostgerät konnte nicht verbunden werden.');
    } finally {
      setSubmitting(false);
    }
  }

  if (!auth) {
    return (
      <div className="app-shell">
        <div className="sh-card" style={{ maxWidth: 520 }}>
          <h2>Host-App verbinden</h2>
          <p style={{ color: 'var(--sh-text-dim)' }}>Melde dich an, um dieses Hostgerät mit deinem Konto zu verbinden.</p>
          <Link className="sh-submit" style={{ display: 'block', textAlign: 'center', textDecoration: 'none' }} to="/login" state={{ next: location.pathname + location.search }}>
            Anmelden
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <div className="sh-card" style={{ maxWidth: 520 }}>
        <Link className="sh-back" to="/profil">
          &larr; Zum Profil
        </Link>
        <h2>Host-App verbinden</h2>
        {!code ? (
          <div className="sh-error">Kein Host-Code im Link.</div>
        ) : (
          <>
            <p style={{ color: 'var(--sh-text-dim)' }}>
              Dieses Anzeigegerät wird bis zum Schließen der Host-App mit deinem Konto verbunden.
            </p>
            <div
              style={{
                fontFamily: 'var(--sh-font-display)',
                fontSize: 34,
                color: 'var(--adolar-cyan)',
                marginBottom: 14,
                textAlign: 'center',
              }}
            >
              {code}
            </div>
            {error && <div className="sh-error" style={{ marginBottom: 14 }}>{error}</div>}
            {success ? (
              <>
                <div className="sh-info" style={{ marginBottom: 14 }}>{success}</div>
                <button className="sh-submit" onClick={() => navigate('/lobby')}>
                  Zur Lobby
                </button>
              </>
            ) : (
              <form onSubmit={handleAuthorize}>
                <button className="sh-submit" disabled={submitting}>
                  {submitting ? 'Verbindet…' : 'Hostgerät bestätigen'}
                </button>
              </form>
            )}
          </>
        )}
      </div>
    </div>
  );
}
