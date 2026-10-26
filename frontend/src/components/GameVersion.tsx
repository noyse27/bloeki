import { useEffect, useState } from 'react';
import { apiFetch } from '../api';
import { GAME_VERSION } from '../buildInfo';

export function GameVersion() {
  const [version, setVersion] = useState(GAME_VERSION);

  useEffect(() => {
    let cancelled = false;
    apiFetch<{ buildVersion?: string }>('/health')
      .then((health) => {
        if (!cancelled && health.buildVersion) setVersion(health.buildVersion);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  return <div className="pb-build-version">Spielversion: {version}</div>;
}
