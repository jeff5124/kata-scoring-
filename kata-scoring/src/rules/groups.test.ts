import { describe, expect, it } from 'vitest';
import { groupCount, groupSizes, qualificationRule } from './groups.js';

describe('groupSizes (tableau 3.7.9)', () => {
  const table: Record<number, number[]> = {
    32: [4, 4, 4, 4, 4, 4, 4, 4],
    31: [4, 4, 4, 4, 4, 4, 4, 3],
    24: [3, 3, 3, 3, 3, 3, 3, 3],
    23: [4, 4, 4, 4, 4, 3],
    22: [4, 4, 4, 4, 3, 3],
    18: [3, 3, 3, 3, 3, 3],
    17: [4, 4, 3, 3, 3],
    16: [4, 4, 4, 4],
    14: [4, 4, 3, 3],
    12: [3, 3, 3, 3],
    11: [4, 4, 3],
    9: [3, 3, 3],
    8: [4, 4],
    6: [3, 3],
    5: [5],
    4: [4],
    3: [3],
  };

  for (const [n, sizes] of Object.entries(table)) {
    it(`${n} athlètes → ${sizes.join(',')}`, () => {
      expect(groupSizes(Number(n))).toEqual(sizes);
    });
  }

  it('la somme des tailles vaut toujours n, et les groupes diffèrent d\'au plus 1', () => {
    for (let n = 3; n <= 32; n++) {
      const sizes = groupSizes(n);
      expect(sizes).toHaveLength(groupCount(n));
      expect(sizes.reduce((a, b) => a + b, 0)).toBe(n);
      expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1);
    }
  });

  it('refuse moins de 3 ou plus de 32 athlètes', () => {
    expect(() => groupSizes(2)).toThrow();
    expect(() => groupSizes(33)).toThrow();
  });
});

describe('qualificationRule', () => {
  it('suit le tableau 3.7.9', () => {
    expect(qualificationRule(32)).toMatchObject({ groups: 8, topPerGroup: 1, bestOfRank: null, total: 8 });
    expect(qualificationRule(20)).toMatchObject({ groups: 6, topPerGroup: 1, bestOfRank: { rank: 2, count: 2 }, total: 8 });
    expect(qualificationRule(17)).toMatchObject({ groups: 5, topPerGroup: 1, bestOfRank: { rank: 2, count: 3 }, total: 8 });
    expect(qualificationRule(14)).toMatchObject({ groups: 4, topPerGroup: 2, bestOfRank: null, total: 8 });
    expect(qualificationRule(10)).toMatchObject({ groups: 3, topPerGroup: 2, bestOfRank: { rank: 3, count: 2 }, total: 8 });
    expect(qualificationRule(7)).toMatchObject({ groups: 2, topPerGroup: 2, total: 4, nextRound: 'SEMIFINAL' });
    expect(qualificationRule(4)).toMatchObject({ groups: 1, total: 2, nextRound: 'FINAL' });
  });

  it('le total correspond toujours à topPerGroup × groupes + meilleurs de rang', () => {
    for (let n = 3; n <= 32; n++) {
      const r = qualificationRule(n);
      expect(r.groups * r.topPerGroup + (r.bestOfRank?.count ?? 0)).toBe(r.total);
      expect(r.total).toBeLessThanOrEqual(n);
    }
  });
});
