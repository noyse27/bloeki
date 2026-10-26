import { useEffect } from 'react';
import { API_BASE_URL } from '../api';
import { enableBetaDebugLogging, flushClientDebugEvents } from '../debugLogging';

const STATUS_POLL_MS = 5_000;
const EVENT_FLUSH_MS = 5_000;

export function DebugLoggingSync() {
  useEffect(() => {
    let stopped = false;

    const syncStatus = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/debug/status`, { cache: 'no-store' });
        if (!response.ok) return;
        const status = await response.json() as { enabled?: boolean };
        if (!stopped && typeof status.enabled === 'boolean') enableBetaDebugLogging(status.enabled);
      } catch {
        // Eine voruebergehend fehlende Statusabfrage darf das Spiel nicht stoeren.
      }
    };
    const flush = () => { void flushClientDebugEvents(); };
    const onPageHide = () => { void flushClientDebugEvents(true); };

    void syncStatus();
    const statusTimer = window.setInterval(syncStatus, STATUS_POLL_MS);
    const flushTimer = window.setInterval(flush, EVENT_FLUSH_MS);
    window.addEventListener('pagehide', onPageHide);
    document.addEventListener('visibilitychange', onPageHide);

    return () => {
      stopped = true;
      window.clearInterval(statusTimer);
      window.clearInterval(flushTimer);
      window.removeEventListener('pagehide', onPageHide);
      document.removeEventListener('visibilitychange', onPageHide);
    };
  }, []);

  return null;
}
