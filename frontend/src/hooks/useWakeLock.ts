import { useEffect } from 'react';

// Hostmodus: keeps the screen from locking while a match is active, on
// every device involved (the shared Anzeigegerät and every player's own
// phone alike) - not just the shared screen, since a phone sitting idle
// between guesses locks just as easily. No manual toggle: it tracks
// `active` directly instead, since there is nothing meaningful to ask the
// user to control here.
//
// Silently does nothing where the Wake Lock API isn't available (older iOS
// Safari) - there is no meaningful fallback, and failing loudly would just
// be noise for something outside the app's control.
export function useWakeLock(active: boolean): void {
  useEffect(() => {
    if (!active || !('wakeLock' in navigator)) return;

    let lock: WakeLockSentinel | null = null;
    let cancelled = false;

    navigator.wakeLock
      .request('screen')
      .then((sentinel) => {
        if (cancelled) {
          sentinel.release().catch(() => undefined);
          return;
        }
        lock = sentinel;
      })
      .catch(() => undefined);

    // The OS releases the lock whenever the tab is backgrounded - re-acquire
    // it once the player switches back, or it would silently stay off for
    // the rest of the match after the first tab switch.
    function handleVisibilityChange() {
      if (document.visibilityState !== 'visible' || lock) return;
      navigator.wakeLock
        .request('screen')
        .then((sentinel) => {
          if (cancelled) {
            sentinel.release().catch(() => undefined);
            return;
          }
          lock = sentinel;
        })
        .catch(() => undefined);
    }
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      lock?.release().catch(() => undefined);
    };
  }, [active]);
}
