import { describe, expect, it } from 'vitest';
import {
  computeStandings,
  rankGroup,
  selectBestAcrossGroups,
  type BoutRecord,
  type Competitor,
  type Standing,
} from './standings.js';

// b(id, aka, ao, akaVotes, aoVotes) : le vainqueur est déduit des votes
const b = (id: string, aka: string, ao: string, akaVotes: number, aoVotes: number, kind?: 'EXTRA'): BoutRecord => ({
  id,
  akaId: aka,
  aoId: ao,
  akaVotes,
  aoVotes,
  winnerId: akaVotes > aoVotes ? aka : ao,
  kind,
});

const people = (...ids: string[]): Competitor[] => ids.map((id) => ({ id }));
const order = (r: ReturnType<typeof rankGroup>) => r.ranking.map((e) => e.id);

describe('computeStandings', () => {
  it('3 points par victoire, 0 pour le perdant, votes cumulés', () => {
    const s = computeStandings(people('A', 'B'), [b('1', 'A', 'B', 4, 3)]);
    expect(s.get('A')).toMatchObject({ points: 3, wins: 1, votesFor: 4, votesAgainst: 3, voteDiff: 1 });
    expect(s.get('B')).toMatchObject({ points: 0, wins: 0, votesFor: 3, votesAgainst: 4, voteDiff: -1 });
  });

  it('refuse un combat avec un participant inconnu', () => {
    expect(() => computeStandings(people('A'), [b('1', 'A', 'Z', 4, 3)])).toThrow();
  });
});

describe('rankGroup', () => {
  it('classe par points de victoire', () => {
    const r = rankGroup(people('A', 'B', 'C'), [b('1', 'A', 'B', 5, 2), b('2', 'A', 'C', 5, 2), b('3', 'B', 'C', 4, 3)]);
    expect(order(r)).toEqual(['A', 'B', 'C']);
    expect(r.ranking.map((e) => e.rank)).toEqual([1, 2, 3]);
    expect(r.unresolvedTies).toEqual([]);
  });

  it('égalité à trois avec cycle dans un groupe de 4 : les votes départagent, le dernier reste dernier', () => {
    const bouts = [
      b('1', 'A', 'B', 4, 3), // A bat B
      b('2', 'B', 'C', 7, 0),
      b('3', 'B', 'D', 7, 0),
      b('4', 'C', 'A', 4, 3), // C bat A
      b('5', 'A', 'D', 4, 3),
      b('6', 'C', 'D', 4, 3),
    ];
    const r = rankGroup(people('A', 'B', 'C', 'D'), bouts);
    // A : B + D = 6 pts ; B : C + D = 6 pts ; C : A + D = 6 pts → trois à égalité, cycle A>B>C>A
    // les votes décident : B (3+7+7=17) > A (4+3+4=11) > C (7... voir calcul ci-dessous)
    const s = computeStandings(people('A', 'B', 'C', 'D'), bouts);
    expect(s.get('A')!.points).toBe(6);
    expect(s.get('B')!.points).toBe(6);
    expect(s.get('C')!.points).toBe(6);
    expect(order(r)[3]).toBe('D');
    expect(order(r)[0]).toBe('B'); // le plus de votes
  });

  it("égalité à deux sans cycle : le vainqueur du match direct passe devant même avec moins de votes", () => {
    const bouts = [
      b('1', 'A', 'B', 4, 3), // A bat B
      b('2', 'B', 'C', 7, 0), // B bat C
      b('3', 'B', 'D', 7, 0), // B bat D
      b('4', 'A', 'C', 4, 3), // A bat C
      b('5', 'A', 'D', 4, 3), // A bat D
      b('6', 'C', 'D', 4, 3), // C bat D
    ];
    // A : 9 pts ; B : 6 pts ; C : 3 pts ; D : 0 → pas d'égalité. On force une égalité A/B :
    const tie = [
      b('1', 'A', 'B', 4, 3), // A bat B
      b('2', 'B', 'C', 7, 0), // B bat C
      b('3', 'B', 'D', 7, 0), // B bat D
      b('4', 'C', 'A', 4, 3), // C bat A
      b('5', 'A', 'D', 4, 3), // A bat D
      b('6', 'D', 'C', 4, 3), // D bat C
    ];
    // A : B + D = 6 ; B : C + D = 6 ; C : A = 3 ; D : C = 3
    const r = rankGroup(people('A', 'B', 'C', 'D'), tie);
    expect(order(r).slice(0, 2)).toEqual(['A', 'B']); // A a battu B, malgré moins de votes
    expect(computeStandings(people('A', 'B', 'C', 'D'), tie).get('B')!.votesFor).toBeGreaterThan(
      computeStandings(people('A', 'B', 'C', 'D'), tie).get('A')!.votesFor,
    );
    expect(rankGroup(people('A', 'B', 'C', 'D'), bouts).ranking[0]!.id).toBe('A');
  });

  it("cycle à trois : la confrontation directe est ignorée, les votes départagent (critère 3)", () => {
    const bouts = [b('1', 'A', 'B', 4, 3), b('2', 'B', 'C', 5, 2), b('3', 'C', 'A', 4, 3)];
    // A : 4+3 = 7 ; B : 3+5 = 8 ; C : 2+4 = 6
    const r = rankGroup(people('A', 'B', 'C'), bouts);
    expect(order(r)).toEqual(['B', 'A', 'C']);
    expect(r.unresolvedTies).toEqual([]);
  });

  it('égalité parfaite : classement mondial (critère 4), sinon combat supplémentaire (critère 5)', () => {
    const bouts = [b('1', 'A', 'B', 4, 3), b('2', 'B', 'C', 4, 3), b('3', 'C', 'A', 4, 3)];
    const ranked: Competitor[] = [
      { id: 'A', worldRank: 3 },
      { id: 'B', worldRank: 1 },
      { id: 'C', worldRank: 2 },
    ];
    expect(order(rankGroup(ranked, bouts))).toEqual(['B', 'C', 'A']);

    const unranked = rankGroup(people('A', 'B', 'C'), bouts);
    expect(unranked.unresolvedTies).toEqual([['A', 'B', 'C']]);
    expect(unranked.ranking.every((e) => e.tied && e.rank === 1)).toBe(true);
  });

  it('équipes : le classement mondial ne s\'applique pas', () => {
    const bouts = [b('1', 'A', 'B', 4, 3), b('2', 'B', 'C', 4, 3), b('3', 'C', 'A', 4, 3)];
    const ranked: Competitor[] = [
      { id: 'A', worldRank: 3 },
      { id: 'B', worldRank: 1 },
      { id: 'C', worldRank: 2 },
    ];
    expect(rankGroup(ranked, bouts, { isTeam: true }).unresolvedTies).toEqual([['A', 'B', 'C']]);
  });

  it('les combats supplémentaires résolvent l\'égalité sans compter de points', () => {
    const bouts = [
      b('1', 'A', 'B', 4, 3),
      b('2', 'B', 'C', 4, 3),
      b('3', 'C', 'A', 4, 3),
      b('x1', 'A', 'B', 3, 4, 'EXTRA'), // B bat A
      b('x2', 'B', 'C', 4, 3, 'EXTRA'), // B bat C
      b('x3', 'A', 'C', 3, 4, 'EXTRA'), // C bat A
    ];
    const r = rankGroup(people('A', 'B', 'C'), bouts);
    expect(order(r)).toEqual(['B', 'C', 'A']);
    expect(r.unresolvedTies).toEqual([]);
    expect(r.ranking.every((e) => e.points === 3)).toBe(true);
  });
});

describe('selectBestAcrossGroups (5.13)', () => {
  const mk = (id: string, voteDiff: number): Standing => ({
    id,
    played: 3,
    wins: 1,
    points: 3,
    votesFor: 0,
    votesAgainst: 0,
    voteDiff,
    worldRank: null,
  });
  const cands = [mk('s1', 5), mk('s2', 3), mk('s3', 3), mk('s4', 1)];

  it('retient les meilleurs différences de votes', () => {
    expect(selectBestAcrossGroups(cands, 1)).toEqual({ qualified: ['s1'], tiedAtCutoff: [], slotsForTied: 0 });
    expect(selectBestAcrossGroups(cands, 3).qualified.sort()).toEqual(['s1', 's2', 's3']);
  });

  it('signale une égalité à la limite (kata supplémentaire)', () => {
    const r = selectBestAcrossGroups(cands, 2);
    expect(r.qualified).toEqual(['s1']);
    expect(r.tiedAtCutoff.sort()).toEqual(['s2', 's3']);
    expect(r.slotsForTied).toBe(1);
  });

  it('qualifie tout le monde si count ≥ nombre de candidats', () => {
    expect(selectBestAcrossGroups(cands, 5).qualified).toHaveLength(4);
  });
});
