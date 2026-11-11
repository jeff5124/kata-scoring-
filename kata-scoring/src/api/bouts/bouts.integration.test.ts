import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RuleError } from '../../rules/index.js';
import { Database } from '../database.js';
import { BoutEvents, type BoutEvent } from './bout-events.js';
import { BoutsService } from './bouts.service.js';
import { cleanup, makeFixture, type Fixture } from './test-fixture.js';

const url = process.env.TEST_DATABASE_URL;

// Exemple du règlement (art. 5.4, page 15) : AO gagne 4-3
const AKA = [76, 75, 76, 71, 71, 77, 72];
const AO = [80, 73, 74, 73, 74, 73, 75];

describe.skipIf(!url)('BoutsService sur PostgreSQL', () => {
  let db: Database;
  let service: BoutsService;
  const emitted: BoutEvent[] = [];
  const fixtures: Fixture[] = [];

  beforeAll(() => {
    process.env.DATABASE_URL = url;
    db = new Database();
    const events = new BoutEvents();
    events.stream.subscribe((e) => emitted.push(e));
    service = new BoutsService(db, events);
  });

  afterAll(async () => {
    await cleanup(db.pool, fixtures);
    await db.onModuleDestroy();
  });

  const fx = async (opts?: Parameters<typeof makeFixture>[1]) => {
    const f = await makeFixture(db.pool, opts);
    fixtures.push(f);
    return f;
  };

  /** Amène le combat jusqu'à la notation et renvoie le panel. */
  async function toScoring(f: Fixture) {
    await service.drawPanel(f.boutId);
    await service.declareKata(f.boutId, 'AKA', 20);
    await service.declareKata(f.boutId, 'AO', 30);
    await service.advance(f.boutId); // CALLED
    await service.advance(f.boutId); // AKA_PERFORMING
    await service.advance(f.boutId); // AO_PERFORMING
    await service.advance(f.boutId); // SCORING
    return (await service.getBout(f.boutId)).panel;
  }

  const row = async (sql: string, params: unknown[]) => (await db.pool.query(sql, params)).rows[0];

  it("déroule un combat complet : tirage, katas, notation par 7 juges, révélation, confirmation", async () => {
    const f = await fx();
    emitted.length = 0;

    const drawn = await service.drawPanel(f.boutId);
    expect(drawn).toHaveLength(7);
    expect(drawn.filter((s) => s.isChief)).toHaveLength(1);
    expect(drawn.map((s) => s.officialId).sort()).toEqual([...f.judges].sort()); // les 2 juges de la fédération de l'AKA sont exclus

    await service.declareKata(f.boutId, 'AKA', 20);
    await service.declareKata(f.boutId, 'AO', 30);
    const statuses = [];
    for (let i = 0; i < 4; i++) statuses.push(await service.advance(f.boutId));
    expect(statuses).toEqual(['CALLED', 'AKA_PERFORMING', 'AO_PERFORMING', 'SCORING']);

    const panel = (await service.getBout(f.boutId)).panel;
    for (let i = 0; i < 6; i++) {
      const r = await service.submitScore(f.boutId, panel[i]!.officialId, AKA[i]!, AO[i]!);
      expect(r).toMatchObject({ revealed: false, submitted: i + 1, total: 7 });
    }
    expect((await service.getBout(f.boutId)).result).toBeNull(); // rien n'est visible avant la révélation

    const last = await service.submitScore(f.boutId, panel[6]!.officialId, AKA[6]!, AO[6]!);
    expect(last.revealed).toBe(true);
    expect(last.result).toMatchObject({ winner: 'AO', akaVotes: 3, aoVotes: 4, winnerEntryId: f.aoEntry, resultType: 'NORMAL' });
    expect(last.result!.judges.map((j) => j.vote)).toEqual(['AO', 'AKA', 'AKA', 'AO', 'AO', 'AKA', 'AO']);

    // diffusion : les compteurs ne contiennent aucune note, et la révélation est émise une seule fois
    const mine = emitted.filter((e) => e.boutId === f.boutId);
    const progress = mine.filter((e) => e.type === 'progress');
    expect(progress).toHaveLength(7);
    expect(JSON.stringify(progress)).not.toContain('"aka"');
    expect(mine.filter((e) => e.type === 'revealed')).toHaveLength(1);

    const detail = await service.getBout(f.boutId);
    expect(detail.status).toBe('REVEALED');
    expect(detail.result?.judges).toHaveLength(7);

    await service.confirm(f.boutId);
    expect((await service.getBout(f.boutId)).status).toBe('CONFIRMED');
    expect((await row('SELECT ao_entry_id FROM bouts WHERE id = $1', [f.nextBoutId])).ao_entry_id).toBe(f.aoEntry);
  });

  it('refuse les notes invalides, égales, hors panel ou hors notation ; accepte la correction avant révélation', async () => {
    const early = await fx();
    await expect(service.submitScore(early.boutId, early.judges[0]!, 70, 60)).rejects.toMatchObject({
      response: { code: 'NOT_SCORING' },
    });

    const f = await fx();
    const panel = await toScoring(f);
    const judge = panel[0]!.officialId;

    await expect(service.submitScore(f.boutId, judge, 70, 70)).rejects.toMatchObject({ code: 'EQUAL_SCORES' });
    await expect(service.submitScore(f.boutId, judge, 49, 70)).rejects.toMatchObject({ code: 'INVALID_SCORE' });
    await expect(service.submitScore(f.boutId, judge, 70, 101)).rejects.toBeInstanceOf(RuleError);
    await expect(service.submitScore(f.boutId, f.excludedJudges[0]!, 70, 60)).rejects.toMatchObject({
      response: { code: 'NOT_IN_PANEL' },
    });

    await service.submitScore(f.boutId, judge, 70, 60);
    const again = await service.submitScore(f.boutId, judge, 60, 70); // le juge se corrige
    expect(again).toMatchObject({ revealed: false, submitted: 1 });
    const scores = await db.pool.query(`SELECT side, value_tenths FROM scores WHERE bout_id = $1 AND official_id = $2 ORDER BY side`, [f.boutId, judge]);
    expect(scores.rows).toEqual([
      { side: 'AKA', value_tenths: 60 },
      { side: 'AO', value_tenths: 70 },
    ]);
  });

  it('fournit noms, kata, phase et listes « en cours » pour l\'affichage et pour chaque juge', async () => {
    const f = await fx();
    const panel = await toScoring(f);
    const d = await service.getBout(f.boutId);
    expect(d.aka).toMatchObject({ kata: 20, kataName: expect.any(String), name: expect.stringContaining('Aka'), country: 'BEN' });
    expect(d.ao).toMatchObject({ kata: 30, name: expect.stringContaining('Ao'), country: 'FRA' });
    expect(d).toMatchObject({ category: 'Kata individuel senior', stage: { label: 'Tour 2', type: 'ELIMINATION' } });

    expect((await service.activeBouts()).map((b) => b.id)).toContain(f.boutId);
    expect(await service.activeBouts('00000000-0000-0000-0000-000000000000')).toEqual([]); // autre tatami : rien
    const judge = panel[0]!.officialId;
    const before = (await service.boutsForJudge(judge)).find((b) => b.id === f.boutId);
    expect(before?.mine.submitted).toBe(false);
    await service.submitScore(f.boutId, judge, 70, 60);
    expect((await service.boutsForJudge(judge)).find((b) => b.id === f.boutId)?.mine.submitted).toBe(true);
    expect(await service.boutsForJudge(f.excludedJudges[0]!)).toEqual([]); // hors panel : rien
  });

  it('une disqualification (0,0) donne les 7 votes à l\'adversaire', async () => {
    const f = await fx();
    const panel = await toScoring(f);
    const ao = [60, 65, 70, 55, 50, 90, 100];
    let last;
    for (let i = 0; i < 7; i++) last = await service.submitScore(f.boutId, panel[i]!.officialId, 0, ao[i]!);
    expect(last!.result).toMatchObject({ winner: 'AO', akaVotes: 0, aoVotes: 7, resultType: 'DISQUALIFICATION' });
  });

  it('applique les règles de répétition des katas (5.2)', async () => {
    const f = await fx({ prevKata: 20 }); // l'AKA a déjà exécuté le kata 20 au tour 1
    await expect(service.declareKata(f.boutId, 'AKA', 20)).rejects.toMatchObject({ response: { code: 'MUST_BE_DIFFERENT' } });
    await expect(service.declareKata(f.boutId, 'AKA', 0)).rejects.toMatchObject({ response: { code: 'KATA_NOT_IN_LIST' } });
    await expect(service.declareKata(f.boutId, 'AKA', 103)).rejects.toMatchObject({ response: { code: 'KATA_NOT_IN_LIST' } });
    await service.declareKata(f.boutId, 'AKA', 21);
    expect((await row('SELECT aka_kata FROM bouts WHERE id = $1', [f.boutId])).aka_kata).toBe(21);
    await service.declareKata(f.boutId, 'AKA', 22); // le kata peut être corrigé avant le combat
    expect((await row('SELECT aka_kata FROM bouts WHERE id = $1', [f.boutId])).aka_kata).toBe(22);
  });

  it('au tour des médailles, un kata déjà exécuté une fois reste permis (5.2.1)', async () => {
    const f = await fx({ prevKata: 20, stageType: 'MEDAL' });
    await service.declareKata(f.boutId, 'AKA', 20);
    expect((await row('SELECT aka_kata FROM bouts WHERE id = $1', [f.boutId])).aka_kata).toBe(20);
  });

  it('impose l\'ordre : katas, puis panel, avant que le premier ne passe', async () => {
    const f = await fx();
    expect(await service.advance(f.boutId)).toBe('CALLED');
    await expect(service.advance(f.boutId)).rejects.toMatchObject({ response: { code: 'AKA_KATA_MISSING' } });
    await service.declareKata(f.boutId, 'AKA', 20);
    await expect(service.advance(f.boutId)).rejects.toMatchObject({ response: { code: 'AO_KATA_MISSING' } });
    await service.declareKata(f.boutId, 'AO', 30);
    await expect(service.advance(f.boutId)).rejects.toMatchObject({ response: { code: 'PANEL_INCOMPLETE' } });
    await service.drawPanel(f.boutId);
    expect(await service.advance(f.boutId)).toBe('AKA_PERFORMING');
    await expect(service.drawPanel(f.boutId)).rejects.toMatchObject({ response: { code: 'PANEL_LOCKED' } });
    await expect(service.confirm(f.boutId)).rejects.toMatchObject({ response: { code: 'NOT_REVEALED' } });
  });

  it('refuse le tirage s\'il n\'y a pas assez de juges éligibles (4.8)', async () => {
    const f = await fx({ panelSize: 9 });
    await expect(service.drawPanel(f.boutId)).rejects.toMatchObject({ code: 'NOT_ENOUGH_JUDGES' });
  });

  it('Kiken : l\'adversaire gagne avec 4 votes, l\'absent est sorti de la catégorie et le vainqueur avance', async () => {
    const f = await fx();
    await service.kiken(f.boutId, 'AO');
    const b = await row('SELECT status, result_type, winner_entry_id, aka_votes, ao_votes FROM bouts WHERE id = $1', [f.boutId]);
    expect(b).toEqual({ status: 'CONFIRMED', result_type: 'KIKEN', winner_entry_id: f.akaEntry, aka_votes: 4, ao_votes: 0 });
    expect((await row('SELECT status FROM entries WHERE id = $1', [f.aoEntry])).status).toBe('KIKEN');
    expect((await row('SELECT ao_entry_id FROM bouts WHERE id = $1', [f.nextBoutId])).ao_entry_id).toBe(f.akaEntry);
    expect((await row('SELECT count(*)::int AS n FROM incidents WHERE bout_id = $1', [f.boutId])).n).toBe(1);
  });

  it('double disqualification : combat clos sans vainqueur et combat supplémentaire créé (3.7.10)', async () => {
    const f = await fx();
    await toScoring(f);
    const { extraBoutId } = await service.declareDoubleDisqualification(f.boutId);

    const original = await row('SELECT status, result_type, winner_entry_id FROM bouts WHERE id = $1', [f.boutId]);
    expect(original).toEqual({ status: 'CONFIRMED', result_type: 'DISQUALIFICATION', winner_entry_id: null });

    const extra = await row('SELECT status, is_extra, aka_entry_id, ao_entry_id, position FROM bouts WHERE id = $1', [extraBoutId]);
    expect(extra).toEqual({ status: 'SCHEDULED', is_extra: true, aka_entry_id: f.akaEntry, ao_entry_id: f.aoEntry, position: 3 });
  });
});
