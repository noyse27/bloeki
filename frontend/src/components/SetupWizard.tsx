import { FormEvent, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { apiFetch, ApiError } from '../api';

// Browser-Onboarding-Assistent: Admin-Anlage, erste Einladung, Testtisch,
// Funktionstest. Anders als songster gibt es keinen "Musikdaten"-Schritt -
// bloeki hat keinen externen Video-Lieferant zu konfigurieren, die
// Trailer-Bibliothek fuellt sich automatisch, sobald tools/snippet-cutter
// Trailer in den vom Backend gemounteten Ordner geschnitten hat (siehe
// backend/src/services/trailerScan.ts).
type WizardStep =
  | 'loading'
  | 'reauth'
  | 'createAdmin'
  | 'createInvite'
  | 'createTestTable'
  | 'selfTest'
  | 'done'
  | 'error';

interface SelfTestResult {
  healthy: boolean;
  checks: { database: boolean; trailerPool: boolean; roundLogic: boolean };
}

export function SetupWizard() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [step, setStep] = useState<WizardStep>('loading');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [adminForm, setAdminForm] = useState({ username: '', email: '', password: '', setupToken: '' });

  // Convenience-Pfad (siehe backend/src/services/setupToken.ts's geloggten
  // Link): fuellt den Token aus ?token=... vor, damit der Betreiber nicht
  // von Hand copy-pasten muss. Wird sofort aus der sichtbaren URL entfernt
  // - der Token ist Einmal-gueltig und soll nicht laenger als noetig in
  // Browser-Verlauf/Screenshots stehen.
  useEffect(() => {
    const tokenFromUrl = searchParams.get('token');
    if (!tokenFromUrl) return;
    setAdminForm((form) => ({ ...form, setupToken: tokenFromUrl }));
    window.history.replaceState(null, '', window.location.pathname);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [adminToken, setAdminToken] = useState<string | null>(null);
  const [adminUsername, setAdminUsername] = useState<string | null>(null);

  // Fortsetzen nach einem Seiten-Reload: aus /setup/status wissen wir,
  // welcher Schritt als naechstes kommt, aber das Admin-Bearer-Token lebte
  // nur im Speicher, also erst neu anmelden (siehe handleReauth unten).
  const [pendingStep, setPendingStep] = useState<WizardStep | null>(null);
  const [reauthForm, setReauthForm] = useState({ usernameOrEmail: '', password: '' });

  const [inviteCode, setInviteCode] = useState<string | null>(null);
  const [testTableName, setTestTableName] = useState<string | null>(null);
  const [selfTest, setSelfTest] = useState<SelfTestResult | null>(null);

  useEffect(() => {
    apiFetch<{ adminExists: boolean }>('/setup/status')
      .then((status) => {
        if (!status.adminExists) {
          setStep('createAdmin');
          return;
        }
        setPendingStep('createInvite');
        setStep('reauth');
      })
      .catch(() => {
        setErrorMessage('Backend nicht erreichbar. Bitte Compose-Setup pruefen.');
        setStep('error');
      });
  }, []);

  async function handleReauth(event: FormEvent) {
    event.preventDefault();
    setErrorMessage(null);
    try {
      const login = await apiFetch<{ accessToken: string; user: { username: string } }>('/auth/login', {
        method: 'POST',
        body: reauthForm,
      });
      setAdminToken(login.accessToken);
      setAdminUsername(login.user.username);
      setStep(pendingStep ?? 'createInvite');
    } catch (err) {
      setErrorMessage(describeError(err, 'Anmeldung fehlgeschlagen.'));
    }
  }

  async function handleCreateAdmin(event: FormEvent) {
    event.preventDefault();
    setErrorMessage(null);
    try {
      await apiFetch('/setup/bootstrap', { method: 'POST', body: adminForm });
      const login = await apiFetch<{ accessToken: string; user: { username: string } }>(
        '/auth/login',
        { method: 'POST', body: { usernameOrEmail: adminForm.username, password: adminForm.password } },
      );
      setAdminToken(login.accessToken);
      setAdminUsername(login.user.username);
      setStep('createInvite');
    } catch (err) {
      setErrorMessage(describeError(err, 'Admin-Anlage fehlgeschlagen.'));
    }
  }

  async function handleCreateInvite() {
    setErrorMessage(null);
    try {
      const invite = await apiFetch<{ code: string }>('/invites', {
        method: 'POST',
        body: { maxUses: 5, expiresInDays: 14 },
        token: adminToken ?? undefined,
      });
      setInviteCode(invite.code);
      setStep('createTestTable');
    } catch (err) {
      setErrorMessage(describeError(err, 'Einladung konnte nicht erstellt werden.'));
    }
  }

  async function handleCreateTestTable() {
    setErrorMessage(null);
    try {
      const table = await apiFetch<{ name: string }>('/tables', {
        method: 'POST',
        body: { name: 'Testtisch', visibility: 'private' },
        token: adminToken ?? undefined,
      });
      setTestTableName(table.name);
      setStep('selfTest');
    } catch (err) {
      setErrorMessage(describeError(err, 'Testtisch konnte nicht erstellt werden.'));
    }
  }

  async function handleSelfTest() {
    setErrorMessage(null);
    try {
      const result = await apiFetch<SelfTestResult>('/setup/self-test', {
        method: 'POST',
        token: adminToken ?? undefined,
      });
      setSelfTest(result);
      setStep('done');
    } catch (err) {
      // Ein 503 mit checks-Body ist ein abgeschlossener Funktionstest, der
      // eine echte Luecke gefunden hat (z.B. noch keine Trailer) - Detail
      // zeigen statt leerer Fehlermeldung.
      if (err instanceof ApiError && err.body && typeof err.body === 'object' && 'checks' in err.body) {
        setSelfTest(err.body as SelfTestResult);
        setStep('done');
        return;
      }
      setErrorMessage(describeError(err, 'Funktionstest fehlgeschlagen.'));
    }
  }

  return (
    <main className="wizard">
      <h1 className="bloeki-heading wizard-title">blöki Setup</h1>

      {errorMessage && <p className="wizard-error">{errorMessage}</p>}

      {step === 'loading' && <p>Lade Setup-Status...</p>}

      {step === 'reauth' && (
        <section>
          <h2 className="bloeki-heading">Weiter geht's</h2>
          <p>Ein Admin-Account existiert bereits. Zum Fortsetzen bitte nochmal anmelden.</p>
          <form onSubmit={handleReauth} className="wizard-form">
            <label>
              Benutzername oder E-Mail
              <input
                required
                autoFocus
                value={reauthForm.usernameOrEmail}
                onChange={(e) => setReauthForm({ ...reauthForm, usernameOrEmail: e.target.value })}
              />
            </label>
            <label>
              Passwort
              <input
                type="password"
                required
                value={reauthForm.password}
                onChange={(e) => setReauthForm({ ...reauthForm, password: e.target.value })}
              />
            </label>
            <button type="submit">Anmelden</button>
          </form>
        </section>
      )}

      {step === 'createAdmin' && (
        <section>
          <h2 className="bloeki-heading">Schritt 1 von 3: Admin anlegen</h2>
          <form onSubmit={handleCreateAdmin} className="wizard-form">
            <label>
              Setup-Token
              <input
                required
                autoFocus
                value={adminForm.setupToken}
                onChange={(e) => setAdminForm({ ...adminForm, setupToken: e.target.value })}
              />
            </label>
            <p style={{ fontSize: '0.85em', opacity: 0.8 }}>
              Steht in den Backend-Logs ("SETUP TOKEN"), z. B. mit <code>docker compose logs backend</code>.
            </p>
            <label>
              Benutzername
              <input
                required
                value={adminForm.username}
                onChange={(e) => setAdminForm({ ...adminForm, username: e.target.value })}
              />
            </label>
            <label>
              E-Mail
              <input
                type="email"
                required
                value={adminForm.email}
                onChange={(e) => setAdminForm({ ...adminForm, email: e.target.value })}
              />
            </label>
            <label>
              Passwort
              <input
                type="password"
                required
                minLength={8}
                value={adminForm.password}
                onChange={(e) => setAdminForm({ ...adminForm, password: e.target.value })}
              />
            </label>
            <button type="submit">Admin anlegen</button>
          </form>
        </section>
      )}

      {step === 'createInvite' && (
        <section>
          <h2 className="bloeki-heading">Schritt 2 von 3: Erste Einladung</h2>
          <p>Admin "{adminUsername}" angelegt.</p>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button onClick={handleCreateInvite}>Einladung erstellen</button>
            <button
              type="button"
              onClick={() => {
                setErrorMessage(null);
                setStep('createTestTable');
              }}
            >
              Überspringen
            </button>
          </div>
        </section>
      )}

      {step === 'createTestTable' && (
        <section>
          <h2 className="bloeki-heading">Schritt 3 von 3: Testtisch</h2>
          {inviteCode && (
            <p>
              Einladungscode: <code>{inviteCode}</code>
            </p>
          )}
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button onClick={handleCreateTestTable}>Testtisch erstellen</button>
            <button
              type="button"
              onClick={() => {
                setErrorMessage(null);
                setStep('selfTest');
              }}
            >
              Überspringen
            </button>
          </div>
        </section>
      )}

      {step === 'selfTest' && (
        <section>
          <h2 className="bloeki-heading">Funktionstest</h2>
          <p>{testTableName ? `Testtisch "${testTableName}" erstellt.` : 'Kein Testtisch angelegt.'}</p>
          <button onClick={handleSelfTest}>Funktionstest starten</button>
        </section>
      )}

      {step === 'done' && selfTest && (
        <section>
          <h2 className="bloeki-heading">Setup abgeschlossen</h2>
          <ul>
            <li>Datenbank: {selfTest.checks.database ? 'OK' : 'Fehler'}</li>
            <li>
              Trailer-Bibliothek:{' '}
              {selfTest.checks.trailerPool
                ? 'OK'
                : 'leer - tools/snippet-cutter ausfuehren und auf den naechsten Scan warten'}
            </li>
            <li>Rundenlogik: {selfTest.checks.roundLogic ? 'OK' : 'Fehler'}</li>
          </ul>
          <p>{selfTest.healthy ? 'Alle Funktionstests erfolgreich.' : 'Bitte offene Punkte pruefen.'}</p>
          <button onClick={() => navigate('/')}>Fertig</button>
        </section>
      )}
    </main>
  );
}

function describeError(err: unknown, fallback: string): string {
  if (err instanceof ApiError) {
    const body = err.body as { error?: string; message?: string } | null;
    return body?.message ?? body?.error ?? fallback;
  }
  return fallback;
}
