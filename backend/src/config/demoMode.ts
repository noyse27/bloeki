// DEMO_MODE gates every demo-only behavior in this codebase (see
// services/demoReset.ts, middleware/demoBlock.ts, routes/demo.ts). It
// mirrors the existing BETA_DEBUG_LOGGING convention: a plain runtime env
// var, read once at module load, no separate "environments" framework.
//
// Demo mode is meant for a deployment that is isolated from any real
// instance (its own docker-compose project/DB, see docker-compose.demo.yml)
// - it is NOT a flag that is safe to flip on an existing, populated
// database. services/demoReset.ts's assertDemoSafeToManage() enforces that
// at startup.
export const DEMO_MODE = process.env.DEMO_MODE === 'true';

const DEFAULT_RESET_MINUTES = 60;
const MIN_RESET_MINUTES = 5;
const MAX_RESET_MINUTES = 1440;

function parseResetMinutes(): number {
  const raw = Number(process.env.DEMO_RESET_MINUTES);
  if (!Number.isFinite(raw)) return DEFAULT_RESET_MINUTES;
  return Math.min(MAX_RESET_MINUTES, Math.max(MIN_RESET_MINUTES, Math.trunc(raw)));
}

export const DEMO_RESET_MINUTES = parseResetMinutes();

// Fixed, publicly-documented demo credentials (see docs/demo.md and
// DemoBanner.tsx) - safe only because a demo deployment never holds real
// data and resets on its own schedule. Overridable so an operator running
// several demo stacks can tell them apart, but there is no expectation of
// secrecy here.
export const DEMO_ADMIN_USERNAME = process.env.DEMO_ADMIN_USERNAME ?? 'demo-admin';
export const DEMO_ADMIN_EMAIL = process.env.DEMO_ADMIN_EMAIL ?? 'demo-admin@example.invalid';
export const DEMO_ADMIN_PASSWORD = process.env.DEMO_ADMIN_PASSWORD ?? 'bloeki-demo';

// A standing, effectively-unlimited invite code so demo visitors can
// register without an operator handing out codes by hand. Not a secret -
// it's printed on the login page by DemoBanner.tsx.
export const DEMO_INVITE_CODE = process.env.DEMO_INVITE_CODE ?? 'demo';
