import crypto from 'crypto';

// Verwechslungsfreie Zeichen: kein 0/O/o, 1/I/l. 16 Zeichen liefern trotz
// des reduzierten Alphabets deutlich mehr Entropie als das bisherige
// 12-stellige Base64URL-Passwort und lassen sich sicherer abtippen.
const TEMPORARY_PASSWORD_ALPHABET = [
  'ABCDEFGHJKLMNPQRSTUVWXYZ',
  'abcdefghijkmnpqrstuvwxyz',
  '23456789',
].join('');

export function generateTemporaryPassword(length = 16): string {
  let password = '';
  for (let index = 0; index < length; index += 1) {
    password += TEMPORARY_PASSWORD_ALPHABET[crypto.randomInt(TEMPORARY_PASSWORD_ALPHABET.length)];
  }
  return password;
}
