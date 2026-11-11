import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomInt } from 'node:crypto';
import type { PoolClient } from 'pg';
import { Database } from '../database.js';
import {
  distributeToGroups,
  eliminationPlan,
  knockoutPairs,
  nextPow2,
  qualificationRule,
  rankGroup,
  roundRobinSchedule,
  selectBestAcrossGroups,
  splitInTwoPools,
  type BoutRecord,
  type PlanSource,
  type Competitor,
  type Qualifier,
  type Rng,
  type Standing,
} from '../../rules/index.js';
import { assertUuid } from '../bouts/parse.js';

const conflict = (code: string, message: string, extra: object = {}) => new ConflictException({ code, message, ...extra });
class RuleErrorLike extends BadRequestException {
  constructor(n: number) {
    super({ code: 'PLAYER_COUNT_UNSUPPORTED', message: `Élimination avec repêchage : 4 à 128 inscrits (${n})` });
  }
}
const cryptoRng: Rng = () => randomInt(0, 2 ** 30) / 2 ** 30;

export interface DrawOptions {
  /** Format à utiliser ; par défaut celui de la catégorie (élimination avec repêchage, 3.3.1 a). */
  format?: 'ROUND_ROBIN_THEN_ELIMINATION' | 'ELIMINATION_REPECHAGE';
  poolPanelSize?: number;
  knockoutPanelSize?: number;
  medalPanelSize?: number;
}

export interface KnockoutOptions extends DrawOptions {
  /** Départage à la limite de qualification (5.13) : identifiants retenus après le kata supplémentaire. */
  cutoffWinners?: string[];
}

function panelSize(value: number | undefined, fallback: number, name: string): number {
  const n = value ?? fallback;
  if (!Number.isInteger(n) || n < 3 || n > 9 || n % 2 === 0) {
    throw new BadRequestException({ code: 'INVALID_PANEL_SIZE', message: `${name} : nombre impair entre 3 et 9` });
  }
  return n;
}

interface PoolBout {
  id: string;
  group_id: string;
  aka_entry_id: string;
  ao_entry_id: string;
  status: string;
  winner_entry_id: string | null;
  aka_votes: number | null;
  ao_votes: number | null;
  is_extra: boolean;
}

@Injectable()
export class DrawService {
  constructor(@Inject(Database) private readonly db: Database) {}

  private async lockCategory(c: PoolClient, categoryId: string) {
    assertUuid(categoryId, 'categoryId');
    const { rows } = await c.query(`SELECT id, kind::text AS kind FROM categories WHERE id = $1 FOR UPDATE`, [categoryId]);
    if (!rows[0]) throw new NotFoundException({ code: 'CATEGORY_NOT_FOUND', message: 'Catégorie introuvable' });
    return rows[0] as { id: string; kind: 'INDIVIDUAL' | 'TEAM' };
  }

  /** Tirage au sort des poules (tableau 3.7.9) et création de tous les combats toutes rondes. */
  async drawPools(categoryId: string, opts: DrawOptions = {}, rng: Rng = cryptoRng) {
    const pool = panelSize(opts.poolPanelSize, 7, 'poolPanelSize');
    return this.db.tx(async (c) => {
      await this.lockCategory(c, categoryId);
      const existing = await c.query('SELECT 1 FROM stages WHERE category_id = $1 LIMIT 1', [categoryId]);
      if (existing.rowCount) throw conflict('ALREADY_DRAWN', 'Le tirage de cette catégorie a déjà été fait');

      const entries = await c.query<{ id: string; seed: number | null; fed: string | null }>(
        `SELECT e.id, e.seed, COALESCE(a.federation_id, t.federation_id) AS fed
           FROM entries e
           LEFT JOIN athletes a ON a.id = e.athlete_id
           LEFT JOIN teams t ON t.id = e.team_id
          WHERE e.category_id = $1 AND e.status = 'ACTIVE'`,
        [categoryId],
      );
      const groups = distributeToGroups(
        entries.rows.map((e) => ({ id: e.id, seed: e.seed, federationId: e.fed })),
        rng,
      ); // lève PLAYER_COUNT_UNSUPPORTED hors de 3..32

      await c.query(`UPDATE categories SET format = 'ROUND_ROBIN_THEN_ELIMINATION' WHERE id = $1`, [categoryId]);
      const stage = await c.query<{ id: string }>(
        `INSERT INTO stages (category_id, type, round_no, label, panel_size) VALUES ($1, 'ROUND_ROBIN', 1, 'Poules', $2) RETURNING id`,
        [categoryId, pool],
      );
      const stageId = stage.rows[0]!.id;

      const schedule: { groupId: string; round: number; aka: string; ao: string; groupNo: number }[] = [];
      for (let g = 0; g < groups.length; g++) {
        const label = `Groupe ${String.fromCharCode(65 + g)}`;
        const gr = await c.query<{ id: string }>(`INSERT INTO groups (stage_id, label) VALUES ($1, $2) RETURNING id`, [stageId, label]);
        const groupId = gr.rows[0]!.id;
        for (const entryId of groups[g]!) {
          await c.query('INSERT INTO group_members (group_id, entry_id) VALUES ($1, $2)', [groupId, entryId]);
        }
        for (const p of roundRobinSchedule(groups[g]!)) schedule.push({ groupId, groupNo: g, ...p });
      }
      // ordre de passage : ronde par ronde, groupe par groupe
      schedule.sort((x, y) => x.round - y.round || x.groupNo - y.groupNo);
      let position = 1;
      for (const b of schedule) {
        await c.query(
          `INSERT INTO bouts (stage_id, group_id, position, aka_entry_id, ao_entry_id, panel_size) VALUES ($1, $2, $3, $4, $5, $6)`,
          [stageId, b.groupId, position++, b.aka, b.ao, pool],
        );
      }
      return { stageId, groups: groups.map((g, i) => ({ label: `Groupe ${String.fromCharCode(65 + i)}`, entries: g })), bouts: schedule.length };
    });
  }


  /** Tirage selon le format de la catégorie (ou `opts.format`). */
  async draw(categoryId: string, opts: DrawOptions = {}, rng: Rng = cryptoRng) {
    assertUuid(categoryId, 'categoryId');
    const { rows } = await this.db.pool.query(`SELECT format::text AS format FROM categories WHERE id = $1`, [categoryId]);
    if (!rows[0]) throw new NotFoundException({ code: 'CATEGORY_NOT_FOUND', message: 'Catégorie introuvable' });
    const format = opts.format ?? rows[0].format;
    if (format === 'ROUND_ROBIN_THEN_ELIMINATION') return { format, ...(await this.drawPools(categoryId, opts, rng)) };
    if (format === 'ELIMINATION_REPECHAGE') return { format, ...(await this.drawElimination(categoryId, opts, rng)) };
    throw conflict('FORMAT_NOT_SUPPORTED', `Format non géré : ${String(format)}`);
  }

  /**
   * Élimination avec repêchage (3.6), première phase : deux poules (3.2.4), chacune en élimination directe,
   * dont les vainqueurs se retrouvent en finale. Le repêchage est généré ensuite par `generateRepechage`.
   */
  async drawElimination(categoryId: string, opts: DrawOptions = {}, rng: Rng = cryptoRng) {
    const koPanel = panelSize(opts.knockoutPanelSize, 5, 'knockoutPanelSize');
    const medalPanel = panelSize(opts.medalPanelSize, 7, 'medalPanelSize');
    return this.db.tx(async (c) => {
      await this.lockCategory(c, categoryId);
      if ((await c.query('SELECT 1 FROM stages WHERE category_id = $1 LIMIT 1', [categoryId])).rowCount) {
        throw conflict('ALREADY_DRAWN', 'Le tirage de cette catégorie a déjà été fait');
      }
      const entries = await c.query<{ id: string; seed: number | null; fed: string | null }>(
        `SELECT e.id, e.seed, COALESCE(a.federation_id, t.federation_id) AS fed
           FROM entries e LEFT JOIN athletes a ON a.id = e.athlete_id LEFT JOIN teams t ON t.id = e.team_id
          WHERE e.category_id = $1 AND e.status = 'ACTIVE'`,
        [categoryId],
      );
      if (entries.rows.length < 4 || entries.rows.length > 128) {
        throw new RuleErrorLike(entries.rows.length);
      }
      const pools = splitInTwoPools(entries.rows.map((e) => ({ id: e.id, seed: e.seed, federationId: e.fed })), rng);
      const size = nextPow2(Math.max(pools[0].length, pools[1].length));
      const plans = pools.map((ids) => eliminationPlan(ids, size));
      const depth = plans[0]!.depth;

      await c.query(`UPDATE categories SET format = 'ELIMINATION_REPECHAGE' WHERE id = $1`, [categoryId]);
      const mkStage = async (type: string, round: number, label: string, panel: number) =>
        (await c.query<{ id: string }>(
          `INSERT INTO stages (category_id, type, round_no, label, panel_size) VALUES ($1, $2::stage_type, $3, $4, $5) RETURNING id`,
          [categoryId, type, round, label, panel],
        )).rows[0]!.id;

      const stageOfLevel = new Map<number, string>();
      for (let level = 1; level <= depth; level++) {
        if (!plans.some((p) => p.matches.some((m) => m.level === level))) continue;
        const label = level === depth ? 'Finales de poule' : level === depth - 1 ? 'Demi-finales de poule' : `Tour ${level}`;
        stageOfLevel.set(level, await mkStage('ELIMINATION', level, label, koPanel));
      }
      const medalStage = await mkStage('MEDAL', depth + 1, 'Finale', medalPanel);

      const groupIds: string[] = [];
      const firstStage = stageOfLevel.get([...stageOfLevel.keys()][0]!)!;
      for (let p = 0; p < 2; p++) {
        const g = await c.query<{ id: string }>(`INSERT INTO groups (stage_id, label) VALUES ($1, $2) RETURNING id`, [firstStage, p === 0 ? 'Poule A' : 'Poule B']);
        groupIds.push(g.rows[0]!.id);
        for (const id of pools[p]!) await c.query('INSERT INTO group_members (group_id, entry_id) VALUES ($1, $2)', [g.rows[0]!.id, id]);
      }

      const final = (await c.query<{ id: string }>(
        `INSERT INTO bouts (stage_id, position, panel_size) VALUES ($1, 1, $2) RETURNING id`, [medalStage, medalPanel],
      )).rows[0]!.id;

      const positions = new Map<string, number>();
      const boutOf = new Map<string, string>(); // `${pool}:${level}:${index}`
      const sideOf = new Map<string, 'AKA' | 'AO'>();
      const swap = () => rng() < 0.5; // couleurs tirées au sort (3.1.2)
      for (let level = 1; level <= depth; level++) {
        const stageId = stageOfLevel.get(level);
        if (!stageId) continue;
        for (let p = 0; p < 2; p++) {
          for (const m of plans[p]!.matches.filter((x) => x.level === level)) {
            const [first, second] = swap() ? [m.b, m.a] : [m.a, m.b];
            const entryOf = (src: PlanSource) => (src.kind === 'entry' ? src.id : null);
            const pos = (positions.get(stageId) ?? 0) + 1;
            positions.set(stageId, pos);
            const id = (await c.query<{ id: string }>(
              `INSERT INTO bouts (stage_id, group_id, position, aka_entry_id, ao_entry_id, panel_size) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
              [stageId, groupIds[p], pos, entryOf(first), entryOf(second), koPanel],
            )).rows[0]!.id;
            boutOf.set(`${p}:${level}:${m.index}`, id);
            if (first.kind === 'match') sideOf.set(`${p}:${first.level}:${first.index}`, 'AKA');
            if (second.kind === 'match') sideOf.set(`${p}:${second.level}:${second.index}`, 'AO');
          }
        }
      }
      for (let p = 0; p < 2; p++) {
        for (const m of plans[p]!.matches) {
          const key = `${p}:${m.level}:${m.index}`;
          const isRoot = m.level === depth;
          const next = isRoot ? { id: final, side: p === 0 ? 'AKA' : 'AO' } : null;
          if (isRoot) {
            await c.query('UPDATE bouts SET next_bout_id = $2, next_bout_side = $3 WHERE id = $1', [boutOf.get(key), next!.id, next!.side]);
          }
        }
        // chaque combat alimente celui qui le suit
        for (const parent of plans[p]!.matches) {
          for (const src of [parent.a, parent.b]) {
            if (src.kind !== 'match') continue;
            await c.query('UPDATE bouts SET next_bout_id = $2, next_bout_side = $3 WHERE id = $1', [
              boutOf.get(`${p}:${src.level}:${src.index}`),
              boutOf.get(`${p}:${parent.level}:${parent.index}`),
              sideOf.get(`${p}:${src.level}:${src.index}`),
            ]);
          }
        }
      }
      return {
        pools: pools.map((ids, i) => ({ label: i === 0 ? 'Poule A' : 'Poule B', entries: ids })),
        bouts: plans.reduce((n, p) => n + p.matches.length, 0) + 1,
        depth,
      };
    });
  }

  /**
   * Repêchage (3.6.1), une fois les deux finalistes connus : les athlètes éliminés par chaque finaliste forment une nouvelle poule
   * (les éliminés les plus tard sont mieux classés et obtiennent les exempts) ; les deux derniers de chaque poule se
   * disputent une médaille de bronze. Un seul éliminé : il est médaillé de bronze sans combat.
   */
  async generateRepechage(categoryId: string, opts: DrawOptions = {}, rng: Rng = cryptoRng) {
    const koPanel = panelSize(opts.knockoutPanelSize, 5, 'knockoutPanelSize');
    const medalPanel = panelSize(opts.medalPanelSize, 7, 'medalPanelSize');
    return this.db.tx(async (c) => {
      await this.lockCategory(c, categoryId);
      const stages = await c.query<{ id: string; type: string; round_no: number }>(
        `SELECT id, type::text AS type, round_no FROM stages WHERE category_id = $1 ORDER BY round_no`, [categoryId],
      );
      const medal = stages.rows.find((s) => s.type === 'MEDAL');
      if (!medal || stages.rows.some((s) => s.type === 'ROUND_ROBIN')) {
        throw conflict('NOT_ELIMINATION_FORMAT', "Cette catégorie n'est pas en élimination avec repêchage");
      }
      const already = await c.query(
        `SELECT 1 FROM groups g JOIN stages s ON s.id = g.stage_id WHERE s.category_id = $1 AND g.label LIKE 'Repêchage%' LIMIT 1`,
        [categoryId],
      );
      if (already.rowCount) {
        throw conflict('REPECHAGE_EXISTS', 'Le repêchage a déjà été généré');
      }
      const depth = medal.round_no - 1;

      const finalRow = (await c.query<{ id: string }>(`SELECT id FROM bouts WHERE stage_id = $1 AND position = 1`, [medal.id])).rows[0]!;
      const groups = await c.query<{ id: string; label: string }>(
        `SELECT g.id, g.label FROM groups g JOIN stages s ON s.id = g.stage_id WHERE s.category_id = $1 ORDER BY g.label`, [categoryId],
      );
      if (groups.rows.length !== 2) throw conflict('NOT_ELIMINATION_FORMAT', 'Poules introuvables');

      // finaliste de chaque poule = vainqueur de la finale de poule
      const finalists: string[] = [];
      for (const g of groups.rows) {
        const root = await c.query<{ winner_entry_id: string }>(
          `SELECT winner_entry_id FROM bouts WHERE group_id = $1 AND next_bout_id = $2 AND status = 'CONFIRMED' AND winner_entry_id IS NOT NULL`,
          [g.id, finalRow.id],
        );
        if (!root.rows[0]) throw conflict('REPECHAGE_NOT_READY', `La finale de ${g.label} n'est pas terminée`);
        finalists.push(root.rows[0].winner_entry_id);
      }

      // éliminés par chaque finaliste, du plus tard (mieux classé) au plus tôt
      const rep: string[][] = [];
      for (let i = 0; i < 2; i++) {
        // les éliminés par le finaliste, avec le tour où ils ont perdu (un abandon sorti de la catégorie n'est pas repêché)
        const losers = await c.query<{ loser: string; round_no: number }>(
          `SELECT x.loser, max(x.round_no) AS round_no
             FROM (SELECT CASE WHEN b.winner_entry_id = b.aka_entry_id THEN b.ao_entry_id ELSE b.aka_entry_id END AS loser, s.round_no
                     FROM bouts b JOIN stages s ON s.id = b.stage_id
                    WHERE b.group_id = $1 AND b.winner_entry_id = $2 AND b.status = 'CONFIRMED' AND s.type = 'ELIMINATION') x
             JOIN entries e ON e.id = x.loser AND e.status = 'ACTIVE'
            GROUP BY x.loser
            ORDER BY round_no DESC`,
          [groups.rows[i]!.id, finalists[i]],
        );
        rep.push(losers.rows.map((r) => r.loser));
      }

      const plans = rep.map((ids) => eliminationPlan(ids, nextPow2(Math.max(ids.length, 1))));
      const repDepth = Math.max(...plans.map((p) => p.depth));
      // la médaille se joue après le dernier tour de repêchage
      await c.query(`UPDATE stages SET round_no = $2, label = 'Finale et bronze' WHERE id = $1`, [medal.id, depth + repDepth + 1]);

      const repStage = new Map<number, string>();
      const mkRepStage = async (level: number) => {
        if (!repStage.has(level)) {
          repStage.set(
            level,
            (await c.query<{ id: string }>(
              `INSERT INTO stages (category_id, type, round_no, label, panel_size) VALUES ($1, 'REPECHAGE', $2, $3, $4) RETURNING id`,
              [categoryId, depth + level, `Repêchage – tour ${level}`, koPanel],
            )).rows[0]!.id,
          );
        }
        return repStage.get(level)!;
      };

      const labels = ['Repêchage A', 'Repêchage B'];
      const groupIds: string[] = [];
      for (let p = 0; p < 2; p++) {
        const g = await c.query<{ id: string }>(`INSERT INTO groups (stage_id, label) VALUES ($1, $2) RETURNING id`, [medal.id, labels[p]]);
        groupIds.push(g.rows[0]!.id);
        for (const id of rep[p]!) await c.query('INSERT INTO group_members (group_id, entry_id) VALUES ($1, $2)', [g.rows[0]!.id, id]);
      }

      const boutOf = new Map<string, string>();
      const sideOf = new Map<string, 'AKA' | 'AO'>();
      const positions = new Map<string, number>();
      let bronzePos = 1;
      const bronze: string[] = [];
      for (let level = 1; level <= repDepth; level++) {
        for (let p = 0; p < 2; p++) {
          for (const m of plans[p]!.matches.filter((x) => x.level === level)) {
            const isRoot = plans[p]!.root?.kind === 'match' && level === plans[p]!.depth;
            const stageId = isRoot ? medal.id : await mkRepStage(level);
            const [first, second] = rng() < 0.5 ? [m.b, m.a] : [m.a, m.b];
            const entryOf = (src: PlanSource) => (src.kind === 'entry' ? src.id : null);
            const pos = isRoot ? ++bronzePos : (positions.set(stageId, (positions.get(stageId) ?? 0) + 1), positions.get(stageId)!);
            const id = (await c.query<{ id: string }>(
              `INSERT INTO bouts (stage_id, group_id, position, aka_entry_id, ao_entry_id, panel_size) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
              [stageId, groupIds[p], pos, entryOf(first), entryOf(second), isRoot ? medalPanel : koPanel],
            )).rows[0]!.id;
            boutOf.set(`${p}:${level}:${m.index}`, id);
            if (isRoot) bronze.push(id);
            if (first.kind === 'match') sideOf.set(`${p}:${first.level}:${first.index}`, 'AKA');
            if (second.kind === 'match') sideOf.set(`${p}:${second.level}:${second.index}`, 'AO');
          }
        }
      }
      for (let p = 0; p < 2; p++) {
        for (const parent of plans[p]!.matches) {
          for (const src of [parent.a, parent.b]) {
            if (src.kind !== 'match') continue;
            await c.query('UPDATE bouts SET next_bout_id = $2, next_bout_side = $3 WHERE id = $1', [
              boutOf.get(`${p}:${src.level}:${src.index}`),
              boutOf.get(`${p}:${parent.level}:${parent.index}`),
              sideOf.get(`${p}:${src.level}:${src.index}`),
            ]);
          }
        }
      }
      return {
        finalists,
        repechage: rep.map((ids, i) => ({ label: labels[i]!, entries: ids })),
        bronzeBouts: bronze.length,
        /** Médaillés de bronze sans combat (un seul éliminé dans la poule). */
        bronzeWithoutBout: rep.filter((ids) => ids.length === 1).map((ids) => ids[0]!),
      };
    });
  }

  /** Charge les groupes, leurs membres et les combats de poule. */
  private async loadPools(c: PoolClient, categoryId: string) {
    const stage = await c.query<{ id: string }>(
      `SELECT id FROM stages WHERE category_id = $1 AND type = 'ROUND_ROBIN' AND round_no = 1`,
      [categoryId],
    );
    if (!stage.rows[0]) throw conflict('NO_POOLS', "Les poules n'ont pas été tirées");
    const stageId = stage.rows[0].id;
    const groups = await c.query<{ id: string; label: string }>(`SELECT id, label FROM groups WHERE stage_id = $1 ORDER BY label`, [stageId]);
    const members = await c.query<{ group_id: string; entry_id: string; world_rank: number | null }>(
      `SELECT gm.group_id, gm.entry_id, a.world_rank
         FROM group_members gm
         JOIN groups g ON g.id = gm.group_id
         JOIN entries e ON e.id = gm.entry_id
         LEFT JOIN athletes a ON a.id = e.athlete_id
        WHERE g.stage_id = $1`,
      [stageId],
    );
    const bouts = await c.query<PoolBout>(
      `SELECT id, group_id, aka_entry_id, ao_entry_id, status::text AS status, winner_entry_id, aka_votes, ao_votes, is_extra
         FROM bouts WHERE stage_id = $1 ORDER BY position`,
      [stageId],
    );
    return { stageId, groups: groups.rows, members: members.rows, bouts: bouts.rows };
  }

  private rankPools(pools: Awaited<ReturnType<DrawService['loadPools']>>, isTeam: boolean) {
    return pools.groups.map((g) => {
      const competitors: Competitor[] = pools.members
        .filter((m) => m.group_id === g.id)
        .map((m) => ({ id: m.entry_id, worldRank: m.world_rank }));
      const records: BoutRecord[] = pools.bouts
        .filter((b) => b.group_id === g.id && b.status === 'CONFIRMED' && b.winner_entry_id)
        .map((b) => ({
          id: b.id,
          akaId: b.aka_entry_id,
          aoId: b.ao_entry_id,
          akaVotes: b.aka_votes ?? 0,
          aoVotes: b.ao_votes ?? 0,
          winnerId: b.winner_entry_id!,
          kind: b.is_extra ? 'EXTRA' : 'REGULAR',
        }));
      return { group: g, ...rankGroup(competitors, records, { isTeam }) };
    });
  }

  /** Classement de chaque groupe, avec les égalités qui demandent un kata supplémentaire. */
  async standings(categoryId: string) {
    return this.db.tx(async (c) => {
      const cat = await this.lockCategory(c, categoryId);
      const pools = await this.loadPools(c, categoryId);
      const remaining = pools.bouts.filter((b) => b.status !== 'CONFIRMED').length;
      return {
        remainingBouts: remaining,
        groups: this.rankPools(pools, cat.kind === 'TEAM').map((r) => ({
          groupId: r.group.id,
          label: r.group.label,
          ranking: r.ranking,
          unresolvedTies: remaining === 0 ? r.unresolvedTies : [],
        })),
      };
    });
  }

  /**
   * Crée le tableau à élimination à l'issue des poules : qualifiés selon 3.7.9, quarts / demi-finales / finale,
   * et combats de bronze entre les deux éliminés de chaque finaliste (3.7.6).
   */
  async generateKnockout(categoryId: string, opts: KnockoutOptions = {}) {
    const koPanel = panelSize(opts.knockoutPanelSize, 5, 'knockoutPanelSize');
    const medalPanel = panelSize(opts.medalPanelSize, 7, 'medalPanelSize');
    return this.db.tx(async (c) => {
      const cat = await this.lockCategory(c, categoryId);
      const pools = await this.loadPools(c, categoryId);
      const others = await c.query(`SELECT 1 FROM stages WHERE category_id = $1 AND type <> 'ROUND_ROBIN' LIMIT 1`, [categoryId]);
      if (others.rowCount) throw conflict('KNOCKOUT_EXISTS', 'Le tableau a déjà été généré');

      const remaining = pools.bouts.filter((b) => b.status !== 'CONFIRMED').length;
      if (remaining > 0) throw conflict('POOLS_INCOMPLETE', `${remaining} combat(s) de poule restent à jouer`, { remaining });

      const ranked = this.rankPools(pools, cat.kind === 'TEAM');
      const ties = ranked.filter((r) => r.unresolvedTies.length).map((r) => ({ group: r.group.label, entries: r.unresolvedTies }));
      if (ties.length) {
        throw conflict('TIES_UNRESOLVED', 'Égalités à départager par un combat supplémentaire (5.11)', { ties });
      }

      const total = pools.members.length;
      const rule = qualificationRule(total);
      const byGroup = ranked.map((r, i) => ({ no: i + 1, label: r.group.label, ranking: r.ranking }));

      const q = (id: string, group: number): Qualifier => ({ id, group });
      const qualifiers: Qualifier[] = [];
      for (let rank = 1; rank <= rule.topPerGroup; rank++) {
        for (const g of byGroup) qualifiers.push(q(g.ranking[rank - 1]!.id, g.no));
      }
      if (rule.bestOfRank) {
        const { rank, count } = rule.bestOfRank;
        const candidates = byGroup.filter((g) => g.ranking.length >= rank).map((g) => ({ standing: g.ranking[rank - 1]! as Standing, no: g.no }));
        const sel = selectBestAcrossGroups(candidates.map((x) => x.standing), count);
        let chosen = sel.qualified;
        if (sel.tiedAtCutoff.length) {
          const picked = opts.cutoffWinners;
          const valid = picked && picked.length === sel.slotsForTied && picked.every((id) => sel.tiedAtCutoff.includes(id));
          if (!valid) {
            throw conflict('CUTOFF_TIE', `Égalité à la limite de qualification (5.13) : ${sel.slotsForTied} place(s) pour ${sel.tiedAtCutoff.length} athlètes`, {
              tied: sel.tiedAtCutoff,
              slots: sel.slotsForTied,
            });
          }
          chosen = [...chosen, ...picked!];
        }
        const noOf = new Map(candidates.map((x) => [x.standing.id, x.no]));
        const order = new Map(candidates.map((x) => [x.standing.id, x.standing.voteDiff]));
        chosen.sort((a, b) => order.get(b)! - order.get(a)!);
        for (const id of chosen) qualifiers.push(q(id, noOf.get(id)!));
      }

      const mkStage = async (type: string, round: number, label: string, size: number) =>
        (await c.query<{ id: string }>(
          `INSERT INTO stages (category_id, type, round_no, label, panel_size) VALUES ($1, $2::stage_type, $3, $4, $5) RETURNING id`,
          [categoryId, type, round, label, size],
        )).rows[0]!.id;
      const mkBout = async (stageId: string, position: number, size: number, aka?: string, ao?: string, next?: { id: string; side: 'AKA' | 'AO' }) =>
        (await c.query<{ id: string }>(
          `INSERT INTO bouts (stage_id, position, aka_entry_id, ao_entry_id, panel_size, next_bout_id, next_bout_side)
           VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
          [stageId, position, aka ?? null, ao ?? null, size, next?.id ?? null, next?.side ?? null],
        )).rows[0]!.id;
      const link = (loserBoutId: string, bronzeId: string) =>
        c.query('UPDATE bouts SET loser_next_bout_id = $2 WHERE id = $1', [loserBoutId, bronzeId]);

      const stages: { label: string; bouts: number }[] = [];
      const pairs = knockoutPairs(qualifiers);

      if (rule.nextRound === 'FINAL') {
        // 1 groupe : finale 1er-2e, et un seul match pour le bronze (3e-4e s'il y a un 4e, sinon le 3e est médaillé)
        const medal = await mkStage('MEDAL', 2, 'Finale et bronze', medalPanel);
        const [first, second] = [pairs[0]!.aka.id, pairs[0]!.ao.id];
        await mkBout(medal, 1, medalPanel, first, second);
        const rk = byGroup[0]!.ranking;
        let bouts = 1;
        if (rk.length >= 4) {
          await mkBout(medal, 2, medalPanel, rk[2]!.id, rk[3]!.id);
          bouts = 2;
        }
        stages.push({ label: 'Finale et bronze', bouts });
      } else if (rule.nextRound === 'SEMIFINAL') {
        // 2 groupes : demi-finales croisées ; les deux perdants sont médaillés de bronze (aucun combat de bronze)
        const sf = await mkStage('ELIMINATION', 2, 'Demi-finales', koPanel);
        const medal = await mkStage('MEDAL', 3, 'Finale', medalPanel);
        const final = await mkBout(medal, 1, medalPanel);
        await mkBout(sf, 1, koPanel, pairs[0]!.aka.id, pairs[0]!.ao.id, { id: final, side: 'AKA' });
        await mkBout(sf, 2, koPanel, pairs[1]!.aka.id, pairs[1]!.ao.id, { id: final, side: 'AO' });
        stages.push({ label: 'Demi-finales', bouts: 2 }, { label: 'Finale', bouts: 1 });
      } else {
        const qf = await mkStage('ELIMINATION', 2, 'Quarts de finale', koPanel);
        const sf = await mkStage('ELIMINATION', 3, 'Demi-finales', koPanel);
        const medal = await mkStage('MEDAL', 4, 'Finale et bronze', medalPanel);
        const final = await mkBout(medal, 1, medalPanel);
        const bronze1 = await mkBout(medal, 2, medalPanel);
        const bronze2 = await mkBout(medal, 3, medalPanel);
        const sf1 = await mkBout(sf, 1, koPanel, undefined, undefined, { id: final, side: 'AKA' });
        const sf2 = await mkBout(sf, 2, koPanel, undefined, undefined, { id: final, side: 'AO' });
        await link(sf1, bronze1);
        await link(sf2, bronze2);
        // pairs[0],[1] → SF1 ; pairs[2],[3] → SF2
        const targets = [sf1, sf1, sf2, sf2];
        const sides: ('AKA' | 'AO')[] = ['AKA', 'AO', 'AKA', 'AO'];
        for (let i = 0; i < 4; i++) {
          await mkBout(qf, i + 1, koPanel, pairs[i]!.aka.id, pairs[i]!.ao.id, { id: targets[i]!, side: sides[i]! });
        }
        stages.push({ label: 'Quarts de finale', bouts: 4 }, { label: 'Demi-finales', bouts: 2 }, { label: 'Finale et bronze', bouts: 3 });
      }
      return { qualified: qualifiers.map((x) => x.id), stages };
    });
  }

  /** Vue d'ensemble : phases, groupes et combats avec les noms (écran public / table). */
  async bracket(categoryId: string) {
    assertUuid(categoryId, 'categoryId');
    const stages = await this.db.pool.query(
      `SELECT id, type::text AS type, round_no, label, panel_size FROM stages WHERE category_id = $1 ORDER BY round_no`,
      [categoryId],
    );
    if (!stages.rowCount) throw new NotFoundException({ code: 'NOT_DRAWN', message: "Aucun tirage pour cette catégorie" });
    const bouts = await this.db.pool.query(
      `SELECT b.id, b.stage_id, g.label AS group_label, b.position, b.status::text AS status, b.is_extra,
              b.aka_entry_id, b.ao_entry_id, b.aka_kata, b.ao_kata, b.aka_votes, b.ao_votes, b.winner_entry_id, b.next_bout_id,
              COALESCE(aa.last_name || ' ' || aa.first_name, ta.name) AS aka_name,
              COALESCE(oa.last_name || ' ' || oa.first_name, ot.name) AS ao_name
         FROM bouts b
         JOIN stages s ON s.id = b.stage_id
         LEFT JOIN groups g ON g.id = b.group_id
         LEFT JOIN entries ae ON ae.id = b.aka_entry_id LEFT JOIN athletes aa ON aa.id = ae.athlete_id LEFT JOIN teams ta ON ta.id = ae.team_id
         LEFT JOIN entries oe ON oe.id = b.ao_entry_id LEFT JOIN athletes oa ON oa.id = oe.athlete_id LEFT JOIN teams ot ON ot.id = oe.team_id
        WHERE s.category_id = $1
        ORDER BY s.round_no, b.position`,
      [categoryId],
    );
    return {
      stages: stages.rows.map((s) => ({
        ...s,
        bouts: bouts.rows.filter((b) => b.stage_id === s.id).map(({ stage_id: _s, ...b }) => b),
      })),
    };
  }
}
