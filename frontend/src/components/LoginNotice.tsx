import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

interface LoginNavigationState {
  passwordResetRequestCleared?: boolean;
  [key: string]: unknown;
}

export function LoginNotice() {
  const location = useLocation();
  const navigate = useNavigate();
  const [visible, setVisible] = useState(false);
  const navigationState = location.state as LoginNavigationState | null;

  useEffect(() => {
    if (!navigationState?.passwordResetRequestCleared) return;
    setVisible(true);
    const remainingState = { ...navigationState };
    delete remainingState.passwordResetRequestCleared;
    navigate(`${location.pathname}${location.search}${location.hash}`, {
      replace: true,
      state: Object.keys(remainingState).length > 0 ? remainingState : null,
    });
  }, [location.hash, location.pathname, location.search, navigate, navigationState]);

  useEffect(() => {
    if (!visible) return;
    const timer = window.setTimeout(() => setVisible(false), 8000);
    return () => window.clearTimeout(timer);
  }, [visible]);

  if (!visible) return null;
  return (
    <div
      className="sh-info"
      role="status"
      aria-live="polite"
      style={{ position: 'fixed', zIndex: 20000, top: 18, left: '50%', transform: 'translateX(-50%)', width: 'min(620px, calc(100% - 32px))', boxShadow: '0 12px 36px rgba(0,0,0,.35)' }}
    >
      Deine offene Passwort-Reset-Anfrage wurde durch die erfolgreiche Anmeldung gelöscht.
      <button type="button" aria-label="Meldung schließen" onClick={() => setVisible(false)} style={{ float: 'right', marginLeft: 16 }}>
        ×
      </button>
    </div>
  );
}
