import { randomBytes } from 'node:crypto';

/** Keep ordinary credentials out of the game plugin's reserved namespace. */
export function generateToken(randomSource = randomBytes) {
  let token;
  do { token = randomSource(32).toString('base64url'); } while (/^gpk_/i.test(token));
  return token;
}
