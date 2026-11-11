/**
 * Notation d'un combat de kata (WKF Kata Competition Rules 2026.0, art. 5.4 à 5.5).
 *
 * Les notes sont des entiers en dixièmes (76 = 7,6) pour éviter les erreurs de flottants.
 * Chaque juge note les deux athlètes/équipes ; son vote va à celui qui a la meilleure note.
 * Le vainqueur est celui qui a la majorité des votes (5.4.2, 5.5.1). Pas de match nul (5.5.2).
 */

export type Side = 'AKA' | 'AO';

export const SCORE_MIN = 50; // 5,0 : note minimale pour qu'un kata soit accepté (5.4.1)
export const SCORE_MAX = 100; // 10,0 : prestation parfaite
export const DQ_SCORE = 0; // 0,0 : disqualification
export const VICTORY_POINTS = 3; // points de victoire en phase de poules (5.5.2)
export const KIKEN_VOTES = 4; // votes attribués au gagnant en cas de Kiken (5.11)

export type RuleErrorCode =
  | 'INVALID_SCORE'
  | 'EQUAL_SCORES'
  | 'INCOMPLETE_PANEL'
  | 'DUPLICATE_JUDGE'
  | 'INVALID_PANEL_SIZE'
  | 'KATA_NOT_IN_LIST'
  | 'PLAYER_COUNT_UNSUPPORTED'
  | 'NOT_ENOUGH_JUDGES'
  | 'INVALID_TRANSITION';

export class RuleError extends Error {
  readonly code: RuleErrorCode;
  constructor(code: RuleErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'RuleError';
    this.code = code;
  }
}

export interface JudgeScore {
  judgeId: string;
  /** Note donnée à l'AKA (rouge), en dixièmes. 0 = disqualifié. */
  aka: number;
  /** Note donnée à l'AO (bleu), en dixièmes. 0 = disqualifié. */
  ao: number;
}

export type BoutOutcome =
  | {
      kind: 'DECIDED';
      winner: Side;
      akaVotes: number;
      aoVotes: number;
      /** Vote de chaque juge (pour les drapeaux de l'affichage). */
      votes: Record<string, Side>;
    }
  /** Les deux côtés sont disqualifiés (3.7.10) : un kata supplémentaire est requis. */
  | { kind: 'BOTH_DISQUALIFIED' };

/** Une note est valide si elle vaut 0 (disqualification) ou si elle est entre 5,0 et 10,0 par pas de 0,1. */
export function isValidScore(tenths: number): boolean {
  return (
    Number.isInteger(tenths) &&
    (tenths === DQ_SCORE || (tenths >= SCORE_MIN && tenths <= SCORE_MAX))
  );
}

/** Convertit une saisie ("7.6", "7,6", 7.6) en dixièmes. Refuse plus d'une décimale. */
export function parseScore(input: string | number): number {
  if (typeof input === 'string' && input.trim() === '') {
    throw new RuleError('INVALID_SCORE', 'Note vide');
  }
  const n = typeof input === 'number' ? input : Number(input.trim().replace(',', '.'));
  const tenths = Math.round(n * 10);
  if (!Number.isFinite(n) || Math.abs(n * 10 - tenths) > 1e-9 || !isValidScore(tenths)) {
    throw new RuleError('INVALID_SCORE', `Note invalide : ${String(input)}`);
  }
  return tenths;
}

export function formatScore(tenths: number): string {
  return (tenths / 10).toFixed(1);
}

/** Qualificatif de l'échelle de référence (5.5.3). */
export function scoreLabel(tenths: number): string {
  if (!isValidScore(tenths)) throw new RuleError('INVALID_SCORE', `Note invalide : ${tenths}`);
  if (tenths === DQ_SCORE) return 'Disqualifié';
  if (tenths === 100) return 'Parfait';
  if (tenths >= 90) return 'Excellent';
  if (tenths >= 80) return 'Très bien';
  if (tenths >= 70) return 'Bien';
  if (tenths >= 60) return 'Acceptable';
  return 'Insuffisant';
}

/** Vote d'un juge : le côté qui a la meilleure note. Des notes égales ne sont pas prévues par le règlement. */
export function judgeVote(aka: number, ao: number): Side {
  if (!isValidScore(aka) || !isValidScore(ao)) {
    throw new RuleError('INVALID_SCORE', `Notes invalides : ${aka} / ${ao}`);
  }
  if (aka === ao) throw new RuleError('EQUAL_SCORES', `Notes égales : ${aka}`);
  return aka > ao ? 'AKA' : 'AO';
}

/**
 * Résout un combat à partir des notes de tout le panel.
 * panelSize doit être impair (7 en poules, 5 en élimination selon 4.1 ; configurable).
 */
export function resolveBout(scores: JudgeScore[], panelSize: number): BoutOutcome {
  if (!Number.isInteger(panelSize) || panelSize < 1 || panelSize % 2 === 0) {
    throw new RuleError('INVALID_PANEL_SIZE', `Taille de panel invalide : ${panelSize}`);
  }
  if (scores.length !== panelSize) {
    throw new RuleError('INCOMPLETE_PANEL', `${scores.length} notes reçues pour ${panelSize} juges`);
  }
  const ids = new Set(scores.map((s) => s.judgeId));
  if (ids.size !== scores.length) throw new RuleError('DUPLICATE_JUDGE');

  for (const s of scores) {
    if (!isValidScore(s.aka) || !isValidScore(s.ao)) {
      throw new RuleError('INVALID_SCORE', `Notes invalides pour ${s.judgeId}`);
    }
  }

  if (scores.every((s) => s.aka === DQ_SCORE && s.ao === DQ_SCORE)) {
    return { kind: 'BOTH_DISQUALIFIED' };
  }

  const votes: Record<string, Side> = {};
  let akaVotes = 0;
  let aoVotes = 0;
  for (const s of scores) {
    const v = judgeVote(s.aka, s.ao);
    votes[s.judgeId] = v;
    if (v === 'AKA') akaVotes++;
    else aoVotes++;
  }
  return { kind: 'DECIDED', winner: akaVotes > aoVotes ? 'AKA' : 'AO', akaVotes, aoVotes, votes };
}

/** Kiken (absence ou abandon) : l'adversaire gagne et reçoit 4 votes (5.11). */
export function kikenOutcome(winner: Side): { winner: Side; akaVotes: number; aoVotes: number } {
  return {
    winner,
    akaVotes: winner === 'AKA' ? KIKEN_VOTES : 0,
    aoVotes: winner === 'AO' ? KIKEN_VOTES : 0,
  };
}
