/**
 * Répartition en poules (round-robin) et règles de qualification (WKF 2026.0, tableau 3.7.9).
 * Valable pour 3 à 32 athlètes.
 */
import { RuleError } from './scoring.js';

export type NextRound = 'QUARTERFINAL' | 'SEMIFINAL' | 'FINAL';

export interface QualificationRule {
  groups: number;
  /** Nombre de premiers de chaque groupe qui se qualifient directement. */
  topPerGroup: number;
  /** Meilleurs classés d'un rang donné, comparés entre groupes (5.13), s'il y en a. */
  bestOfRank: { rank: number; count: number } | null;
  /** Nombre total de qualifiés. */
  total: number;
  nextRound: NextRound;
}

export const MIN_PLAYERS = 3;
export const MAX_PLAYERS = 32;

function assertSupported(n: number): void {
  if (!Number.isInteger(n) || n < MIN_PLAYERS || n > MAX_PLAYERS) {
    throw new RuleError('PLAYER_COUNT_UNSUPPORTED', `Nombre d'athlètes non supporté : ${n}`);
  }
}

/** Nombre de groupes selon le nombre d'athlètes. */
export function groupCount(n: number): number {
  assertSupported(n);
  if (n >= 24) return 8;
  if (n >= 18) return 6;
  if (n === 17) return 5;
  if (n >= 12) return 4;
  if (n >= 9) return 3;
  if (n >= 6) return 2;
  return 1;
}

/** Taille de chaque groupe, du plus grand au plus petit (ex. 23 → 4,4,4,4,4,3 ; 17 → 4,4,3,3,3). */
export function groupSizes(n: number): number[] {
  const g = groupCount(n);
  const base = Math.floor(n / g);
  const remainder = n % g;
  return Array.from({ length: g }, (_, i) => base + (i < remainder ? 1 : 0));
}

/** Règle de qualification à l'issue des poules. */
export function qualificationRule(n: number): QualificationRule {
  const groups = groupCount(n);
  switch (groups) {
    case 8:
      return { groups, topPerGroup: 1, bestOfRank: null, total: 8, nextRound: 'QUARTERFINAL' };
    case 6:
      return { groups, topPerGroup: 1, bestOfRank: { rank: 2, count: 2 }, total: 8, nextRound: 'QUARTERFINAL' };
    case 5:
      return { groups, topPerGroup: 1, bestOfRank: { rank: 2, count: 3 }, total: 8, nextRound: 'QUARTERFINAL' };
    case 4:
      return { groups, topPerGroup: 2, bestOfRank: null, total: 8, nextRound: 'QUARTERFINAL' };
    case 3:
      return { groups, topPerGroup: 2, bestOfRank: { rank: 3, count: 2 }, total: 8, nextRound: 'QUARTERFINAL' };
    case 2:
      return { groups, topPerGroup: 2, bestOfRank: null, total: 4, nextRound: 'SEMIFINAL' };
    default:
      // 1 groupe (3 à 5 athlètes) : finale entre le 1er et le 2e.
      return { groups, topPerGroup: 2, bestOfRank: null, total: 2, nextRound: 'FINAL' };
  }
}
