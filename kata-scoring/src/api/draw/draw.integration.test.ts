import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Database } from '../database.js';
import { BoutEvents } from '../bouts/bout-events.js';
import { BoutsService } from '../bouts/bouts.service.js';
import { cleanupCategory, makeCategory, type CategoryFixture } from '../bouts/test-fixture.js';
import { DrawService } from './draw.service.js';

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('Tirage, poules et tableau sur PostgreSQL', () => {
  let db: Database;
  let draw: DrawService;
  let bouts: BoutsService;
  const fixtures: CategoryFixture[] = [];
  let seedState = 7;
  const rng = () => ((seedState = (seedState * 16807) % 2147483647) / 2147483647);

  beforeAll(() => {
    process.env.DATABASE_URL = url;
    db = new Database();
    bouts = new BoutsService(db, new BoutEvents());
    draw = new DrawService(db);
  });
  afterAll(async () => {
    for (const f of fixtures) await cleanupCategory(db.pool, f);
    await db.onModuleDestroy();
  });

  const make = async (n: number, seeds: Record<number, number> = {}) => {
    const f = await makeCategory(db.pool, n, seeds);
    fixtures.push(f);
    return f;
  };
  const q = async (sql: string, p: unknown[] = []) => (await db.pool.query(sql, p)).rows;

  /** Résultat posé directement (poules) : le mieux classé du scénario (plus petit index) gagne 4-3. */
  async function forcePoolResults(f: CategoryFixture, winner: (aka: string, ao: string) => string) {
    const rows = await q(
      `SELECT b.id, b.aka_entry_id, b.ao_entry_id FROM bouts b JOIN stages s ON s.id = b.stage_id
        WHERE s.category_id = $1 AND s.type = 'ROUND_ROBIN' AND b.status <> 'CONFIRMED'`,
      [f.categoryId],
    );
    for (const b of rows) {
      const w = winner(b.aka_entry_id, b.ao_entry_id);
      const akaWins = w === b.aka_entry_id;
      await db.pool.query(
        `UPDATE bouts SET status = 'CONFIRMED', winner_entry_id = $2, aka_votes = $3, ao_votes = $4, result_type = 'NORMAL' WHERE id = $1`,
        [b.id, w, akaWins ? 4 : 3, akaWins ? 3 : 4],
      );
    }
  }
  const better = (f: CategoryFixture) => (a: string, b: string) => (f.entries.indexOf(a) < f.entries.indexOf(b) ? a : b);

  /** Combat joué pour de vrai : tirage du panel, katas, 7 notes, révélation, confirmation. */
  async function play(boutId: string, winnerSide: 'AKA' | 'AO') {
    const [b] = await q('SELECT aka_entry_id, ao_entry_id FROM bouts WHERE id = $1', [boutId]);
    const next = async (entry: string) => 20 + 2 * (await q(`SELECT 1 FROM bouts WHERE (aka_entry_id = $1 AND aka_kata IS NOT NULL) OR (ao_entry_id = $1 AND ao_kata IS NOT NULL)`, [entry])).length;
    await bouts.drawPanel(boutId);
    await bouts.declareKata(boutId, 'AKA', await next(b.aka_entry_id));
    await bouts.declareKata(boutId, 'AO', await next(b.ao_entry_id));
    for (let i = 0; i < 4; i++) await bouts.advance(boutId);
    const panel = (await bouts.getBout(boutId)).panel;
    for (const seat of panel) {
      await bouts.submitScore(boutId, seat.officialId, winnerSide === 'AKA' ? 75 : 65, winnerSide === 'AKA' ? 65 : 75);
    }
    await bouts.confirm(boutId);
  }
  const stageBouts = (categoryId: string, label: string) =>
    q(
      `SELECT b.* FROM bouts b JOIN stages s ON s.id = b.stage_id WHERE s.category_id = $1 AND s.label = $2 ORDER BY b.position`,
      [categoryId, label],
    );

  it('tire 8 athlètes en 2 poules de 4, tête de série 1 en B et 2 en A, 12 combats', async () => {
    const f = await make(8, { 0: 1, 1: 2 });
    const r = await draw.drawPools(f.categoryId, {}, rng);
    expect(r.groups.map((g) => g.entries.length)).toEqual([4, 4]);
    expect(r.groups[1]!.entries).toContain(f.entries[0]); // tête de série 1 → groupe B (tableau 3.7.9)
    expect(r.groups[0]!.entries).toContain(f.entries[1]); // tête de série 2 → groupe A
    expect(r.bouts).toBe(12);
    expect((await q('SELECT format::text AS f FROM categories WHERE id = $1', [f.categoryId]))[0].f).toBe('ROUND_ROBIN_THEN_ELIMINATION');
    expect((await q('SELECT count(*)::int AS n FROM bouts WHERE stage_id = $1 AND panel_size = 7', [r.stageId]))[0].n).toBe(12);
    // chaque athlète rencontre les 3 autres de son groupe
    for (const g of r.groups) {
      for (const id of g.entries) {
        const n = (await q('SELECT count(*)::int AS n FROM bouts WHERE aka_entry_id = $1 OR ao_entry_id = $1', [id]))[0].n;
        expect(n).toBe(3);
      }
    }
    await expect(draw.drawPools(f.categoryId, {}, rng)).rejects.toMatchObject({ response: { code: 'ALREADY_DRAWN' } });
  });

  it('refuse moins de 3 ou plus de 32 inscrits et un panel pair', async () => {
    const f = await make(2);
    await expect(draw.drawPools(f.categoryId, {}, rng)).rejects.toMatchObject({ code: 'PLAYER_COUNT_UNSUPPORTED' });
    const g = await make(8);
    await expect(draw.drawPools(g.categoryId, { poolPanelSize: 6 }, rng)).rejects.toMatchObject({ response: { code: 'INVALID_PANEL_SIZE' } });
    expect(await q('SELECT 1 FROM stages WHERE category_id = $1', [g.categoryId])).toHaveLength(0); // rien n'a été créé
  });

  it('2 groupes : poules → demi-finales croisées → finale, 2 médailles de bronze sans combat', async () => {
    const f = await make(8);
    const r = await draw.drawPools(f.categoryId, {}, rng);
    await expect(draw.generateKnockout(f.categoryId)).rejects.toMatchObject({ response: { code: 'POOLS_INCOMPLETE', remaining: 12 } });

    await forcePoolResults(f, better(f));
    const st = await draw.standings(f.categoryId);
    expect(st.remainingBouts).toBe(0);
    for (const g of st.groups) expect(g.ranking.map((x) => x.rank)).toEqual([1, 2, 3, 4]);

    const ko = await draw.generateKnockout(f.categoryId, {}, );
    expect(ko.stages).toEqual([{ label: 'Demi-finales', bouts: 2 }, { label: 'Finale', bouts: 1 }]);
    await expect(draw.generateKnockout(f.categoryId)).rejects.toMatchObject({ response: { code: 'KNOCKOUT_EXISTS' } });

    const [a1, b1] = r.groups.map((g) => g.entries.slice().sort((x, y) => f.entries.indexOf(x) - f.entries.indexOf(y)));
    const sf = await stageBouts(f.categoryId, 'Demi-finales');
    expect([sf[0].aka_entry_id, sf[0].ao_entry_id]).toEqual([a1![0], b1![1]]); // 1er A – 2e B
    expect([sf[1].aka_entry_id, sf[1].ao_entry_id]).toEqual([b1![0], a1![1]]); // 1er B – 2e A
    expect((await q('SELECT panel_size FROM stages WHERE category_id = $1 AND label = $2', [f.categoryId, 'Demi-finales']))[0].panel_size).toBe(5);

    await play(sf[0].id, 'AKA');
    await play(sf[1].id, 'AKA');
    const [final] = await stageBouts(f.categoryId, 'Finale');
    expect([final.aka_entry_id, final.ao_entry_id]).toEqual([a1![0], b1![0]]);
    expect(final.panel_size).toBe(7);
    await play(final.id, 'AO');
    expect((await q('SELECT winner_entry_id FROM bouts WHERE id = $1', [final.id]))[0].winner_entry_id).toBe(b1![0]);
    void r;
  });

  it('égalité parfaite en poule (cycle 4-3) : le tableau est refusé et l\'égalité signalée', async () => {
    const f = await make(6);
    await draw.drawPools(f.categoryId, {}, rng);
    // dans chaque groupe de 3, un cycle A>B>C>A : mêmes points, mêmes votes ; sans classement mondial, aucun départage
    await db.pool.query('UPDATE athletes SET world_rank = NULL WHERE id = ANY($1::uuid[])', [f.athleteIds]);
    const groups = await q(`SELECT g.id FROM groups g JOIN stages s ON s.id = g.stage_id WHERE s.category_id = $1`, [f.categoryId]);
    for (const g of groups) {
      const members = (await q('SELECT entry_id FROM group_members WHERE group_id = $1 ORDER BY entry_id', [g.id])).map((m) => m.entry_id);
      const beats = new Map([[members[0], members[1]], [members[1], members[2]], [members[2], members[0]]]);
      const rows = await q(`SELECT id, aka_entry_id, ao_entry_id FROM bouts WHERE group_id = $1`, [g.id]);
      for (const b of rows) {
        const w = beats.get(b.aka_entry_id) === b.ao_entry_id ? b.aka_entry_id : b.ao_entry_id;
        const akaWins = w === b.aka_entry_id;
        await db.pool.query(`UPDATE bouts SET status = 'CONFIRMED', winner_entry_id = $2, aka_votes = $3, ao_votes = $4 WHERE id = $1`, [b.id, w, akaWins ? 4 : 3, akaWins ? 3 : 4]);
      }
    }
    const st = await draw.standings(f.categoryId);
    expect(st.groups.every((g) => g.unresolvedTies.length === 1 && g.unresolvedTies[0]!.length === 3)).toBe(true);
    await expect(draw.generateKnockout(f.categoryId)).rejects.toMatchObject({ response: { code: 'TIES_UNRESOLVED' } });
  });

  it('4 groupes de 4 : quarts croisés sans revanche de groupe, demi-finales, finale et deux combats de bronze', async () => {
    const f = await make(16);
    const r = await draw.drawPools(f.categoryId, {}, rng);
    expect(r.bouts).toBe(24);
    await forcePoolResults(f, better(f));
    const ko = await draw.generateKnockout(f.categoryId);
    expect(ko.qualified).toHaveLength(8);
    expect(ko.stages).toEqual([
      { label: 'Quarts de finale', bouts: 4 },
      { label: 'Demi-finales', bouts: 2 },
      { label: 'Finale et bronze', bouts: 3 },
    ]);

    const groupOf = new Map<string, number>();
    r.groups.forEach((g, i) => g.entries.forEach((id) => groupOf.set(id, i)));
    const qf = await stageBouts(f.categoryId, 'Quarts de finale');
    for (const b of qf) expect(groupOf.get(b.aka_entry_id)).not.toBe(groupOf.get(b.ao_entry_id));

    // on joue les quarts : l'AKA gagne toujours
    for (const b of qf) await play(b.id, 'AKA');
    const sf = await stageBouts(f.categoryId, 'Demi-finales');
    expect(sf.every((b) => b.aka_entry_id && b.ao_entry_id)).toBe(true);
    const bronzeBefore = await stageBouts(f.categoryId, 'Finale et bronze');
    expect(bronzeBefore[1].aka_entry_id).toBeNull(); // le bronze se remplit après la demi-finale

    await play(sf[0].id, 'AO');
    const [sf1] = await stageBouts(f.categoryId, 'Demi-finales');
    const finalist1 = sf1.ao_entry_id;
    const sfLoser1 = sf1.aka_entry_id;
    // son adversaire en quart : le quart que le finaliste a gagné (AKA gagnait, donc le finaliste était l'AKA de son quart… ou l'AO du quart perdu)
    const feeder = (await q(`SELECT * FROM bouts WHERE next_bout_id = $1 AND winner_entry_id = $2`, [sf1.id, finalist1]))[0];
    const victim = feeder.winner_entry_id === feeder.aka_entry_id ? feeder.ao_entry_id : feeder.aka_entry_id;
    const [, bronze1] = await stageBouts(f.categoryId, 'Finale et bronze');
    expect(bronze1.ao_entry_id).toBe(sfLoser1);
    expect(bronze1.aka_entry_id).toBe(victim);
    expect(bronze1.aka_entry_id).not.toBe(bronze1.ao_entry_id);

    await play(sf[1].id, 'AKA');
    const [final, b1, b2] = await stageBouts(f.categoryId, 'Finale et bronze');
    expect(final.aka_entry_id).toBe(finalist1);
    expect(b1.aka_entry_id && b1.ao_entry_id && b2.aka_entry_id && b2.ao_entry_id).toBeTruthy();
    // les quatre sont tous différents : deux médailles de bronze distinctes
    expect(new Set([b1.aka_entry_id, b1.ao_entry_id, b2.aka_entry_id, b2.ao_entry_id]).size).toBe(4);
    for (const b of [final, b1, b2]) await play(b.id, 'AKA');
  });

  it('6 groupes (20 athlètes) : 1ers + 2 meilleurs deuxièmes, 8 qualifiés', async () => {
    const f = await make(20);
    const r = await draw.drawPools(f.categoryId, {}, rng);
    expect(r.groups.map((g) => g.entries.length)).toEqual([4, 3, 3, 4, 3, 3]);
    await forcePoolResults(f, better(f));
    // un résultat de départage connu : on laisse le système choisir ; si égalité à la limite, il faut un départage explicite
    try {
      const ko = await draw.generateKnockout(f.categoryId);
      expect(ko.qualified).toHaveLength(8);
    } catch (e) {
      expect((e as { response?: { code?: string } }).response?.code).toBe('CUTOFF_TIE');
      const tied = (e as { response: { tied: string[]; slots: number } }).response;
      await expect(draw.generateKnockout(f.categoryId, { cutoffWinners: ['n-importe-quoi'] })).rejects.toMatchObject({ response: { code: 'CUTOFF_TIE' } });
      const ko = await draw.generateKnockout(f.categoryId, { cutoffWinners: tied.tied.slice(0, tied.slots) });
      expect(ko.qualified).toHaveLength(8);
    }
  });

  it('1 groupe (5 athlètes) : finale 1er-2e et un seul combat de bronze 3e-4e', async () => {
    const f = await make(5);
    await draw.drawPools(f.categoryId, {}, rng);
    await forcePoolResults(f, better(f));
    const ko = await draw.generateKnockout(f.categoryId);
    expect(ko.stages).toEqual([{ label: 'Finale et bronze', bouts: 2 }]);
    const [final, bronze] = await stageBouts(f.categoryId, 'Finale et bronze');
    expect([final.aka_entry_id, final.ao_entry_id].sort()).toEqual([f.entries[0], f.entries[1]].sort());
    expect([bronze.aka_entry_id, bronze.ao_entry_id].sort()).toEqual([f.entries[2], f.entries[3]].sort());
  });

  it('vue d\'ensemble du tableau avec les noms', async () => {
    const f = await make(4);
    await draw.drawPools(f.categoryId, {}, rng);
    const view = await draw.bracket(f.categoryId);
    expect(view.stages[0]!.bouts).toHaveLength(6);
    expect(view.stages[0]!.bouts[0]).toMatchObject({ group_label: 'Groupe A', aka_name: expect.stringContaining('N') });
  });
});
