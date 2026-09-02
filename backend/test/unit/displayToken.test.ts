import jwt from 'jsonwebtoken';
import { JWT_SECRET } from '../../src/middleware/auth';
import { issueDisplayToken, verifyDisplayToken } from '../../src/services/displayToken';

describe('displayToken', () => {
  it('issues a token with no `sub` claim, so it can never be mistaken for an app_user session', () => {
    const token = issueDisplayToken('11111111-1111-1111-1111-111111111111');
    const payload = jwt.decode(token) as Record<string, unknown>;

    expect(payload.sub).toBeUndefined();
    expect(payload.sessionVersion).toBeUndefined();
    expect(payload.kind).toBe('display');
    expect(payload.tableId).toBe('11111111-1111-1111-1111-111111111111');
  });

  it('round-trips a valid token back to its tableId', () => {
    const token = issueDisplayToken('table-abc');
    expect(verifyDisplayToken(token)).toEqual({ tableId: 'table-abc', hostDeviceId: null });
  });

  it('round-trips a host-device-bound display token', () => {
    const token = issueDisplayToken('table-abc', 'device-123');
    expect(verifyDisplayToken(token)).toEqual({ tableId: 'table-abc', hostDeviceId: 'device-123' });
  });

  it('rejects a garbage token', () => {
    expect(verifyDisplayToken('not-a-real-token')).toBeNull();
  });

  it('rejects a normal player-session token, even though both are signed with the same secret', () => {
    // This is the regression the whole feature exists to prevent: a
    // display token must never be accepted where a player token is
    // expected, or vice versa - see socketServer.ts's io.use branch.
    const playerToken = jwt.sign({ sub: 'user-1', role: 'user', sessionVersion: 1 }, JWT_SECRET, {
      expiresIn: 3600,
    });
    expect(verifyDisplayToken(playerToken)).toBeNull();
  });

  it('rejects a token signed with a different secret', () => {
    const forged = jwt.sign({ kind: 'display', tableId: 'table-abc' }, 'wrong-secret', { expiresIn: 3600 });
    expect(verifyDisplayToken(forged)).toBeNull();
  });
});
