import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Database } from '../database.js';
import { BoutEvents } from '../bouts/bout-events.js';
import { BoutsService } from '../bouts/bouts.service.js';
import { cleanupCategory, makeCategory, type CategoryFixture } from '../bouts/test-fixture.js';
import { DrawService } from './draw.service.js';

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('Élimination avec repêchage sur PostgreSQL', () => {
  let db: Database;
  let draw: DrawService;
  let bouts: BoutsService;
  const fixtures: CategoryFixture[] = [];
  let seedState = 11;
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

  async function play(boutId: string, winnerSide: 'AKA' | 'AO' = 'AKA') {
    const [b] = await q('SELECT aka_entry_id, ao_entry_id FROM bouts WHERE id = $1', [boutId]);
    const next = async (entry: string) =>
      20 + 2 * (await q(`SELECT 1 FROM bouts WHERE (aka_entry_id = $1 AND aka_kata IS NOT NULL) OR (ao_entry_id = $1 AND ao_kata IS NOT NULL)`, [entry])).length;
    await bouts.drawPanel(boutId);
    await bouts.declareKata(boutId, 'AKA', await next(b.aka_entry_id));
    await bouts.declareKata(boutId, 'AO', await next(b.ao_entry_id));
    for (let i = 0; i < 4; i++) await bouts.advance(boutId);
    for (const seat of (await bouts.getBout(boutId)).panel) {
      await bouts.submitScore(boutId, seat.officialId, winnerSide === 'AKA' ? 75 : 65, winnerSide === 'AKA' ? 65 : 75);
    }
    await bouts.confirm(boutId);
  }

  /** Joue, dans l'ordre des tours, tous les combats prêts d'un type de phase donné (le vainqueur est tiré selon `pick`). */
  async function playReady(categoryId: string, types: string[], pick: (n: number) => 'AKA' | 'AO' = () => 'AKA') {
    let n = 0;
    for (;;) {
      const [next] = await q(
        `SELECT b.id FROM bouts b JOIN stages s ON s.id = b.stage_id
          WHERE s.category_id = $1 AND s.type::text = ANY($2) AND b.status = 'SCHEDULED' AND b.aka_entry_id IS NOT NULL AND b.ao_entry_id IS NOT NULL
          ORDER BY s.round_no, b.position LIMIT 1`,
        [categoryId, types],
      );
      if (!next) return n;
      await play(next.id, pick(n++));
    }
  }
  const stagesOf = (categoryId: string) =>
    q(`SELECT s.type::text AS type, s.round_no, s.label, s.panel_size, (SELECT count(*)::int FROM bouts b WHERE b.stage_id = s.id) AS bouts FROM stages s WHERE category_id = $1 ORDER BY round_no, type`, [categoryId]);

  it('par défaut, le tirage suit le format de la catégorie : élimination avec repêchage (3.3.1 a)', async () => {
    const f = await make(8);
    const r = await draw.draw(f.categoryId, {}, rng);
    expect(r.format).toBe('ELIMINATION_REPECHAGE');
    const g = await make(8);
    expect((await draw.draw(g.categoryId, { format: 'ROUND_ROBIN_THEN_ELIMINATION' }, rng)).format).toBe('ROUND_ROBIN_THEN_ELIMINATION');
  });

  it('8 athlètes : deux poules de 4, tours, finale de poule, finale ; têtes de série séparées', async () => {
    const f = await make(8, { 0: 1, 1: 2, 2: 3, 3: 4 });
    const r = await draw.drawElimination(f.categoryId, {}, rng);
    expect(r.pools.map((p) => p.entries.length)).toEqual([4, 4]);
    expect(r.pools[0]!.entries[0]).toBe(f.entries[0]); // tête de série 1 : poule A
    expect(r.pools[1]!.entries[0]).toBe(f.entries[1]); // tête de série 2 : poule B
    expect(r.pools[0]!.entries).toContain(f.entries[3]);
    expect(r.pools[1]!.entries).toContain(f.entries[2]);
    expect(r.bouts).toBe(7); // 3 par poule + la finale
    expect(await stagesOf(f.categoryId)).toEqual([
      { type: 'ELIMINATION', round_no: 1, label: 'Demi-finales de poule', panel_size: 5, bouts: 4 },
      { type: 'ELIMINATION', round_no: 2, label: 'Finales de poule', panel_size: 5, bouts: 2 },
      { type: 'MEDAL', round_no: 3, label: 'Finale', panel_size: 7, bouts: 1 },
    ]);
    await expect(draw.drawElimination(f.categoryId, {}, rng)).rejects.toMatchObject({ response: { code: 'ALREADY_DRAWN' } });
  });

  it('refuse moins de 4 inscrits', async () => {
    const f = await make(3);
    await expect(draw.drawElimination(f.categoryId, {}, rng)).rejects.toMatchObject({ response: { code: 'PLAYER_COUNT_UNSUPPORTED' } });
    expect(await q('SELECT 1 FROM stages WHERE category_id = $1', [f.categoryId])).toHaveLength(0);
  });

  it('repêchage impossible avant les finales de poule, ou hors du format', async () => {
    const f = await make(8);
    await draw.drawElimination(f.categoryId, {}, rng);
    await expect(draw.generateRepechage(f.categoryId, {}, rng)).rejects.toMatchObject({ response: { code: 'REPECHAGE_NOT_READY' } });
    const g = await make(8);
    await draw.drawPools(g.categoryId, {}, rng);
    await expect(draw.generateRepechage(g.categoryId, {}, rng)).rejects.toMatchObject({ response: { code: 'NOT_ELIMINATION_FORMAT' } });
  });

  it('8 athlètes joués : repêchage = éliminés par chaque finaliste, un combat de bronze par poule', async () => {
    const f = await make(8);
    const r = await draw.drawElimination(f.categoryId, {}, rng);
    expect(await playReady(f.categoryId, ['ELIMINATION'])).toBe(6);

    const rep = await draw.generateRepechage(f.categoryId, {}, rng);
    expect(rep.bronzeBouts).toBe(2);
    expect(rep.bronzeWithoutBout).toEqual([]);
    // chaque poule de repêchage compte les 2 athlètes battus par le finaliste (une demi-finale de poule + la finale de poule)
    for (let i = 0; i < 2; i++) {
      expect(rep.repechage[i]!.entries).toHaveLength(2);
      const pool = r.pools[i]!.entries;
      expect(rep.repechage[i]!.entries.every((e) => pool.includes(e))).toBe(true);
      expect(rep.repechage[i]!.entries).not.toContain(rep.finalists[i]);
    }
    await expect(draw.generateRepechage(f.categoryId, {}, rng)).rejects.toMatchObject({ response: { code: 'REPECHAGE_EXISTS' } });

    const medal = (await stagesOf(f.categoryId)).find((s) => s.type === 'MEDAL')!;
    expect(medal).toMatchObject({ round_no: 4, label: 'Finale et bronze', panel_size: 7, bouts: 3 });
    const [final, b1, b2] = await q(
      `SELECT b.* FROM bouts b JOIN stages s ON s.id = b.stage_id WHERE s.category_id = $1 AND s.type = 'MEDAL' ORDER BY b.position`, [f.categoryId],
    );
    expect([final.aka_entry_id, final.ao_entry_id]).toEqual(rep.finalists); // poule A en AKA, poule B en AO
    expect([b1.aka_entry_id, b1.ao_entry_id].sort()).toEqual([...rep.repechage[0]!.entries].sort());
    expect([b2.aka_entry_id, b2.ao_entry_id].sort()).toEqual([...rep.repechage[1]!.entries].sort());
    expect([b1.panel_size, b2.panel_size]).toEqual([7, 7]);

    expect(await playReady(f.categoryId, ['MEDAL'])).toBe(3);
  });

  it('13 athlètes (exempts, 3 niveaux) : tout le tableau est joué, repêchage en plusieurs tours', async () => {
    const f = await make(13, { 0: 1, 1: 2 });
    const r = await draw.drawElimination(f.categoryId, {}, rng);
    expect(r.pools.map((p) => p.entries.length)).toEqual([7, 6]);
    expect(r.bouts).toBe(6 + 5 + 1);
    expect(r.depth).toBe(3);

    // pas de combat au tour 1 pour la poule de 6 (huit places, deux exempts + …) : on vérifie seulement la cohérence
    const played = await playReady(f.categoryId, ['ELIMINATION'], (n) => (n % 2 ? 'AO' : 'AKA'));
    expect(played).toBe(11);

    const rep = await draw.generateRepechage(f.categoryId, {}, rng);
    for (const pool of rep.repechage) expect(new Set(pool.entries).size).toBe(pool.entries.length);
    // tous les éliminés repêchés ont bien perdu contre le finaliste de leur poule
    for (let i = 0; i < 2; i++) {
      for (const e of rep.repechage[i]!.entries) {
        const lost = await q(
          `SELECT 1 FROM bouts b JOIN stages s ON s.id = b.stage_id
            WHERE s.type = 'ELIMINATION' AND b.winner_entry_id = $1 AND (b.aka_entry_id = $2 OR b.ao_entry_id = $2) AND b.status = 'CONFIRMED'`,
          [rep.finalists[i], e],
        );
        expect(lost.length).toBeGreaterThan(0);
      }
    }
    // les tours de repêchage sont joués avant la médaille, et le numéro de la phase médaille suit
    const stages = await stagesOf(f.categoryId);
    const medal = stages.find((s) => s.type === 'MEDAL')!;
    expect(stages.filter((s) => s.type === 'REPECHAGE').every((s) => s.round_no < medal.round_no)).toBe(true);
    expect(stages.filter((s) => s.type !== 'MEDAL').every((s) => s.round_no < medal.round_no)).toBe(true);

    const repPlayed = await playReady(f.categoryId, ['REPECHAGE']);
    const medalPlayed = await playReady(f.categoryId, ['MEDAL']);
    expect(medalPlayed).toBe(1 + rep.bronzeBouts);
    expect(repPlayed + rep.bronzeBouts).toBe(rep.repechage.reduce((n, p) => n + Math.max(p.entries.length - 1, 0), 0));
    expect((await q(`SELECT count(*)::int AS n FROM bouts b JOIN stages s ON s.id = b.stage_id WHERE s.category_id = $1 AND b.status <> 'CONFIRMED'`, [f.categoryId]))[0].n).toBe(0);
  });

  it('4 athlètes : un seul éliminé par finaliste, médaille de bronze sans combat', async () => {
    const f = await make(4);
    await draw.drawElimination(f.categoryId, {}, rng);
    expect(await playReady(f.categoryId, ['ELIMINATION'])).toBe(2);
    const rep = await draw.generateRepechage(f.categoryId, {}, rng);
    expect(rep.bronzeBouts).toBe(0);
    expect(rep.bronzeWithoutBout).toHaveLength(2);
    expect(new Set([...rep.bronzeWithoutBout, ...rep.finalists]).size).toBe(4);
  });

  it('un athlète en Kiken pendant le tableau n\'est pas repêché', async () => {
    const f = await make(8);
    await draw.drawElimination(f.categoryId, {}, rng);
    const [first] = await q(
      `SELECT b.id, b.ao_entry_id FROM bouts b JOIN stages s ON s.id = b.stage_id WHERE s.category_id = $1 AND s.round_no = 1 ORDER BY b.position LIMIT 1`, [f.categoryId],
    );
    await bouts.kiken(first.id, 'AO'); // l'AO est absent : l'AKA gagne
    await playReady(f.categoryId, ['ELIMINATION']);
    const rep = await draw.generateRepechage(f.categoryId, {}, rng);
    expect(rep.repechage.flatMap((p) => p.entries)).not.toContain(first.ao_entry_id);
  });
});
