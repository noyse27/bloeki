import { generateTemporaryPassword } from '../../src/services/temporaryPassword';

describe('generateTemporaryPassword', () => {
  it('creates readable high-entropy passwords without ambiguous characters', () => {
    const passwords = new Set(Array.from({ length: 100 }, () => generateTemporaryPassword()));
    expect(passwords.size).toBe(100);
    for (const password of passwords) {
      expect(password).toHaveLength(16);
      expect(password).toMatch(/^[A-HJ-NP-Za-km-np-z2-9]+$/);
      expect(password).not.toMatch(/[01IOlo]/);
    }
  });
});
