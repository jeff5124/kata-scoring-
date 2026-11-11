import { describe, expect, it } from 'vitest';
import {
  RuleError,
  formatScore,
  isValidScore,
  judgeVote,
  kikenOutcome,
  parseScore,
  resolveBout,
  scoreLabel,
  type JudgeScore,
} from './scoring.js';

const panel = (aka: number[], ao: number[]): JudgeScore[] =>
  aka.map((a, i) => ({ judgeId: `J${i + 1}`, aka: a, ao: ao[i]! }));

const codeOf = (fn: () => unknown): string | undefined => {
  try {
    fn();
  } catch (e) {
    return e instanceof RuleError ? e.code : 'OTHER';
  }
  return undefined;
};

describe('resolveBout', () => {
  it("reproduit l'exemple du règlement (art. 5.4) : AO gagne 4-3", () => {
    const scores = panel([76, 75, 76, 71, 71, 77, 72], [80, 73, 74, 73, 74, 73, 75]);
    const r = resolveBout(scores, 7);
    expect(r).toMatchObject({ kind: 'DECIDED', winner: 'AO', akaVotes: 3, aoVotes: 4 });
    if (r.kind === 'DECIDED') {
      // drapeaux de l'écran : bleu, rouge, rouge, bleu, bleu, rouge, bleu
      expect(Object.values(r.votes)).toEqual(['AO', 'AKA', 'AKA', 'AO', 'AO', 'AKA', 'AO']);
    }
  });

  it('gère un panel de 5 juges (élimination)', () => {
    const r = resolveBout(panel([80, 80, 80, 70, 70], [70, 70, 70, 80, 80]), 5);
    expect(r).toMatchObject({ winner: 'AKA', akaVotes: 3, aoVotes: 2 });
  });

  it('une disqualification (note 0) donne tous les votes à l\'adversaire', () => {
    const r = resolveBout(panel([0, 0, 0, 0, 0, 0, 0], [60, 65, 70, 55, 50, 90, 100]), 7);
    expect(r).toMatchObject({ winner: 'AO', akaVotes: 0, aoVotes: 7 });
  });

  it('double disqualification : kata supplémentaire (3.7.10)', () => {
    const r = resolveBout(panel(Array(7).fill(0), Array(7).fill(0)), 7);
    expect(r).toEqual({ kind: 'BOTH_DISQUALIFIED' });
  });

  it('refuse des notes égales pour un juge', () => {
    const scores = panel([70, 70, 70, 70, 70, 70, 70], [70, 60, 60, 60, 60, 60, 60]);
    expect(codeOf(() => resolveBout(scores, 7))).toBe('EQUAL_SCORES');
  });

  it('refuse un panel incomplet, pair, ou avec un juge en double', () => {
    expect(codeOf(() => resolveBout(panel([70, 70], [60, 60]), 7))).toBe('INCOMPLETE_PANEL');
    expect(codeOf(() => resolveBout(panel([70, 70], [60, 60]), 2))).toBe('INVALID_PANEL_SIZE');
    const dup: JudgeScore[] = [
      { judgeId: 'J1', aka: 70, ao: 60 },
      { judgeId: 'J1', aka: 70, ao: 60 },
      { judgeId: 'J3', aka: 70, ao: 60 },
    ];
    expect(codeOf(() => resolveBout(dup, 3))).toBe('DUPLICATE_JUDGE');
  });

  it('refuse une note hors échelle', () => {
    expect(codeOf(() => resolveBout(panel([49, 70, 70], [60, 60, 60]), 3))).toBe('INVALID_SCORE');
    expect(codeOf(() => resolveBout(panel([101, 70, 70], [60, 60, 60]), 3))).toBe('INVALID_SCORE');
  });
});

describe('notes', () => {
  it('valide 0 et 5,0 à 10,0 par pas de 0,1', () => {
    expect(isValidScore(0)).toBe(true);
    expect(isValidScore(50)).toBe(true);
    expect(isValidScore(100)).toBe(true);
    expect(isValidScore(49)).toBe(false);
    expect(isValidScore(1)).toBe(false);
    expect(isValidScore(101)).toBe(false);
    expect(isValidScore(75.5)).toBe(false);
  });

  it('parseScore accepte point ou virgule, une seule décimale', () => {
    expect(parseScore('7.6')).toBe(76);
    expect(parseScore('7,6')).toBe(76);
    expect(parseScore(8)).toBe(80);
    expect(parseScore('10')).toBe(100);
    expect(parseScore('0')).toBe(0);
    for (const bad of ['7.65', '4.9', '10.1', '', 'abc']) {
      expect(codeOf(() => parseScore(bad))).toBe('INVALID_SCORE');
    }
  });

  it('formatScore', () => {
    expect(formatScore(76)).toBe('7.6');
    expect(formatScore(100)).toBe('10.0');
  });

  it("scoreLabel suit l'échelle 5.5.3", () => {
    expect(scoreLabel(100)).toBe('Parfait');
    expect(scoreLabel(99)).toBe('Excellent');
    expect(scoreLabel(90)).toBe('Excellent');
    expect(scoreLabel(89)).toBe('Très bien');
    expect(scoreLabel(80)).toBe('Très bien');
    expect(scoreLabel(79)).toBe('Bien');
    expect(scoreLabel(70)).toBe('Bien');
    expect(scoreLabel(69)).toBe('Acceptable');
    expect(scoreLabel(60)).toBe('Acceptable');
    expect(scoreLabel(59)).toBe('Insuffisant');
    expect(scoreLabel(50)).toBe('Insuffisant');
    expect(scoreLabel(0)).toBe('Disqualifié');
  });

  it('judgeVote', () => {
    expect(judgeVote(76, 80)).toBe('AO');
    expect(judgeVote(80, 76)).toBe('AKA');
  });
});

describe('kikenOutcome', () => {
  it('attribue 4 votes au gagnant (5.11)', () => {
    expect(kikenOutcome('AKA')).toEqual({ winner: 'AKA', akaVotes: 4, aoVotes: 0 });
    expect(kikenOutcome('AO')).toEqual({ winner: 'AO', akaVotes: 0, aoVotes: 4 });
  });
});
