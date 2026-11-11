import { createHmac, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

const scryptAsync = (password: string, salt: Buffer): Promise<Buffer> =>
  new Promise((resolve, reject) => scrypt(password, salt, 64, (err, key) => (err ? reject(err) : resolve(key))));

/** Hash `scrypt$<sel>$<clé>` (base64). */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt);
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  const parts = stored?.split('$');
  if (!parts || parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const expected = Buffer.from(parts[2]!, 'base64');
  const actual = await scryptAsync(password, Buffer.from(parts[1]!, 'base64'));
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export interface TokenPayload {
  /** app_users.id */
  sub: string;
  role: string;
  /** officials.id si l'utilisateur est un juge */
  off: string | null;
  /** expiration, en secondes epoch */
  exp: number;
}

const b64 = (s: string | Buffer) => Buffer.from(s).toString('base64url');

/** Jeton compact `<payload>.<signature>` signé HMAC-SHA256. */
export function signToken(payload: TokenPayload, secret: string): string {
  const body = b64(JSON.stringify(payload));
  return `${body}.${createHmac('sha256', secret).update(body).digest('base64url')}`;
}

export function verifyToken(token: string, secret: string, now = Date.now()): TokenPayload | null {
  const [body, sig, extra] = token.split('.');
  if (!body || !sig || extra !== undefined) return null;
  const expected = createHmac('sha256', secret).update(body).digest();
  const given = Buffer.from(sig, 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString()) as TokenPayload;
    return typeof p.exp === 'number' && p.exp * 1000 > now && typeof p.sub === 'string' ? p : null;
  } catch {
    return null;
  }
}
