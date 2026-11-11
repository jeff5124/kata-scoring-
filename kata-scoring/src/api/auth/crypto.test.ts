import { describe, expect, it } from 'vitest';
import { hashPassword, signToken, verifyPassword, verifyToken } from './crypto.js';

describe('mots de passe', () => {
  it('vérifie le bon mot de passe, refuse les autres, sel différent à chaque hash', async () => {
    const h = await hashPassword('secret-123');
    expect(await verifyPassword('secret-123', h)).toBe(true);
    expect(await verifyPassword('secret-124', h)).toBe(false);
    expect(await verifyPassword('x', null)).toBe(false);
    expect(await verifyPassword('x', 'plaintext')).toBe(false);
    expect(await hashPassword('secret-123')).not.toBe(h);
  });
});

describe('jetons', () => {
  const secret = 'secret-de-test-0123456789';
  const payload = { sub: 'u1', role: 'JUDGE', off: 'o1', exp: Math.floor(Date.now() / 1000) + 60 };
  it('accepte un jeton valide', () => {
    expect(verifyToken(signToken(payload, secret), secret)).toEqual(payload);
  });
  it('refuse : mauvais secret, charge modifiée, jeton expiré, format invalide', () => {
    const t = signToken(payload, secret);
    expect(verifyToken(t, 'autre-secret-0123456789')).toBeNull();
    const [, sig] = t.split('.');
    const evil = Buffer.from(JSON.stringify({ ...payload, role: 'ADMIN' })).toString('base64url');
    expect(verifyToken(`${evil}.${sig}`, secret)).toBeNull();
    expect(verifyToken(t, secret, Date.now() + 120_000)).toBeNull();
    expect(verifyToken('abc', secret)).toBeNull();
    expect(verifyToken('a.b.c', secret)).toBeNull();
  });
});
