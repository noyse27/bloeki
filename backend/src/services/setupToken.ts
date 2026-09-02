import crypto from 'crypto';

// K-02 mitigation: /setup/bootstrap creates the first admin account and is
// necessarily unauthenticated (there's no admin yet to log in as). Without
// this, whoever reaches the endpoint first - not necessarily the operator -
// becomes admin. SETUP_TOKEN can be set explicitly for scripted deploys;
// otherwise a random one is generated once at process start and logged, so
// the operator (who can read the container logs) is the only one who can
// complete setup.
let currentToken: string | null = process.env.SETUP_TOKEN ?? crypto.randomBytes(24).toString('hex');
let consumed = false;

// Convenience only (not a trust boundary): lets the operator click straight
// into the pre-filled wizard step instead of copy-pasting the token by
// hand. Defaults to localhost since that's correct for the common
// single-machine case; FRONTEND_URL can be set to the LAN address/hostname
// when opening the wizard from another device is expected.
const frontendUrl = (process.env.FRONTEND_URL ?? 'http://localhost:5173').replace(/\/$/, '');
const setupLink = `${frontendUrl}/setup?token=${currentToken}`;

console.log('='.repeat(72));
console.log('SETUP TOKEN (required to create the first admin account):');
console.log(`  ${currentToken}`);
console.log('Open this link to have it filled in automatically (adjust the host if');
console.log("you're opening the wizard from a different device on the network):");
console.log(`  ${setupLink}`);
console.log('The token stops working after the first admin account is created.');
console.log('='.repeat(72));

export function verifySetupToken(candidate: unknown): boolean {
  if (consumed || currentToken === null || typeof candidate !== 'string') return false;
  const expected = Buffer.from(currentToken);
  const actual = Buffer.from(candidate);
  if (expected.length !== actual.length) return false;
  return crypto.timingSafeEqual(expected, actual);
}

// Called after a successful bootstrap so the token can never be reused,
// even if SETUP_TOKEN stays set in the environment across a restart.
export function consumeSetupToken(): void {
  consumed = true;
  currentToken = null;
}

// Test-only: integration tests exercise the real /setup/bootstrap route
// end-to-end, so they need the token the same way an operator reading the
// startup log would get it - there's no separate "test mode" bypass.
export function getSetupTokenForTests(): string {
  if (currentToken === null) throw new Error('setup token already consumed');
  return currentToken;
}
