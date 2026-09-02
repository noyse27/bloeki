import { resolveMaxUses } from '../../src/routes/invites';

// Regression test for: a delegated (non-admin) user with invite rights
// could set maxUses on their own invite arbitrarily high, which let one
// invite code register unlimited users - defeating the monthly quota on
// how many invite codes they're allowed to create in the first place.
// Only admins may choose maxUses; everyone else gets a fixed value,
// enforced server-side regardless of what the client sends.
describe('resolveMaxUses', () => {
  it('ignores the requested value entirely for non-admins', () => {
    expect(resolveMaxUses(false, 9999)).toBe(1);
    expect(resolveMaxUses(false, 1)).toBe(1);
    expect(resolveMaxUses(false, undefined)).toBe(1);
    expect(resolveMaxUses(false, -5)).toBe(1);
  });

  it('lets admins choose any positive integer', () => {
    expect(resolveMaxUses(true, 50)).toBe(50);
    expect(resolveMaxUses(true, 1)).toBe(1);
  });

  it('falls back to 1 for admins on an invalid requested value', () => {
    expect(resolveMaxUses(true, 0)).toBe(1);
    expect(resolveMaxUses(true, -1)).toBe(1);
    expect(resolveMaxUses(true, undefined)).toBe(1);
    expect(resolveMaxUses(true, 'lots')).toBe(1);
  });
});
