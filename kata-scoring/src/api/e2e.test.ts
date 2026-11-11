import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import { io, type Socket } from 'socket.io-client';
import { AppModule } from './app.module.js';
import { AuthService } from './auth/auth.service.js';
import { Database } from './database.js';
import { cleanup, makeFixture, type Fixture } from './bouts/test-fixture.js';

const url = process.env.TEST_DATABASE_URL;
const AKA = ['7.6', '7.5', '7.6', '7.1', '7.1', '7.7', '7.2'];
const AO = ['8.0', '7.3', '7.4', '7.3', '7.4', '7.3', '7.5'];
const PASSWORD = 'motdepasse-test';

describe.skipIf(!url)('API REST + Socket.IO (authentifiée)', () => {
  let app: INestApplication;
  let base: string;
  let f: Fixture;
  let auth: AuthService;
  const sockets: Socket[] = [];
  const stamp = Date.now();

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    process.env.AUTH_SECRET = 'secret-de-test-0123456789';
    app = await NestFactory.create(AppModule, { logger: false });
    await app.listen(0, '127.0.0.1');
    base = (await app.getUrl()).replace('[::1]', '127.0.0.1');
    auth = app.get(AuthService);
    f = await makeFixture(app.get(Database).pool);
  });

  afterAll(async () => {
    sockets.forEach((s) => s.close());
    await cleanup(app.get(Database).pool, [f]);
    await app.get(Database).pool.query('DELETE FROM app_users WHERE email LIKE $1', [`%${stamp}@test.local`]);
    await app.close();
  });

  const call = async (method: string, path: string, token?: string, body?: unknown) => {
    const r = await fetch(`${base}${path}`, {
      method,
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
    });
    return { status: r.status, body: await r.json().catch(() => null) };
  };
  const login = async (email: string) => (await call('POST', '/auth/login', undefined, { email, password: PASSWORD })).body.token as string;
  const user = (name: string, role: string, officialId?: string) =>
    auth.createUser({ email: `${name}-${stamp}@test.local`, password: PASSWORD, role: role as never, officialId, competitionId: f.competitionId });
  const connect = async (token?: string) => {
    const s = io(`${base}/live`, { transports: ['websocket'], auth: token ? { token } : {} });
    sockets.push(s);
    await new Promise<void>((res, rej) => { s.on('connect', res); s.on('connect_error', rej); });
    return s;
  };
  const emit = (s: Socket, ev: string, payload: unknown) => s.emitWithAck(ev, payload) as Promise<any>;

  it('contrôle d\'accès : jeton obligatoire, rôles, jeton falsifié, mauvais mot de passe', async () => {
    await user('table', 'TECHNICIAN');
    await user('judge-x', 'JUDGE', f.judges[0]);
    const table = await login(`table-${stamp}@test.local`);
    const judge = await login(`judge-x-${stamp}@test.local`);

    expect((await call('GET', `/bouts/${f.boutId}`)).status).toBe(200); // affichage public
    expect((await call('POST', `/bouts/${f.boutId}/panel`)).status).toBe(401);
    expect((await call('POST', `/bouts/${f.boutId}/panel`, 'n.importe')).status).toBe(401);
    const forged = table.split('.')[0] + '.' + 'A'.repeat(43);
    expect((await call('POST', `/bouts/${f.boutId}/panel`, forged)).status).toBe(401);

    const asJudge = await call('POST', `/bouts/${f.boutId}/panel`, judge);
    expect(asJudge.status).toBe(403);
    expect(asJudge.body.code).toBe('FORBIDDEN_ROLE');
    expect((await call('POST', `/bouts/${f.boutId}/scores`, table, { aka: '7.0', ao: '6.0' })).status).toBe(403); // la table ne note pas
    expect((await call('POST', '/auth/users', table, { email: 'x@y.z', password: 'abcdefgh', role: 'ADMIN' })).status).toBe(403);

    const bad = await call('POST', '/auth/login', undefined, { email: `table-${stamp}@test.local`, password: 'faux' });
    expect(bad.status).toBe(401);
    expect((await call('POST', '/auth/login', undefined, { email: 'inconnu@test.local', password: PASSWORD })).status).toBe(401);
    expect((await call('GET', '/auth/me', judge)).body).toMatchObject({ role: 'JUDGE', officialId: f.judges[0] });
  });

  it('création de compte : JUDGE sans officiel et mot de passe court refusés, e-mail unique', async () => {
    const adminEmail = `admin-${stamp}@test.local`;
    await user('admin', 'ADMIN');
    const admin = await login(adminEmail);
    const mk = (b: object) => call('POST', '/auth/users', admin, b);
    expect((await mk({ email: `a1-${stamp}@test.local`, password: PASSWORD, role: 'JUDGE' })).status).toBe(400);
    expect((await mk({ email: `a2-${stamp}@test.local`, password: 'court', role: 'RUNNER' })).status).toBe(400);
    expect((await mk({ email: `a3-${stamp}@test.local`, password: PASSWORD, role: 'ROI' })).status).toBe(400);
    expect((await mk({ email: adminEmail, password: PASSWORD, role: 'RUNNER' })).status).toBe(409);
    expect((await mk({ email: `a4-${stamp}@test.local`, password: PASSWORD, role: 'RUNNER' })).status).toBeLessThan(300);
  });

  it('combat complet : la table pilote en REST, les juges notent (WebSocket/REST) avec leur identité du jeton', async () => {
    const table = await login(`table-${stamp}@test.local`);
    const ok = async (path: string, body?: unknown) => expect((await call('POST', `/bouts/${f.boutId}/${path}`, table, body)).status).toBeLessThan(300);

    await ok('panel');
    await ok('kata', { side: 'AKA', kata: 20 });
    await ok('kata', { side: 'AO', kata: 30 });
    for (let i = 0; i < 4; i++) await ok('advance');

    const detail = (await call('GET', `/bouts/${f.boutId}`)).body;
    expect(detail.status).toBe('SCORING');
    const panel: string[] = detail.panel.map((s: any) => s.officialId);
    const tokens: string[] = [];
    for (let i = 0; i < 7; i++) {
      const email = `judge${i}-${stamp}@test.local`;
      await user(`judge${i}`, 'JUDGE', panel[i]);
      tokens.push(await login(email));
    }

    const display = await connect(); // spectateur sans jeton
    expect((await emit(display, 'join', { boutId: f.boutId })).ok).toBe(true);
    const progress: any[] = [];
    display.on('progress', (e) => progress.push(e));
    const revealed = new Promise<any>((res) => display.once('revealed', res));
    const confirmed = new Promise<any>((res) => display.once('confirmed', res));

    // le spectateur ne peut pas noter
    expect(await emit(display, 'score:submit', { boutId: f.boutId, aka: '7.0', ao: '6.0' })).toMatchObject({ ok: false, code: 'UNAUTHENTICATED' });
    // la table connectée ne peut pas noter non plus
    const tableSocket = await connect(table);
    expect(await emit(tableSocket, 'score:submit', { boutId: f.boutId, aka: '7.0', ao: '6.0' })).toMatchObject({ ok: false, code: 'FORBIDDEN_ROLE' });

    const j0 = await connect(tokens[0]);
    expect(await emit(j0, 'score:submit', { boutId: f.boutId, aka: '7.0', ao: '7.0' })).toMatchObject({ ok: false, code: 'EQUAL_SCORES' });
    expect(await emit(j0, 'score:submit', { boutId: f.boutId, aka: '4.9', ao: '7.0' })).toMatchObject({ ok: false, code: 'INVALID_SCORE' });

    for (let i = 0; i < 6; i++) {
      const s = i === 0 ? j0 : await connect(tokens[i]);
      // un `officialId` envoyé par le client est ignoré : le juge est celui du jeton
      const r = await emit(s, 'score:submit', { boutId: f.boutId, officialId: panel[6], aka: AKA[i], ao: AO[i] });
      expect(r).toMatchObject({ ok: true, revealed: false, submitted: i + 1 });
    }
    const last = await call('POST', `/bouts/${f.boutId}/scores`, tokens[6], { aka: AKA[6], ao: AO[6] });
    expect(last.status).toBeLessThan(300);

    const rev = await revealed;
    expect(rev.result).toMatchObject({ winner: 'AO', akaVotes: 3, aoVotes: 4 });
    expect(rev.result.judges.map((j: any) => j.officialId).sort()).toEqual([...panel].sort());
    expect(JSON.stringify(progress)).not.toMatch(/7\.[0-9]|"aka"/);

    await ok('confirm');
    await confirmed;
  });

  it('tirage : réservé au technicien ; consultation du tableau publique', async () => {
    const id = '00000000-0000-0000-0000-000000000000';
    const judge = await login(`judge-x-${stamp}@test.local`);
    const table = await login(`table-${stamp}@test.local`);
    expect((await call('POST', `/categories/${id}/draw`)).status).toBe(401);
    expect((await call('POST', `/categories/${id}/draw`, judge)).status).toBe(403);
    expect((await call('POST', `/categories/${id}/knockout`, judge)).status).toBe(403);
    expect((await call('POST', `/categories/${id}/draw`, table)).status).toBe(404); // autorisé, mais catégorie inconnue
    expect((await call('GET', `/categories/${id}/bracket`)).status).toBe(404); // public
  });

  it('verdict de kata refusé → HTTP 409 avec code', async () => {
    const g = await makeFixture(app.get(Database).pool);
    try {
      const adminToken = await login(`admin-${stamp}@test.local`);
      const r = await call('POST', `/bouts/${g.boutId}/kata`, adminToken, { side: 'AKA', kata: 999 });
      expect(r.status).toBe(409);
      expect(r.body.code).toBe('KATA_NOT_IN_LIST');
    } finally {
      await cleanup(app.get(Database).pool, [g]);
    }
  });
});
