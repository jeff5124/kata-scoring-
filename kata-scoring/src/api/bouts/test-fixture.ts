import type { Pool } from 'pg';

export interface Fixture {
  competitionId: string;
  categoryId: string;
  stageId: string;
  boutId: string;
  nextBoutId: string;
  akaEntry: string;
  aoEntry: string;
  /** Juges éligibles (7). */
  judges: string[];
  /** Juges de la même fédération que l'AKA : exclus du tirage (4.8). */
  excludedJudges: string[];
  federationIds: string[];
  athleteIds: string[];
}

let counter = 0;

/** Crée une compétition complète avec un combat prêt à être joué (données de test jetables). */
export async function makeFixture(
  pool: Pool,
  opts: { panelSize?: number; prevKata?: number; stageType?: string } = {},
): Promise<Fixture> {
  const n = `${Date.now()}-${++counter}`;
  const one = async (sql: string, params: unknown[]): Promise<string> => (await pool.query(sql, params)).rows[0].id;

  const competitionId = await one(`INSERT INTO competitions (name, starts_on) VALUES ($1, current_date) RETURNING id`, [`Test ${n}`]);
  const categoryId = await one(
    `INSERT INTO categories (competition_id, name, kind, sex, age_min) VALUES ($1, 'Kata individuel senior', 'INDIVIDUAL', 'M', 16) RETURNING id`,
    [competitionId],
  );

  const fed = (name: string, country: string) =>
    one(`INSERT INTO federations (name, country) VALUES ($1, $2) RETURNING id`, [`${name} ${n}`, country]);
  const fA = await fed('Fédération A', 'BEN');
  const fB = await fed('Fédération B', 'FRA');
  const federationIds = [fA, fB];

  const athlete = (fedId: string, last: string) =>
    one(
      `INSERT INTO athletes (federation_id, first_name, last_name, sex, birth_date) VALUES ($1, 'Test', $2, 'M', '2000-01-01') RETURNING id`,
      [fedId, last],
    );
  const athleteIds = [await athlete(fA, 'Aka'), await athlete(fB, 'Ao'), await athlete(fB, 'Autre')];
  const entry = (athleteId: string) =>
    one(`INSERT INTO entries (category_id, athlete_id) VALUES ($1, $2) RETURNING id`, [categoryId, athleteId]);
  const akaEntry = await entry(athleteIds[0]!);
  const aoEntry = await entry(athleteIds[1]!);
  const otherEntry = await entry(athleteIds[2]!);

  const judge = (fedId: string, name: string) =>
    one(
      `INSERT INTO officials (competition_id, federation_id, full_name, role) VALUES ($1, $2, $3, 'JUDGE') RETURNING id`,
      [competitionId, fedId, name],
    );
  const judges: string[] = [];
  for (let i = 1; i <= 7; i++) {
    const f = await fed(`Fédération juge ${i}`, `T0${i}`);
    federationIds.push(f);
    judges.push(await judge(f, `Juge ${i}`));
  }
  const excludedJudges = [await judge(fA, 'Juge exclu 1'), await judge(fA, 'Juge exclu 2')];

  const panelSize = opts.panelSize ?? 7;
  const stage = (type: string, round: number, label: string) =>
    one(
      `INSERT INTO stages (category_id, type, round_no, label, panel_size) VALUES ($1, $2::stage_type, $3, $4, $5) RETURNING id`,
      [categoryId, type, round, label, panelSize],
    );

  if (opts.prevKata !== undefined) {
    const prevStage = await stage('ELIMINATION', 1, 'Tour 1');
    await pool.query(
      `INSERT INTO bouts (stage_id, position, aka_entry_id, ao_entry_id, aka_kata, ao_kata, status, panel_size)
       VALUES ($1, 1, $2, $3, $4, 21, 'CONFIRMED', $5)`,
      [prevStage, akaEntry, otherEntry, opts.prevKata, panelSize],
    );
  }

  const stageId = await stage(opts.stageType ?? 'ELIMINATION', 2, 'Tour 2');
  const nextBoutId = await one(`INSERT INTO bouts (stage_id, position, panel_size) VALUES ($1, 2, $2) RETURNING id`, [stageId, panelSize]);
  const boutId = await one(
    `INSERT INTO bouts (stage_id, position, aka_entry_id, ao_entry_id, panel_size, next_bout_id, next_bout_side)
     VALUES ($1, 1, $2, $3, $4, $5, 'AO') RETURNING id`,
    [stageId, akaEntry, aoEntry, panelSize, nextBoutId],
  );

  return {
    competitionId, categoryId, stageId, boutId, nextBoutId, akaEntry, aoEntry,
    judges, excludedJudges, federationIds, athleteIds,
  };
}

export async function cleanup(pool: Pool, fixtures: Fixture[]): Promise<void> {
  if (!fixtures.length) return;
  const comps = fixtures.map((f) => f.competitionId);
  const boutIds = `SELECT b.id FROM bouts b JOIN stages s ON s.id = b.stage_id JOIN categories c ON c.id = s.category_id WHERE c.competition_id = ANY($1::uuid[])`;
  // Les juges sont référencés par le panel et les notes : on supprime d'abord les combats.
  await pool.query('DELETE FROM app_users WHERE competition_id = ANY($1::uuid[]) OR official_id IN (SELECT id FROM officials WHERE competition_id = ANY($1::uuid[]))', [comps]);
  await pool.query(`DELETE FROM scores WHERE bout_id IN (${boutIds})`, [comps]);
  await pool.query(`DELETE FROM bout_panel WHERE bout_id IN (${boutIds})`, [comps]);
  await pool.query(`UPDATE bouts SET next_bout_id = NULL, loser_next_bout_id = NULL WHERE id IN (${boutIds})`, [comps]);
  await pool.query(`DELETE FROM incidents WHERE bout_id IN (${boutIds})`, [comps]);
  await pool.query(`DELETE FROM bouts WHERE id IN (${boutIds})`, [comps]);
  await pool.query(`DELETE FROM group_members WHERE group_id IN (SELECT g.id FROM groups g JOIN stages s ON s.id = g.stage_id JOIN categories c ON c.id = s.category_id WHERE c.competition_id = ANY($1::uuid[]))`, [comps]);
  await pool.query('DELETE FROM competitions WHERE id = ANY($1::uuid[])', [comps]);
  await pool.query('DELETE FROM athletes WHERE id = ANY($1::uuid[])', [fixtures.flatMap((f) => f.athleteIds)]);
  await pool.query('DELETE FROM federations WHERE id = ANY($1::uuid[])', [fixtures.flatMap((f) => f.federationIds)]);
}

export interface CategoryFixture {
  competitionId: string;
  categoryId: string;
  /** Inscrits, dans l'ordre de création (index 0 = le mieux classé du scénario). */
  entries: string[];
  judges: string[];
  federationIds: string[];
  athleteIds: string[];
}

/** Catégorie individuelle avec `n` inscrits (chacun dans sa fédération) et 9 juges d'autres fédérations. */
export async function makeCategory(pool: Pool, n: number, seeds: Record<number, number> = {}): Promise<CategoryFixture> {
  const tag = `${Date.now()}-${++counter}`;
  const one = async (sql: string, params: unknown[]): Promise<string> => (await pool.query(sql, params)).rows[0].id;
  const competitionId = await one(`INSERT INTO competitions (name, starts_on) VALUES ($1, current_date) RETURNING id`, [`Tirage ${tag}`]);
  const categoryId = await one(
    `INSERT INTO categories (competition_id, name, kind, sex, age_min) VALUES ($1, 'Kata individuel', 'INDIVIDUAL', 'M', 16) RETURNING id`,
    [competitionId],
  );
  const federationIds: string[] = [];
  const athleteIds: string[] = [];
  const entries: string[] = [];
  for (let i = 0; i < n; i++) {
    const fed = await one(`INSERT INTO federations (name, country) VALUES ($1, $2) RETURNING id`, [`Fed ${tag} ${i}`, `A${i}`]);
    federationIds.push(fed);
    const ath = await one(
      `INSERT INTO athletes (federation_id, first_name, last_name, sex, birth_date, world_rank) VALUES ($1, 'Ath', $2, 'M', '2000-01-01', $3) RETURNING id`,
      [fed, `N${String(i).padStart(2, '0')}`, i + 1],
    );
    athleteIds.push(ath);
    entries.push(await one(`INSERT INTO entries (category_id, athlete_id, seed) VALUES ($1, $2, $3) RETURNING id`, [categoryId, ath, seeds[i] ?? null]));
  }
  const judges: string[] = [];
  for (let i = 0; i < 9; i++) {
    const fed = await one(`INSERT INTO federations (name, country) VALUES ($1, $2) RETURNING id`, [`FedJ ${tag} ${i}`, `J${i}`]);
    federationIds.push(fed);
    judges.push(
      await one(`INSERT INTO officials (competition_id, federation_id, full_name, role) VALUES ($1, $2, $3, 'JUDGE') RETURNING id`, [competitionId, fed, `Juge ${i}`]),
    );
  }
  return { competitionId, categoryId, entries, judges, federationIds, athleteIds };
}

export async function cleanupCategory(pool: Pool, f: CategoryFixture): Promise<void> {
  await cleanup(pool, [{ competitionId: f.competitionId, athleteIds: f.athleteIds, federationIds: f.federationIds } as Fixture]);
}
