import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomInt } from 'node:crypto';
import { Database } from '../database.js';
import { AuthService } from '../auth/auth.service.js';
import type { Role } from '../auth/roles.js';
import { BoutsService } from '../bouts/bouts.service.js';
import { DrawService } from '../draw/draw.service.js';
import { assertUuid } from '../bouts/parse.js';

const bad = (message: string) => new BadRequestException({ code: 'INVALID_INPUT', message });
const conflict = (code: string, message: string) => new ConflictException({ code, message });

function text(value: unknown, field: string, max = 200): string {
  if (typeof value !== 'string' || !value.trim()) throw bad(`${field} est requis`);
  if (value.length > max) throw bad(`${field} : ${max} caractères maximum`);
  return value.trim();
}

function optText(value: unknown, field: string): string | null {
  return value == null || value === '' ? null : text(value, field);
}

function date(value: unknown, field: string): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw bad(`${field} : date au format AAAA-MM-JJ`);
  return value;
}

function int(value: unknown, field: string, min: number, max: number): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) throw bad(`${field} : entier entre ${min} et ${max}`);
  return n;
}

function optInt(value: unknown, field: string, min: number, max: number): number | null {
  return value == null || value === '' ? null : int(value, field, min, max);
}

function sex(value: unknown): 'M' | 'F' {
  if (value === 'M' || value === 'F') return value;
  throw bad('sex doit valoir M ou F');
}

const FORMATS = ['ELIMINATION_REPECHAGE', 'ROUND_ROBIN_THEN_ELIMINATION'] as const;
const OFFICIAL_ROLES = ['JUDGE', 'TATAMI_MANAGER', 'TECHNICIAN', 'ANNOUNCER', 'RUNNER', 'TIMEKEEPER', 'APPEAL_JURY'] as const;
/** Rôle du compte de connexion créé avec un officiel (les autres fonctions n'ont pas d'écran). */
const ACCOUNT_ROLE: Partial<Record<(typeof OFFICIAL_ROLES)[number], Role>> = {
  JUDGE: 'JUDGE',
  TATAMI_MANAGER: 'TATAMI_MANAGER',
  TECHNICIAN: 'TECHNICIAN',
  RUNNER: 'RUNNER',
};

/** Gestion d'une compétition : référentiels, inscriptions, officiels, tatamis, et jeu de démonstration. */
@Injectable()
export class AdminService {
  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(DrawService) private readonly draw: DrawService,
    @Inject(BoutsService) private readonly bouts: BoutsService,
  ) {}

  // ───────────── Compétitions ─────────────

  async listCompetitions() {
    const { rows } = await this.db.pool.query(
      `SELECT id, name, location, starts_on::text AS "startsOn", ends_on::text AS "endsOn",
              COALESCE((settings->>'demo')::boolean, false) AS demo
         FROM competitions ORDER BY starts_on DESC, created_at DESC`,
    );
    return rows;
  }

  async createCompetition(body: Record<string, unknown>) {
    const { rows } = await this.db.pool.query(
      `INSERT INTO competitions (name, location, starts_on, ends_on) VALUES ($1, $2, $3, $4)
       RETURNING id, name, location, starts_on::text AS "startsOn", ends_on::text AS "endsOn"`,
      [text(body.name, 'name'), optText(body.location, 'location'), date(body.startsOn, 'startsOn'), body.endsOn ? date(body.endsOn, 'endsOn') : null],
    );
    return rows[0];
  }

  /** Vue complète d'une compétition : catégories (avec état du tirage), tatamis, officiels et leurs comptes. */
  async getCompetition(id: string) {
    assertUuid(id, 'competitionId');
    const c = this.db.pool;
    const comp = await c.query(
      `SELECT id, name, location, starts_on::text AS "startsOn", ends_on::text AS "endsOn", settings,
              COALESCE((settings->>'demo')::boolean, false) AS demo
         FROM competitions WHERE id = $1`,
      [id],
    );
    if (!comp.rows[0]) throw new NotFoundException({ code: 'COMPETITION_NOT_FOUND', message: 'Compétition introuvable' });
    const categories = await c.query(
      `SELECT cat.id, cat.name, cat.kind::text AS kind, cat.sex, cat.age_min AS "ageMin", cat.age_max AS "ageMax",
              cat.is_u14 AS "isU14", cat.format::text AS format,
              (SELECT count(*)::int FROM entries e WHERE e.category_id = cat.id) AS "entryCount",
              EXISTS (SELECT 1 FROM stages s WHERE s.category_id = cat.id) AS drawn,
              (SELECT count(*)::int FROM bouts b JOIN stages s ON s.id = b.stage_id WHERE s.category_id = cat.id) AS "boutCount",
              (SELECT count(*)::int FROM bouts b JOIN stages s ON s.id = b.stage_id
                WHERE s.category_id = cat.id AND b.status = 'CONFIRMED') AS "confirmedCount",
              (SELECT b.tatami_id FROM bouts b JOIN stages s ON s.id = b.stage_id
                WHERE s.category_id = cat.id AND b.tatami_id IS NOT NULL
                GROUP BY b.tatami_id ORDER BY count(*) DESC LIMIT 1) AS "tatamiId"
         FROM categories cat WHERE cat.competition_id = $1 ORDER BY cat.name`,
      [id],
    );
    const tatamis = await c.query(
      `SELECT t.id, t.number, t.manager_id AS "managerId" FROM tatamis t WHERE t.competition_id = $1 ORDER BY t.number`,
      [id],
    );
    const officials = await c.query(
      `SELECT o.id, o.full_name AS "fullName", o.role::text AS role, o.is_available AS "isAvailable",
              o.federation_id AS "federationId", f.country::text AS country, u.email
         FROM officials o
         LEFT JOIN federations f ON f.id = o.federation_id
         LEFT JOIN app_users u ON u.official_id = o.id
        WHERE o.competition_id = $1 ORDER BY o.role, o.full_name`,
      [id],
    );
    return { ...comp.rows[0], categories: categories.rows, tatamis: tatamis.rows, officials: officials.rows };
  }

  // ───────────── Fédérations et athlètes ─────────────

  async listFederations() {
    const { rows } = await this.db.pool.query(`SELECT id, name, country::text AS country FROM federations ORDER BY country, name`);
    return rows;
  }

  async createFederation(body: Record<string, unknown>) {
    const country = text(body.country, 'country', 3).toUpperCase();
    if (!/^[A-Z]{3}$/.test(country)) throw bad('country : code pays à 3 lettres (ex. FRA)');
    const { rows } = await this.db.pool.query(
      `INSERT INTO federations (name, country) VALUES ($1, $2) RETURNING id, name, country::text AS country`,
      [text(body.name, 'name'), country],
    );
    return rows[0];
  }

  async listAthletes() {
    const { rows } = await this.db.pool.query(
      `SELECT a.id, a.first_name AS "firstName", a.last_name AS "lastName", a.sex, a.birth_date::text AS "birthDate",
              a.world_rank AS "worldRank", a.federation_id AS "federationId", f.country::text AS country
         FROM athletes a JOIN federations f ON f.id = a.federation_id
        ORDER BY a.last_name, a.first_name`,
    );
    return rows;
  }

  async createAthlete(body: Record<string, unknown>) {
    const federationId = assertUuid(body.federationId, 'federationId');
    try {
      const { rows } = await this.db.pool.query(
        `INSERT INTO athletes (federation_id, first_name, last_name, sex, birth_date, world_rank)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, first_name AS "firstName", last_name AS "lastName", sex, birth_date::text AS "birthDate", world_rank AS "worldRank"`,
        [federationId, text(body.firstName, 'firstName'), text(body.lastName, 'lastName'), sex(body.sex), date(body.birthDate, 'birthDate'),
          optInt(body.worldRank, 'worldRank', 1, 100000)],
      );
      return rows[0];
    } catch (e) {
      if ((e as { code?: string }).code === '23503') throw bad('Fédération inconnue');
      throw e;
    }
  }

  // ───────────── Catégories et inscriptions ─────────────

  async createCategory(competitionId: string, body: Record<string, unknown>) {
    assertUuid(competitionId, 'competitionId');
    const format = body.format ?? 'ELIMINATION_REPECHAGE';
    if (!FORMATS.includes(format as (typeof FORMATS)[number])) throw bad(`format : ${FORMATS.join(' ou ')}`);
    try {
      const { rows } = await this.db.pool.query(
        `INSERT INTO categories (competition_id, name, kind, sex, age_min, age_max, is_u14, format)
         VALUES ($1, $2, 'INDIVIDUAL', $3, $4, $5, $6, $7::competition_format)
         RETURNING id, name, sex, age_min AS "ageMin", age_max AS "ageMax", is_u14 AS "isU14", format::text AS format`,
        [competitionId, text(body.name, 'name'), sex(body.sex), int(body.ageMin, 'ageMin', 5, 99), optInt(body.ageMax, 'ageMax', 5, 99),
          body.isU14 === true, format],
      );
      return rows[0];
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (code === '23505') throw conflict('CATEGORY_EXISTS', 'Une catégorie porte déjà ce nom');
      if (code === '23503') throw new NotFoundException({ code: 'COMPETITION_NOT_FOUND', message: 'Compétition introuvable' });
      throw e;
    }
  }

  async listEntries(categoryId: string) {
    assertUuid(categoryId, 'categoryId');
    const { rows } = await this.db.pool.query(
      `SELECT e.id, e.seed, e.status::text AS status, a.id AS "athleteId",
              a.last_name || ' ' || a.first_name AS name, f.country::text AS country, a.world_rank AS "worldRank"
         FROM entries e JOIN athletes a ON a.id = e.athlete_id JOIN federations f ON f.id = a.federation_id
        WHERE e.category_id = $1
        ORDER BY e.seed NULLS LAST, a.world_rank NULLS LAST, a.last_name`,
      [categoryId],
    );
    return rows;
  }

  private async assertNotDrawn(categoryId: string) {
    const drawn = await this.db.pool.query('SELECT 1 FROM stages WHERE category_id = $1 LIMIT 1', [categoryId]);
    if (drawn.rowCount) throw conflict('ALREADY_DRAWN', 'Le tirage est fait : les inscriptions sont figées');
  }

  async addEntry(categoryId: string, body: Record<string, unknown>) {
    assertUuid(categoryId, 'categoryId');
    const athleteId = assertUuid(body.athleteId, 'athleteId');
    await this.assertNotDrawn(categoryId);
    const check = await this.db.pool.query<{ cat_sex: string; ath_sex: string }>(
      `SELECT c.sex AS cat_sex, a.sex AS ath_sex FROM categories c, athletes a WHERE c.id = $1 AND a.id = $2`,
      [categoryId, athleteId],
    );
    const row = check.rows[0];
    if (!row) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Catégorie ou athlète introuvable' });
    if (row.cat_sex !== row.ath_sex) throw bad("Le sexe de l'athlète ne correspond pas à la catégorie");
    try {
      const { rows } = await this.db.pool.query(
        `INSERT INTO entries (category_id, athlete_id, seed) VALUES ($1, $2, $3) RETURNING id, seed`,
        [categoryId, athleteId, optInt(body.seed, 'seed', 1, 128)],
      );
      return rows[0];
    } catch (e) {
      if ((e as { code?: string }).code === '23505') throw conflict('ALREADY_ENTERED', 'Athlète déjà inscrit dans cette catégorie');
      throw e;
    }
  }

  async removeEntry(entryId: string) {
    assertUuid(entryId, 'entryId');
    const { rows } = await this.db.pool.query<{ category_id: string }>('SELECT category_id FROM entries WHERE id = $1', [entryId]);
    if (!rows[0]) throw new NotFoundException({ code: 'ENTRY_NOT_FOUND', message: 'Inscription introuvable' });
    await this.assertNotDrawn(rows[0].category_id);
    await this.db.pool.query('DELETE FROM entries WHERE id = $1', [entryId]);
    return { ok: true };
  }

  // ───────────── Officiels et tatamis ─────────────

  /** Crée un officiel et, si e-mail et mot de passe sont fournis, son compte de connexion. */
  async createOfficial(competitionId: string, body: Record<string, unknown>) {
    assertUuid(competitionId, 'competitionId');
    const role = body.role as (typeof OFFICIAL_ROLES)[number];
    if (!OFFICIAL_ROLES.includes(role)) throw bad(`role : ${OFFICIAL_ROLES.join(', ')}`);
    const federationId = body.federationId ? assertUuid(body.federationId, 'federationId') : null;
    const email = optText(body.email, 'email');
    const accountRole = ACCOUNT_ROLE[role];
    if (email && !accountRole) throw bad(`Pas de compte de connexion pour le rôle ${role}`);
    if (email && (typeof body.password !== 'string' || body.password.length < 8)) throw bad('Mot de passe : 8 caractères minimum');

    const { rows } = await this.db.pool.query<{ id: string }>(
      `INSERT INTO officials (competition_id, federation_id, full_name, role) VALUES ($1, $2, $3, $4::official_role) RETURNING id`,
      [competitionId, federationId, text(body.fullName, 'fullName'), role],
    );
    const id = rows[0]!.id;
    if (email && accountRole) {
      try {
        await this.auth.createUser({ email, password: body.password as string, role: accountRole, officialId: id, competitionId });
      } catch (e) {
        await this.db.pool.query('DELETE FROM officials WHERE id = $1', [id]); // pas d'officiel sans le compte demandé
        throw e;
      }
    }
    return { id, email };
  }

  async setOfficialAvailability(officialId: string, body: Record<string, unknown>) {
    assertUuid(officialId, 'officialId');
    if (typeof body.isAvailable !== 'boolean') throw bad('isAvailable : true ou false');
    const r = await this.db.pool.query('UPDATE officials SET is_available = $2 WHERE id = $1', [officialId, body.isAvailable]);
    if (!r.rowCount) throw new NotFoundException({ code: 'OFFICIAL_NOT_FOUND', message: 'Officiel introuvable' });
    return { ok: true };
  }

  async createTatami(competitionId: string, body: Record<string, unknown>) {
    assertUuid(competitionId, 'competitionId');
    try {
      const { rows } = await this.db.pool.query(
        `INSERT INTO tatamis (competition_id, number) VALUES ($1, $2) RETURNING id, number`,
        [competitionId, int(body.number, 'number', 1, 99)],
      );
      return rows[0];
    } catch (e) {
      if ((e as { code?: string }).code === '23505') throw conflict('TATAMI_EXISTS', 'Ce numéro de tatami existe déjà');
      throw e;
    }
  }

  /** Affecte à un tatami tous les combats non terminés d'une catégorie (y compris ceux créés plus tard par le repêchage). */
  async assignTatami(categoryId: string, body: Record<string, unknown>) {
    assertUuid(categoryId, 'categoryId');
    const tatamiId = assertUuid(body.tatamiId, 'tatamiId');
    const ok = await this.db.pool.query(
      `SELECT 1 FROM tatamis t JOIN categories c ON c.competition_id = t.competition_id WHERE t.id = $1 AND c.id = $2`,
      [tatamiId, categoryId],
    );
    if (!ok.rowCount) throw bad("Ce tatami n'appartient pas à la compétition de la catégorie");
    const r = await this.db.pool.query(
      `UPDATE bouts SET tatami_id = $2
        WHERE stage_id IN (SELECT id FROM stages WHERE category_id = $1) AND status NOT IN ('CONFIRMED', 'CANCELLED')`,
      [categoryId, tatamiId],
    );
    return { updated: r.rowCount };
  }

  async katas() {
    const { rows } = await this.db.pool.query('SELECT number, name FROM katas ORDER BY number');
    return rows;
  }

  // ───────────── Démonstration ─────────────

  /**
   * Compétition de démonstration prête à jouer : 8 athlètes, 7 juges (comptes juge1…juge7@demo.local),
   * un compte de table, un tatami, le tirage fait et affecté au tatami.
   */
  async createDemo() {
    const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
    const suffix = randomInt(1000, 9999);
    const comp = await this.db.pool.query<{ id: string }>(
      `INSERT INTO competitions (name, location, starts_on, settings)
       VALUES ($1, 'Salle de démonstration', CURRENT_DATE,
               '{"panelSizeRoundRobin":7,"panelSizeElimination":5,"panelSizeMedal":7,"consecutiveRuleInMedalRound":false,"demo":true}'::jsonb)
       RETURNING id`,
      [`Démonstration ${stamp}`],
    );
    const competitionId = comp.rows[0]!.id;

    const feds: string[] = [];
    for (const [name, country] of [['Fédération française', 'FRA'], ['Federazione italiana', 'ITA'], ['Federación española', 'ESP'], ['Japan Karate Federation', 'JPN']]) {
      feds.push((await this.db.pool.query<{ id: string }>(`INSERT INTO federations (name, country) VALUES ($1, $2) RETURNING id`, [name, country])).rows[0]!.id);
    }
    const people = [
      ['Lucas', 'Martin'], ['Marco', 'Rossi'], ['Javier', 'García'], ['Ryo', 'Kiyuna'],
      ['Hugo', 'Bernard'], ['Luca', 'Bianchi'], ['Pablo', 'López'], ['Kazumasa', 'Moto'],
    ] as const;
    const category = await this.db.pool.query<{ id: string }>(
      `INSERT INTO categories (competition_id, name, kind, sex, age_min, format) VALUES ($1, 'Kata individuel senior hommes', 'INDIVIDUAL', 'M', 18, 'ELIMINATION_REPECHAGE') RETURNING id`,
      [competitionId],
    );
    const categoryId = category.rows[0]!.id;
    for (let i = 0; i < people.length; i++) {
      const [first, last] = people[i]!;
      const a = await this.db.pool.query<{ id: string }>(
        `INSERT INTO athletes (federation_id, first_name, last_name, sex, birth_date, world_rank) VALUES ($1, $2, $3, 'M', $4, $5) RETURNING id`,
        [feds[i % feds.length], first, last, `${1995 + i}-03-1${i}`, i + 1],
      );
      await this.db.pool.query(`INSERT INTO entries (category_id, athlete_id, seed) VALUES ($1, $2, $3)`, [categoryId, a.rows[0]!.id, i < 4 ? i + 1 : null]);
    }

    const tatami = await this.db.pool.query<{ id: string }>(`INSERT INTO tatamis (competition_id, number) VALUES ($1, 1) RETURNING id`, [competitionId]);
    const accounts: { email: string; password: string; role: string }[] = [];
    const judgePassword = 'Juge1234!';
    for (let j = 1; j <= 7; j++) {
      const email = `juge${j}.${suffix}@demo.local`;
      await this.createOfficial(competitionId, { fullName: `Juge ${j}`, role: 'JUDGE', email, password: judgePassword });
      accounts.push({ email, password: judgePassword, role: 'JUDGE' });
    }
    const tableEmail = `table.${suffix}@demo.local`;
    await this.createOfficial(competitionId, { fullName: 'Table officielle', role: 'TECHNICIAN', email: tableEmail, password: 'Table1234!' });
    accounts.push({ email: tableEmail, password: 'Table1234!', role: 'TECHNICIAN' });

    await this.draw.draw(categoryId, {});
    await this.assignTatami(categoryId, { tatamiId: tatami.rows[0]!.id });
    return { competitionId, categoryId, tatamiId: tatami.rows[0]!.id, accounts };
  }

  /** Démonstration uniquement : note à la place des juges du panel qui n'ont pas encore noté. */
  async simulateScores(boutId: string) {
    assertUuid(boutId, 'boutId');
    const { rows } = await this.db.pool.query<{ demo: boolean; status: string }>(
      `SELECT COALESCE((comp.settings->>'demo')::boolean, false) AS demo, b.status::text AS status
         FROM bouts b JOIN stages s ON s.id = b.stage_id JOIN categories c ON c.id = s.category_id
         JOIN competitions comp ON comp.id = c.competition_id WHERE b.id = $1`,
      [boutId],
    );
    if (!rows[0]) throw new NotFoundException({ code: 'BOUT_NOT_FOUND', message: 'Combat introuvable' });
    if (!rows[0].demo) throw new ForbiddenException({ code: 'NOT_DEMO', message: 'Réservé aux compétitions de démonstration' });
    if (rows[0].status !== 'SCORING') throw conflict('NOT_SCORING', `La notation est fermée (statut ${rows[0].status})`);
    const missing = await this.db.pool.query<{ official_id: string }>(
      `SELECT p.official_id FROM bout_panel p
        WHERE p.bout_id = $1
          AND (SELECT count(*) FROM scores s WHERE s.bout_id = p.bout_id AND s.official_id = p.official_id) < 2
        ORDER BY p.position`,
      [boutId],
    );
    let last = null;
    for (const m of missing.rows) {
      const aka = randomInt(60, 91);
      let ao = randomInt(60, 91);
      if (ao === aka) ao = aka === 90 ? 89 : aka + 1;
      last = await this.bouts.submitScore(boutId, m.official_id, aka, ao);
    }
    return { simulated: missing.rows.length, revealed: last?.revealed ?? false };
  }
}
