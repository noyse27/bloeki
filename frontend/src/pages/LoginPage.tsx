import { FormEvent, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import './pages.css';
import { useAuth } from '../auth/AuthContext';
import { apiFetch, ApiError } from '../api';

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  // Preserves a deep link (e.g. a private table's ?code=... invite/QR link,
  // see TableRoomPage.tsx) through the login detour - without this, anyone
  // not already logged in who scans an invite QR would land back on the
  // home screen after logging in and have to scan/open the link a second
  // time. Only ever an internal same-app path, set by our own <Link>s below
  // - never taken from anything an outside page could control.
  const next = (location.state as { next?: string } | null)?.next ?? '/';
  const [usernameOrEmail, setUsernameOrEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [showForgot, setShowForgot] = useState(false);
  const [forgotValue, setForgotValue] = useState('');
  const [forgotSubmitting, setForgotSubmitting] = useState(false);
  const [forgotSent, setForgotSent] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const { user, passwordResetRequestCleared } = await login(usernameOrEmail, password);
      // Admin hat das Passwort zurückgesetzt - vor allem anderen muss jetzt
      // ein neues gesetzt werden, bevor der ursprüngliche Deep-Link greift.
      navigate(user.mustChangePassword ? '/profil' : next, {
        state: {
          ...(user.mustChangePassword ? { forcePasswordChange: true } : {}),
          ...(passwordResetRequestCleared ? { passwordResetRequestCleared: true } : {}),
        },
      });
    } catch (err) {
      setError(describeLoginError(err));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleForgotSubmit(event: FormEvent) {
    event.preventDefault();
    setForgotSubmitting(true);
    try {
      await apiFetch('/auth/request-password-reset', { method: 'POST', body: { usernameOrEmail: forgotValue } });
    } catch {
      // Antwort ist bewusst unabhängig vom Ergebnis, siehe Hinweistext unten.
    } finally {
      setForgotSubmitting(false);
      setForgotSent(true);
    }
  }

  return (
    <div className="app-shell">
      <div className="sh-card">
        <Link className="sh-back" to="/">
          &larr; Zurück
        </Link>
        <h2>Anmelden</h2>

        {error && <div className="sh-error" style={{ marginBottom: 14 }}>{error}</div>}

        <form className="sh-form" onSubmit={handleSubmit}>
          <div className="sh-field">
            <label htmlFor="usernameOrEmail">Benutzername oder E-Mail</label>
            <input
              id="usernameOrEmail"
              required
              autoFocus
              value={usernameOrEmail}
              onChange={(e) => setUsernameOrEmail(e.target.value)}
            />
          </div>
          <div className="sh-field">
            <label htmlFor="password">Passwort</label>
            <input id="password" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          <button className="sh-submit" type="submit" disabled={submitting}>
            {submitting ? 'Anmelden…' : 'Anmelden'}
          </button>
        </form>

        <div className="sh-footer-link">
          <button
            type="button"
            onClick={() => setShowForgot((v) => !v)}
            style={{
              background: 'none',
              border: 'none',
              padding: 0,
              font: 'inherit',
              color: 'var(--adolar-cyan)',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Passwort vergessen?
          </button>
        </div>

        {showForgot && (
          <div style={{ marginTop: 10 }}>
            {forgotSent ? (
              <div className="sh-info">
                Falls es zu diesen Angaben ein Konto gibt, wurde die Anfrage beim Admin hinterlegt. Der Admin setzt
                das Passwort zurück und teilt dir ein Temp-Passwort mit.
              </div>
            ) : (
              <form className="sh-form" onSubmit={handleForgotSubmit}>
                <div className="sh-field">
                  <label htmlFor="forgotValue">Benutzername oder E-Mail</label>
                  <input
                    id="forgotValue"
                    required
                    value={forgotValue}
                    onChange={(e) => setForgotValue(e.target.value)}
                  />
                </div>
                <button className="sh-submit" type="submit" disabled={forgotSubmitting}>
                  {forgotSubmitting ? 'Sendet…' : 'Reset beim Admin anfragen'}
                </button>
              </form>
            )}
          </div>
        )}

        <div className="sh-footer-link">
          Noch kein Konto? <Link to="/register">Registrieren</Link>
        </div>
      </div>
    </div>
  );
}

function describeLoginError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 401) return 'Benutzername/E-Mail oder Passwort ist falsch.';
    if (err.status === 403) return 'Dieses Konto ist nicht aktiv (gesperrt oder noch nicht freigeschaltet).';
    const body = err.body as { error?: string; message?: string } | null;
    return body?.message ?? body?.error ?? 'Anmeldung fehlgeschlagen.';
  }
  return 'Backend nicht erreichbar. Bitte später erneut versuchen.';
}
