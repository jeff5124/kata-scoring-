import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { PoolClient } from 'pg';
import { Database, type Queryable } from '../database.js';
import {
  KATA_DECLARATION_OPEN,
  KIKEN_ALLOWED,
  RuleError,
  checkKata,
  drawPanel,
  isValidScore,
  kikenOutcome,
  nextStatus,
  resolveBout,
  type BoutStatus,
  type JudgeScore,
  type PanelCandidate,
  type Participant,
  type Side,
} from '../../rules/index.js';
import { BoutEvents, type ResultView } from './bout-events.js';
import { assertUuid, oppositeSide } from './parse.js';

interface BoutRow {
  id: string;
  stage_id: string;
  group_id: string | null;
  tatami_id: string | null;
  position: number;
  aka_entry_id: string | null;
  ao_entry_id: string | null;
  aka_kata: number | null;
  ao_kata: number | null;
  status: BoutStatus;
  panel_size: number;
  aka_votes: number | null;
  ao_votes: number | null;
  winner_entry_id: string | null;
  result_type: string | null;
  is_extra: boolean;
  next_bout_id: string | null;
  next_bout_side: Side | null;
  loser_next_bout_id: string | null;
  stage_type: string;
  round_no: number;
  stage_label: string;
  category_name: string;
  category_id: string;
  is_u14: boolean;
  competition_id: string;
  consecutive_rule: boolean;
}

export interface Competitor {
  entryId: string | null;
  kata: number | null;
  kataName: string | null;
  name: string | null;
  country: string | null;
  federation: string | null;
}

export interface BoutDetail {
  id: string;
  status: BoutStatus;
  isExtra: boolean;
  stage: { type: string; roundNo: number; label: string };
  category: string;
  group: string | null;
  position: number;
  aka: Competitor;
  ao: Competitor;
  panelSize: number;
  panel: { position: number; officialId: string; isChief: boolean; name: string }[];
  progress: { submitted: number; total: number };
  result: ResultView | null;
}

export interface SubmitResult {
  revealed: boolean;
  submitted: number;
  total: number;
  result?: ResultView;
}

const conflict = (code: string, message: string) => new ConflictException({ code, message });

@Injectable()
export class BoutsService {
  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(BoutEvents) private readonly events: BoutEvents,
  ) {}

  // ───────────── Lecture ─────────────

  async getBout(boutId: string): Promise<BoutDetail> {
    assertUuid(boutId, 'boutId');
    const c = this.db.pool;
    const b = await this.loadBout(c, boutId);
    const panel = await c.query<{ position: number; official_id: string; is_chief: boolean; name: string }>(
      `SELECT p.position, p.official_id, p.is_chief, o.full_name AS name
         FROM bout_panel p JOIN officials o ON o.id = p.official_id WHERE p.bout_id = $1 ORDER BY p.position`,
      [boutId],
    );
    const submitted = await this.submittedCount(c, boutId);
    const revealed = b.status === 'REVEALED' || b.status === 'CONFIRMED';
    const entryIds = [b.aka_entry_id, b.ao_entry_id].filter((x): x is string => !!x);
    const people = await c.query<{ id: string; name: string; country: string | null; federation: string | null }>(
      `SELECT e.id, COALESCE(a.last_name || ' ' || a.first_name, t.name) AS name, f.country::text AS country, f.name AS federation
         FROM entries e
         LEFT JOIN athletes a ON a.id = e.athlete_id
         LEFT JOIN teams t ON t.id = e.team_id
         LEFT JOIN federations f ON f.id = COALESCE(a.federation_id, t.federation_id)
        WHERE e.id = ANY($1::uuid[])`,
      [entryIds],
    );
    const kataNumbers = [b.aka_kata, b.ao_kata].filter((x): x is number => x !== null);
    const katas = await c.query<{ number: number; name: string }>('SELECT number, name FROM katas WHERE number = ANY($1::int[])', [kataNumbers]);
    const group = b.group_id ? await c.query<{ label: string }>('SELECT label FROM groups WHERE id = $1', [b.group_id]) : { rows: [] as { label: string }[] };
    return {
      id: b.id,
      status: b.status,
      isExtra: b.is_extra,
      stage: { type: b.stage_type, roundNo: b.round_no, label: b.stage_label },
      category: b.category_name,
      group: group.rows[0]?.label ?? null,
      position: b.position,
      aka: this.competitor(b.aka_entry_id, b.aka_kata, people, katas),
      ao: this.competitor(b.ao_entry_id, b.ao_kata, people, katas),
      panelSize: b.panel_size,
      panel: panel.rows.map((r) => ({ position: r.position, officialId: r.official_id, isChief: r.is_chief, name: r.name })),
      progress: { submitted, total: b.panel_size },
      result: revealed ? await this.loadResult(c, b) : null,
    };
  }

  private competitor(
    entryId: string | null,
    kata: number | null,
    people: { rows: { id: string; name: string; country: string | null; federation: string | null }[] },
    katas: { rows: { number: number; name: string }[] },
  ): Competitor {
    const p = entryId ? people.rows.find((r) => r.id === entryId) : undefined;
    return {
      entryId,
      kata,
      kataName: kata === null ? null : (katas.rows.find((k) => k.number === kata)?.name ?? null),
      name: p?.name ?? null,
      country: p?.country ?? null,
      federation: p?.federation ?? null,
    };
  }

  /** Combats en cours (de l'appel à la confirmation) : pour l'écran d'affichage. */
  async activeBouts(tatamiId?: string): Promise<BoutDetail[]> {
    if (tatamiId) assertUuid(tatamiId, 'tatami');
    const ids = await this.db.pool.query<{ id: string }>(
      `SELECT id FROM bouts WHERE status IN ('CALLED', 'AKA_PERFORMING', 'AO_PERFORMING', 'SCORING', 'REVEALED')
          AND ($1::uuid IS NULL OR tatami_id = $1)
        ORDER BY called_at NULLS LAST, id LIMIT 20`,
      [tatamiId ?? null],
    );
    return Promise.all(ids.rows.map((r) => this.getBout(r.id)));
  }

  /** Combats en cours dont ce juge est membre du panel, avec l'état de sa propre saisie. */
  async boutsForJudge(officialId: string): Promise<(BoutDetail & { mine: { submitted: boolean } })[]> {
    assertUuid(officialId, 'officialId');
    const ids = await this.db.pool.query<{ id: string; done: boolean }>(
      `SELECT b.id,
              (SELECT count(*) FROM scores sc WHERE sc.bout_id = b.id AND sc.official_id = $1) = 2 AS done
         FROM bouts b JOIN bout_panel p ON p.bout_id = b.id AND p.official_id = $1
        WHERE b.status IN ('CALLED', 'AKA_PERFORMING', 'AO_PERFORMING', 'SCORING', 'REVEALED')
        ORDER BY b.called_at NULLS LAST, b.id`,
      [officialId],
    );
    return Promise.all(ids.rows.map(async (r) => ({ ...(await this.getBout(r.id)), mine: { submitted: r.done } })));
  }

  // ───────────── Préparation ─────────────

  /** Tire au sort le panel de juges (4.3), sans conflit de fédération ni de pays (4.8). */
  async drawPanel(boutId: string): Promise<Omit<BoutDetail['panel'][number], 'name'>[]> {
    assertUuid(boutId, 'boutId');
    const seats = await this.db.tx(async (c) => {
      const b = await this.loadBout(c, boutId, true);
      if (!KATA_DECLARATION_OPEN.includes(b.status)) {
        throw conflict('PANEL_LOCKED', `Le panel ne peut plus changer (statut ${b.status})`);
      }
      const entryIds = [b.aka_entry_id, b.ao_entry_id].filter((x): x is string => !!x);
      const parts = await c.query<{ federation_id: string; country: string }>(
        `SELECT f.id AS federation_id, f.country::text AS country
           FROM entries e
           LEFT JOIN athletes a ON a.id = e.athlete_id
           LEFT JOIN teams t ON t.id = e.team_id
           JOIN federations f ON f.id = COALESCE(a.federation_id, t.federation_id)
          WHERE e.id = ANY($1::uuid[])`,
        [entryIds],
      );
      const participants: Participant[] = parts.rows.map((r) => ({ federationId: r.federation_id, country: r.country }));

      const cands = await c.query<{ id: string; federation_id: string | null; country: string | null }>(
        `SELECT o.id, o.federation_id, f.country::text AS country
           FROM officials o LEFT JOIN federations f ON f.id = o.federation_id
          WHERE o.competition_id = $1 AND o.role = 'JUDGE' AND o.is_available`,
        [b.competition_id],
      );
      const candidates: PanelCandidate[] = cands.rows.map((r) => ({
        id: r.id,
        federationId: r.federation_id,
        country: r.country,
      }));

      const drawn = drawPanel(candidates, participants, b.panel_size);
      await c.query('DELETE FROM bout_panel WHERE bout_id = $1', [boutId]);
      await c.query(
        `INSERT INTO bout_panel (bout_id, official_id, position, is_chief)
         SELECT $1, * FROM unnest($2::uuid[], $3::int[], $4::bool[])`,
        [boutId, drawn.map((s) => s.officialId), drawn.map((s) => s.position), drawn.map((s) => s.isChief)],
      );
      return drawn;
    });
    return seats.map((s) => ({ position: s.position, officialId: s.officialId, isChief: s.isChief }));
  }

  /** Enregistre le kata annoncé par un côté, après contrôle des règles de répétition (5.2). */
  async declareKata(boutId: string, side: Side, kata: number): Promise<void> {
    assertUuid(boutId, 'boutId');
    await this.db.tx(async (c) => {
      const b = await this.loadBout(c, boutId, true);
      if (!KATA_DECLARATION_OPEN.includes(b.status)) {
        throw conflict('DECLARATION_CLOSED', `Les katas ne peuvent plus être modifiés (statut ${b.status})`);
      }
      const entryId = side === 'AKA' ? b.aka_entry_id : b.ao_entry_id;
      if (!entryId) throw conflict('ENTRY_MISSING', `Aucun participant côté ${side}`);

      const hist = await c.query<{ kata: number | null }>(
        `SELECT CASE WHEN b.aka_entry_id = $1 THEN b.aka_kata ELSE b.ao_kata END AS kata
           FROM bouts b JOIN stages s ON s.id = b.stage_id
          WHERE s.category_id = $3
            AND (b.aka_entry_id = $1 OR b.ao_entry_id = $1)
            AND b.status IN ('REVEALED', 'CONFIRMED')
            AND b.id <> $2
          ORDER BY s.round_no, b.position, b.revealed_at`,
        [entryId, boutId, b.category_id],
      );
      const history = hist.rows.map((r) => r.kata).filter((k): k is number => k !== null);

      const verdict = checkKata({
        history,
        kata,
        isMedalRound: b.stage_type === 'MEDAL',
        isU14: b.is_u14,
        consecutiveRuleInMedalRound: b.consecutive_rule,
      });
      if (verdict !== 'OK') {
        throw conflict(verdict, `Kata ${kata} refusé : ${verdict}`);
      }

      await c.query(
        `INSERT INTO kata_declarations (bout_id, side, kata_number, validated)
         VALUES ($1, $2, $3, false)
         ON CONFLICT (bout_id, side) DO UPDATE SET kata_number = EXCLUDED.kata_number, validated = false`,
        [boutId, side, kata],
      );
      const column = side === 'AKA' ? 'aka_kata' : 'ao_kata';
      await c.query(`UPDATE bouts SET ${column} = $2 WHERE id = $1`, [boutId, kata]);
    });
  }

  // ───────────── Déroulement ─────────────

  /** Fait avancer le combat : appelé → AKA passe → AO passe → notation. */
  async advance(boutId: string): Promise<BoutStatus> {
    assertUuid(boutId, 'boutId');
    const status = await this.db.tx(async (c) => {
      const b = await this.loadBout(c, boutId, true);
      if (b.status === 'REVEALED') throw conflict('USE_CONFIRM', 'Utiliser la confirmation du résultat');
      const next = nextStatus(b.status);

      if (next === 'CALLED' && (!b.aka_entry_id || !b.ao_entry_id)) {
        throw conflict('ENTRIES_MISSING', 'Les deux participants doivent être connus');
      }
      // Tout est prêt avant que l'AKA ne commence : katas annoncés (6.1) et panel tiré au sort (4.3).
      if (next === 'AKA_PERFORMING') {
        if (b.aka_kata === null) throw conflict('AKA_KATA_MISSING', "Le kata de l'AKA n'est pas déclaré");
        if (b.ao_kata === null) throw conflict('AO_KATA_MISSING', "Le kata de l'AO n'est pas déclaré");
        await this.assertPanelComplete(c, b);
      }
      if (next === 'SCORING') await this.assertPanelComplete(c, b);
      await c.query(
        `UPDATE bouts SET status = $2::bout_status,
                called_at = CASE WHEN $3::boolean THEN now() ELSE called_at END
          WHERE id = $1`,
        [boutId, next, next === 'CALLED'],
      );
      return next;
    });
    this.events.emit({ type: 'state', boutId, status });
    return status;
  }

  /**
   * Enregistre les notes d'un juge (modifiables tant que le combat n'est pas révélé).
   * Quand tous les juges ont noté, le résultat est calculé et révélé (5.4, 5.5).
   */
  async submitScore(boutId: string, officialId: string, aka: number, ao: number): Promise<SubmitResult> {
    assertUuid(boutId, 'boutId');
    assertUuid(officialId, 'officialId');
    if (!isValidScore(aka) || !isValidScore(ao)) {
      throw new RuleError('INVALID_SCORE', `Notes invalides : ${aka} / ${ao}`);
    }
    if (aka === ao) throw new RuleError('EQUAL_SCORES', 'Un juge ne peut pas donner la même note aux deux côtés');

    const out = await this.db.tx(async (c): Promise<SubmitResult> => {
      const b = await this.loadBout(c, boutId, true);
      if (b.status !== 'SCORING') throw conflict('NOT_SCORING', `La notation est fermée (statut ${b.status})`);

      const seat = await c.query('SELECT 1 FROM bout_panel WHERE bout_id = $1 AND official_id = $2', [boutId, officialId]);
      if (!seat.rowCount) throw new ForbiddenException({ code: 'NOT_IN_PANEL', message: "Ce juge n'est pas dans le panel" });

      await c.query(
        `INSERT INTO scores (bout_id, official_id, side, value_tenths)
         VALUES ($1, $2, 'AKA', $3::smallint), ($1, $2, 'AO', $4::smallint)
         ON CONFLICT (bout_id, official_id, side)
         DO UPDATE SET value_tenths = EXCLUDED.value_tenths, submitted_at = now()`,
        [boutId, officialId, aka, ao],
      );

      const submitted = await this.submittedCount(c, boutId);
      if (submitted < b.panel_size) return { revealed: false, submitted, total: b.panel_size };

      const result = await this.finalize(c, b);
      return { revealed: true, submitted, total: b.panel_size, result };
    });

    this.events.emit({ type: 'progress', boutId, submitted: out.submitted, total: out.total });
    if (out.revealed && out.result) {
      this.events.emit({ type: 'state', boutId, status: 'REVEALED' });
      this.events.emit({ type: 'revealed', boutId, result: out.result });
    }
    return out;
  }

  /** Le résultat est validé par la table : le vainqueur avance dans le tableau. */
  async confirm(boutId: string): Promise<void> {
    assertUuid(boutId, 'boutId');
    const winnerEntryId = await this.db.tx(async (c) => {
      const b = await this.loadBout(c, boutId, true);
      if (b.status !== 'REVEALED') throw conflict('NOT_REVEALED', `Rien à confirmer (statut ${b.status})`);
      await c.query(`UPDATE bouts SET status = 'CONFIRMED' WHERE id = $1`, [boutId]);
      await this.advanceWinner(c, b, b.winner_entry_id);
      return b.winner_entry_id;
    });
    this.events.emit({ type: 'state', boutId, status: 'CONFIRMED' });
    this.events.emit({ type: 'confirmed', boutId, winnerEntryId });
  }

  // ───────────── Cas particuliers ─────────────

  /** Absence ou abandon (KIKEN) : l'adversaire gagne avec 4 votes, le côté absent est sorti de la catégorie (6.4). */
  async kiken(boutId: string, absentSide: Side): Promise<void> {
    assertUuid(boutId, 'boutId');
    const winnerEntryId = await this.db.tx(async (c) => {
      const b = await this.loadBout(c, boutId, true);
      if (!KIKEN_ALLOWED.includes(b.status)) throw conflict('KIKEN_NOT_ALLOWED', `Statut ${b.status}`);

      const winnerSide = oppositeSide(absentSide);
      const absentEntry = absentSide === 'AKA' ? b.aka_entry_id : b.ao_entry_id;
      const winnerEntry = winnerSide === 'AKA' ? b.aka_entry_id : b.ao_entry_id;
      if (!absentEntry || !winnerEntry) throw conflict('ENTRIES_MISSING', 'Les deux participants doivent être connus');

      const out = kikenOutcome(winnerSide);
      await c.query(
        `UPDATE bouts SET status = 'CONFIRMED', result_type = 'KIKEN', winner_entry_id = $2,
                aka_votes = $3, ao_votes = $4, revealed_at = now()
          WHERE id = $1`,
        [boutId, winnerEntry, out.akaVotes, out.aoVotes],
      );
      await c.query(`UPDATE entries SET status = 'KIKEN' WHERE id = $1`, [absentEntry]);
      await c.query(`INSERT INTO incidents (bout_id, entry_id, type, details) VALUES ($1, $2, 'KIKEN', $3)`, [
        boutId,
        absentEntry,
        `Côté ${absentSide} absent ou abandon`,
      ]);
      await this.advanceWinner(c, b, winnerEntry);
      return winnerEntry;
    });
    this.events.emit({ type: 'state', boutId, status: 'CONFIRMED' });
    this.events.emit({ type: 'confirmed', boutId, winnerEntryId });
  }

  /**
   * Les deux côtés sont disqualifiés pour faute technique (3.7.10) :
   * le combat est clos sans vainqueur et un combat supplémentaire (nouveau kata, sans Bunkai) est créé.
   */
  async declareDoubleDisqualification(boutId: string): Promise<{ extraBoutId: string }> {
    assertUuid(boutId, 'boutId');
    const extraBoutId = await this.db.tx(async (c) => {
      const b = await this.loadBout(c, boutId, true);
      if (b.status !== 'SCORING') throw conflict('NOT_SCORING', `Statut ${b.status}`);
      await c.query(
        `UPDATE bouts SET status = 'CONFIRMED', result_type = 'DISQUALIFICATION', winner_entry_id = NULL, revealed_at = now()
          WHERE id = $1`,
        [boutId],
      );
      const extra = await c.query<{ id: string }>(
        `INSERT INTO bouts (stage_id, group_id, tatami_id, position, aka_entry_id, ao_entry_id,
                            panel_size, is_extra, next_bout_id, next_bout_side, loser_next_bout_id)
         SELECT stage_id, group_id, tatami_id,
                (SELECT COALESCE(max(position), 0) + 1 FROM bouts WHERE stage_id = $2),
                aka_entry_id, ao_entry_id, panel_size, true, next_bout_id, next_bout_side, loser_next_bout_id
           FROM bouts WHERE id = $1
         RETURNING id`,
        [boutId, b.stage_id],
      );
      return extra.rows[0]!.id;
    });
    this.events.emit({ type: 'state', boutId, status: 'CONFIRMED' });
    return { extraBoutId };
  }

  // ───────────── Interne ─────────────

  private async loadBout(c: Queryable, boutId: string, lock = false): Promise<BoutRow> {
    const { rows } = await c.query<BoutRow>(
      `SELECT b.*, s.type::text AS stage_type, s.round_no, s.label AS stage_label, cat.name AS category_name, s.category_id, cat.is_u14, cat.competition_id,
              COALESCE((comp.settings->>'consecutiveRuleInMedalRound')::boolean, false) AS consecutive_rule
         FROM bouts b
         JOIN stages s ON s.id = b.stage_id
         JOIN categories cat ON cat.id = s.category_id
         JOIN competitions comp ON comp.id = cat.competition_id
        WHERE b.id = $1 ${lock ? 'FOR UPDATE OF b' : ''}`,
      [boutId],
    );
    const row = rows[0];
    if (!row) throw new NotFoundException({ code: 'BOUT_NOT_FOUND', message: `Combat introuvable : ${boutId}` });
    return row;
  }

  private async assertPanelComplete(c: Queryable, b: BoutRow): Promise<void> {
    const n = await c.query<{ n: string }>('SELECT count(*) AS n FROM bout_panel WHERE bout_id = $1', [b.id]);
    if (Number(n.rows[0]?.n) !== b.panel_size) {
      throw conflict('PANEL_INCOMPLETE', `Le panel doit compter ${b.panel_size} juges`);
    }
  }

  /** Nombre de juges ayant noté les deux côtés. */
  private async submittedCount(c: Queryable, boutId: string): Promise<number> {
    const { rows } = await c.query<{ n: string }>(
      `SELECT count(*) AS n FROM (
         SELECT official_id FROM scores WHERE bout_id = $1 GROUP BY official_id HAVING count(*) = 2
       ) x`,
      [boutId],
    );
    return Number(rows[0]?.n ?? 0);
  }

  private async loadJudgeScores(c: Queryable, boutId: string) {
    const { rows } = await c.query<{ position: number; official_id: string; side: Side; value_tenths: number }>(
      `SELECT p.position, s.official_id, s.side, s.value_tenths
         FROM scores s JOIN bout_panel p ON p.bout_id = s.bout_id AND p.official_id = s.official_id
        WHERE s.bout_id = $1 ORDER BY p.position`,
      [boutId],
    );
    const byJudge = new Map<string, { position: number; officialId: string; aka: number; ao: number }>();
    for (const r of rows) {
      const j = byJudge.get(r.official_id) ?? { position: r.position, officialId: r.official_id, aka: 0, ao: 0 };
      if (r.side === 'AKA') j.aka = r.value_tenths;
      else j.ao = r.value_tenths;
      byJudge.set(r.official_id, j);
    }
    return [...byJudge.values()].sort((a, b) => a.position - b.position);
  }

  private async loadResult(c: Queryable, b: BoutRow): Promise<ResultView> {
    const judges = (await this.loadJudgeScores(c, b.id)).map((j) => ({
      ...j,
      vote: (j.aka > j.ao ? 'AKA' : 'AO') as Side,
    }));
    const winner: Side | null = !b.winner_entry_id ? null : b.winner_entry_id === b.aka_entry_id ? 'AKA' : 'AO';
    return {
      resultType: b.result_type,
      winnerEntryId: b.winner_entry_id,
      winner,
      akaVotes: b.aka_votes,
      aoVotes: b.ao_votes,
      judges,
    };
  }

  /** Calcule le résultat à partir des notes de tout le panel et passe le combat en REVEALED. */
  private async finalize(c: PoolClient, b: BoutRow): Promise<ResultView> {
    const judges = await this.loadJudgeScores(c, b.id);
    const scores: JudgeScore[] = judges.map((j) => ({ judgeId: j.officialId, aka: j.aka, ao: j.ao }));
    const outcome = resolveBout(scores, b.panel_size);
    if (outcome.kind !== 'DECIDED') throw conflict('BOTH_DISQUALIFIED', 'Double disqualification : utiliser la déclaration dédiée');

    const winnerEntry = outcome.winner === 'AKA' ? b.aka_entry_id : b.ao_entry_id;
    const loserAllZero = scores.every((s) => (outcome.winner === 'AKA' ? s.ao : s.aka) === 0);
    const resultType = loserAllZero ? 'DISQUALIFICATION' : 'NORMAL';

    await c.query(
      `UPDATE bouts SET status = 'REVEALED', aka_votes = $2, ao_votes = $3, winner_entry_id = $4,
              result_type = $5::bout_result_type, revealed_at = now()
        WHERE id = $1`,
      [b.id, outcome.akaVotes, outcome.aoVotes, winnerEntry, resultType],
    );
    return {
      resultType,
      winnerEntryId: winnerEntry,
      winner: outcome.winner,
      akaVotes: outcome.akaVotes,
      aoVotes: outcome.aoVotes,
      judges: judges.map((j) => ({ ...j, vote: outcome.votes[j.officialId]! })),
    };
  }

  /**
   * Place le vainqueur dans le combat suivant du tableau. Pour une demi-finale reliée à un combat de bronze (3.7.6),
   * le perdant et l'athlète qu'a battu le vainqueur au tour précédent s'y retrouvent : les deux éliminés par le même finaliste.
   */
  private async advanceWinner(c: Queryable, b: BoutRow, winnerEntryId: string | null): Promise<void> {
    if (!winnerEntryId) return;
    if (b.next_bout_id && b.next_bout_side) {
      const column = b.next_bout_side === 'AKA' ? 'aka_entry_id' : 'ao_entry_id';
      await c.query(`UPDATE bouts SET ${column} = $2 WHERE id = $1`, [b.next_bout_id, winnerEntryId]);
    }
    if (b.loser_next_bout_id) {
      const loser = winnerEntryId === b.aka_entry_id ? b.ao_entry_id : b.aka_entry_id;
      if (loser) await c.query(`UPDATE bouts SET ao_entry_id = $2 WHERE id = $1`, [b.loser_next_bout_id, loser]);
      // l'adversaire du vainqueur au tour précédent (le combat « jumeau » d'un éventuel combat supplémentaire inclus)
      const victim = await c.query<{ loser: string | null }>(
        `SELECT CASE WHEN f.winner_entry_id = f.aka_entry_id THEN f.ao_entry_id ELSE f.aka_entry_id END AS loser
           FROM bouts f
          WHERE f.next_bout_id IN (SELECT id FROM bouts
                                    WHERE stage_id = $1 AND next_bout_id IS NOT DISTINCT FROM $2
                                      AND loser_next_bout_id = $3)
            AND f.winner_entry_id = $4 AND f.status = 'CONFIRMED'
          LIMIT 1`,
        [b.stage_id, b.next_bout_id, b.loser_next_bout_id, winnerEntryId],
      );
      const v = victim.rows[0]?.loser;
      if (v) await c.query(`UPDATE bouts SET aka_entry_id = $2 WHERE id = $1`, [b.loser_next_bout_id, v]);
    }
  }
}
