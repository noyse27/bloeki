import { useEffect, useState } from 'react';
import { apiFetch } from '../api';
import './DemoBanner.css';

interface DemoStatus {
  active: boolean;
  resetIntervalMinutes?: number;
  nextResetAt?: string | null;
  standingInviteCode?: string;
  adminUsername?: string;
  adminPassword?: string;
}

// Polled once on mount: DEMO_MODE is a backend env var (see
// config/demoMode.ts), so the frontend has no build-time way to know
// whether it's being served by a demo deployment or a real one - the same
// built frontend image can point at either. Returns { active: false } on a
// normal deployment, in which case this renders nothing.
export function DemoBanner() {
  const [status, setStatus] = useState<DemoStatus | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiFetch<DemoStatus>('/demo/status')
      .then((result) => {
        if (!cancelled) setStatus(result);
      })
      .catch(() => {
        // A failed status check should never block the app from rendering -
        // worst case, a demo deployment briefly shows without its banner.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!status?.active) return null;

  return (
    <div className="demo-banner" role="status">
      <p>
        Dies ist eine öffentliche Demo-Instanz von blöki mit erfundenen Testdaten. Alle Inhalte werden
        {status.resetIntervalMinutes ? ` alle ${status.resetIntervalMinutes} Minuten` : ' regelmäßig'}{' '}
        automatisch zurückgesetzt.
      </p>
      <p>
        Registrieren mit Einladungscode <code>{status.standingInviteCode}</code>, oder als Admin anmelden:{' '}
        <code>{status.adminUsername}</code> / <code>{status.adminPassword}</code>.
      </p>
    </div>
  );
}
