import { FormEvent, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import './pages.css';
import { useAuth } from '../auth/AuthContext';
import { apiFetch, ApiError } from '../api';

export function RegisterPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [inviteCode, setInviteCode] = useState(searchParams.get('invite') ?? '');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      // FR-001: registration is invite-only.
      await apiFetch('/auth/register', { method: 'POST', body: { username, email, password, inviteCode } });
      // Register doesn't return a session token, so log in right after with
      // the same credentials to land the user directly on the home screen.
      await login(username, password);
      navigate('/');
    } catch (err) {
      setError(describeRegisterError(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="app-shell">
      <div className="sh-card">
        <Link className="sh-back" to="/">
          &larr; Zurück
        </Link>
        <h2>Registrieren</h2>

        {error && <div className="sh-error" style={{ marginBottom: 14 }}>{error}</div>}

        <form className="sh-form" onSubmit={handleSubmit}>
          <div className="sh-field">
            <label htmlFor="inviteCode">Einladungscode</label>
            <input id="inviteCode" required value={inviteCode} onChange={(e) => setInviteCode(e.target.value)} />
          </div>
          <div className="sh-field">
            <label htmlFor="username">Benutzername</label>
            <input id="username" required autoFocus value={username} onChange={(e) => setUsername(e.target.value)} />
          </div>
          <div className="sh-field">
            <label htmlFor="email">E-Mail</label>
            <input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="sh-field">
            <label htmlFor="password">Passwort</label>
            <input
              id="password"
              type="password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <button className="sh-submit" type="submit" disabled={submitting}>
            {submitting ? 'Registrieren…' : 'Registrieren'}
          </button>
        </form>

        <div className="sh-footer-link">
          Schon ein Konto? <Link to="/login">Anmelden</Link>
        </div>
      </div>
    </div>
  );
}

function describeRegisterError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 409) return 'Benutzername oder E-Mail wird bereits verwendet.';
    if (err.status === 400) {
      const body = err.body as { error?: string } | null;
      if (body?.error === 'invalid invite code') return 'Dieser Einladungscode ist ungültig.';
      if (body?.error === 'invite code is not usable') return 'Dieser Einladungscode ist abgelaufen, deaktiviert oder aufgebraucht.';
    }
    const body = err.body as { error?: string; message?: string } | null;
    return body?.message ?? body?.error ?? 'Registrierung fehlgeschlagen.';
  }
  return 'Backend nicht erreichbar. Bitte später erneut versuchen.';
}
