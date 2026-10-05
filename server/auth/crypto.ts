import { randomBytes, scrypt, createHash, timingSafeEqual } from 'node:crypto';

const params = { N: 131072, r: 8, p: 1, maxmem: 192 * 1024 * 1024 };
function derive(password: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) => scrypt(password, salt, 64, params, (err, key) => err ? reject(err) : resolve(key)));
}

export const digest = (value: string) => createHash('sha256').update(value).digest('hex');
export const newToken = () => randomBytes(32).toString('base64url');
export function equalSecrets(a: string, b: string) {
  return timingSafeEqual(Buffer.from(digest(a), 'hex'), Buffer.from(digest(b), 'hex'));
}
export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString('hex');
  return `scrypt$${salt}$${(await derive(password, salt)).toString('hex')}`;
}
export async function verifyPassword(password: string, stored: string) {
  const [algorithm, salt, hash] = stored.split('$');
  if (algorithm !== 'scrypt' || !salt || !hash || hash.length !== 128) return false;
  return timingSafeEqual(await derive(password, salt), Buffer.from(hash, 'hex'));
}
// A fixed, valid hash shape makes an unknown email perform the same expensive derivation.
export const dummyHash = `scrypt$${'0'.repeat(32)}$${'0'.repeat(128)}`;
