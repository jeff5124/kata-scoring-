import { describe, expect, it } from 'vitest';
import { distributeToGroups, groupSizesByPosition, knockoutPairs, roundRobinSchedule, seedSlots, type DrawEntry } from './draw.js';
import { groupSizes } from './groups.js';

const sizesOf = (n: number) => groupSizesByPosition(n).join('');
let seedState = 1;
const rng = () => ((seedState = (seedState * 16807) % 2147483647) / 2147483647);

describe('tailles des groupes (tableau 3.7.9)', () => {
  it('reproduit les lignes lisibles du tableau, groupe par groupe', () => {
    expect(sizesOf(32)).toBe('44444444');
    expect(sizesOf(31)).toBe('44444443');
    expect(sizesOf(30)).toBe('44434443');
    expect(sizesOf(29)).toBe('43434443');
    expect(sizesOf(28)).toBe('43434343');
    expect(sizesOf(27)).toBe('43433343');
    expect(sizesOf(26)).toBe('33433343');
    expect(sizesOf(25)).toBe('33333343');
    expect(sizesOf(24)).toBe('33333333');
    expect(sizesOf(23)).toBe('444443');
    expect(sizesOf(22)).toBe('443443');
    expect(sizesOf(21)).toBe('433443');
    expect(sizesOf(20)).toBe('433433');
    expect(sizesOf(19)).toBe('433333');
    expect(sizesOf(18)).toBe('333333');
    expect(sizesOf(17)).toBe('33443');
    expect(sizesOf(16)).toBe('4444');
    expect(sizesOf(15)).toBe('4443');
    expect(sizesOf(14)).toBe('4343');
    expect(sizesOf(13)).toBe('3343');
    expect(sizesOf(12)).toBe('3333');
    expect(sizesOf(11)).toBe('443');
    expect(sizesOf(10)).toBe('433');
    expect(sizesOf(9)).toBe('333');
    expect(sizesOf(8)).toBe('44');
    expect(sizesOf(7)).toBe('43');
    expect(sizesOf(6)).toBe('33');
    expect(sizesOf(5)).toBe('5');
    expect(sizesOf(4)).toBe('4');
    expect(sizesOf(3)).toBe('3');
  });

  it('est cohérent avec groupSizes (mêmes tailles, ordre mis à part) et somme = n', () => {
    for (let n = 3; n <= 32; n++) {
      const by = groupSizesByPosition(n);
      expect(by.reduce((a, b) => a + b, 0)).toBe(n);
      expect([...by].sort((a, b) => b - a)).toEqual(groupSizes(n));
    }
  });
});

describe('têtes de série', () => {
  it('place 1, 2, 3, 4 comme dans la ligne « Graine » (4 groupes : D, B, A, C ; 8 groupes : 8, 4, 2, 6)', () => {
    expect([...seedSlots(4)]).toEqual([[1, 4], [2, 2], [3, 1], [4, 3]]);
    expect([...seedSlots(8)]).toEqual([[1, 8], [2, 4], [3, 2], [4, 6]]);
    expect([...seedSlots(2)]).toEqual([[1, 2], [2, 1]]);
    expect([...seedSlots(1)]).toEqual([[1, 1]]);
    expect(seedSlots(3).size).toBe(3); // la 4e ne trouve pas de groupe libre
  });

  it('sépare les têtes de série dans des groupes différents, à leur emplacement', () => {
    const entries: DrawEntry[] = Array.from({ length: 16 }, (_, i) => ({ id: `e${i}`, seed: i < 4 ? i + 1 : null }));
    const groups = distributeToGroups(entries, rng);
    expect(groups.map((g) => g.length)).toEqual([4, 4, 4, 4]);
    expect(groups[3]).toContain('e0'); // tête de série 1 → groupe D
    expect(groups[1]).toContain('e1'); // 2 → B
    expect(groups[0]).toContain('e2'); // 3 → A
    expect(groups[2]).toContain('e3'); // 4 → C
  });
});

describe('tirage', () => {
  it('place chaque inscrit une fois et respecte les tailles pour tout n de 3 à 32', () => {
    for (let n = 3; n <= 32; n++) {
      const entries = Array.from({ length: n }, (_, i) => ({ id: `e${i}` }));
      const groups = distributeToGroups(entries, rng);
      expect(groups.map((g) => g.length)).toEqual(groupSizesByPosition(n));
      expect(new Set(groups.flat()).size).toBe(n);
    }
  });

  it('sépare les athlètes d\'une même fédération quand c\'est possible', () => {
    // 16 athlètes, 4 fédérations de 4 : chaque groupe doit contenir une fédération de chaque
    const entries: DrawEntry[] = Array.from({ length: 16 }, (_, i) => ({ id: `e${i}`, federationId: `f${i % 4}` }));
    for (let t = 0; t < 20; t++) {
      for (const g of distributeToGroups(entries, rng)) {
        const feds = g.map((id) => entries.find((e) => e.id === id)!.federationId);
        expect(new Set(feds).size).toBe(g.length);
      }
    }
  });
});

describe('calendrier toutes rondes', () => {
  it.each([2, 3, 4, 5])('chacun rencontre chacun une fois (%i athlètes)', (n) => {
    const ids = Array.from({ length: n }, (_, i) => `a${i}`);
    const pairs = roundRobinSchedule(ids);
    expect(pairs).toHaveLength((n * (n - 1)) / 2);
    const keys = pairs.map((p) => [p.aka, p.ao].sort().join('|'));
    expect(new Set(keys).size).toBe(pairs.length);
    // personne ne passe deux fois dans la même ronde
    for (let r = 1; r <= n; r++) {
      const inRound = pairs.filter((p) => p.round === r).flatMap((p) => [p.aka, p.ao]);
      expect(new Set(inRound).size).toBe(inRound.length);
    }
  });

  it('équilibre l\'ordre de passage (AKA) à ±1 près pour 4 athlètes', () => {
    const pairs = roundRobinSchedule(['a', 'b', 'c', 'd']);
    const akaCount = new Map<string, number>();
    pairs.forEach((p) => akaCount.set(p.aka, (akaCount.get(p.aka) ?? 0) + 1));
    expect(Math.max(...akaCount.values()) - Math.min(...akaCount.values())).toBeLessThanOrEqual(1);
  });
});

describe('tableau à élimination', () => {
  const q = (id: string, group: number) => ({ id, group });

  it('8 vainqueurs de groupe : 1-8, 4-5, 3-6, 2-7', () => {
    const ranked = Array.from({ length: 8 }, (_, i) => q(`w${i + 1}`, i + 1));
    const p = knockoutPairs(ranked);
    expect(p.map((x) => [x.aka.id, x.ao.id])).toEqual([['w1', 'w8'], ['w4', 'w5'], ['w3', 'w6'], ['w2', 'w7']]);
  });

  it('4 groupes, 2 premiers : jamais deux athlètes du même groupe au premier tour', () => {
    const ranked = [q('A1', 1), q('B1', 2), q('C1', 3), q('D1', 4), q('A2', 1), q('B2', 2), q('C2', 3), q('D2', 4)];
    for (const p of knockoutPairs(ranked)) expect(p.aka.group).not.toBe(p.ao.group);
  });

  it('6 groupes + 2 meilleurs deuxièmes : évite la revanche avec échange', () => {
    const ranked = [1, 2, 3, 4, 5, 6].map((g) => q(`w${g}`, g)).concat([q('s1', 1), q('s8', 6)]);
    // w1 (rang 1) rencontrerait s8 (rang 8, groupe 6) sans problème ; w6 (rang 6) rencontre s3... on vérifie seulement l'absence de revanche
    for (const p of knockoutPairs(ranked)) expect(p.aka.group).not.toBe(p.ao.group);
  });

  it('2 qualifiés → une finale ; 4 → deux demi-finales croisées ; refuse 3', () => {
    expect(knockoutPairs([q('x', 1), q('y', 1)])).toHaveLength(1);
    const sf = knockoutPairs([q('a', 1), q('b', 2), q('c', 2), q('d', 1)]);
    // a et d (même groupe) ne se rencontrent pas : l'adversaire est échangé avec celui de l'autre demi-finale
    expect(sf.map((x) => [x.aka.id, x.ao.id])).toEqual([['a', 'c'], ['b', 'd']]);
    expect(() => knockoutPairs([q('a', 1), q('b', 2), q('c', 3)])).toThrow();
  });
});

import { eliminationPlan, nextPow2, seedingOrder, splitInTwoPools } from './draw.js';

describe('élimination avec repêchage : tableau d\'une poule', () => {
  it('ordre des têtes de série', () => {
    expect(seedingOrder(8)).toEqual([1, 8, 4, 5, 2, 7, 3, 6]);
    expect(seedingOrder(2)).toEqual([1, 2]);
    expect(nextPow2(9)).toBe(16);
    expect(nextPow2(8)).toBe(8);
  });

  it.each([1, 2, 3, 4, 5, 7, 8, 9, 13, 16])('%i athlètes : n-1 combats, chacun placé une fois, finale au dernier niveau', (m) => {
    const ids = Array.from({ length: m }, (_, i) => `a${i + 1}`);
    const plan = eliminationPlan(ids, nextPow2(Math.max(m, 1)));
    expect(plan.matches).toHaveLength(Math.max(m - 1, 0));
    const entries = plan.matches.flatMap((x) => [x.a, x.b]).filter((s) => s.kind === 'entry').map((s) => (s as { id: string }).id);
    // un athlète exempté apparaît dans un combat de niveau supérieur : il est quand même placé une seule fois
    const alone = plan.root?.kind === 'entry' ? [(plan.root as { id: string }).id] : [];
    expect(new Set([...entries, ...alone]).size).toBe(m);
    if (m >= 2) expect(plan.root).toEqual({ kind: 'match', level: plan.depth, index: 0 });
    // chaque combat (sauf la finale) alimente exactement un combat supérieur
    const fed = plan.matches.flatMap((x) => [x.a, x.b]).filter((s) => s.kind === 'match');
    expect(fed).toHaveLength(Math.max(m - 2, 0));
  });

  it('les exempts vont aux mieux classés : 5 athlètes → a1, a2, a3 sans combat au premier niveau', () => {
    const plan = eliminationPlan(['a1', 'a2', 'a3', 'a4', 'a5'], 8);
    const firstRound = plan.matches.filter((x) => x.level === 1);
    expect(firstRound).toHaveLength(1);
    expect(firstRound[0]).toMatchObject({ a: { id: 'a4' }, b: { id: 'a5' } });
  });

  it('les têtes de série 1 et 2 ne se rencontrent qu\'en finale', () => {
    const plan = eliminationPlan(Array.from({ length: 16 }, (_, i) => `a${i + 1}`), 16);
    const sides = (src: PlanSourceT): string[] =>
      src.kind === 'entry' ? [src.id] : (() => { const m = plan.matches.find((x) => x.level === src.level && x.index === src.index)!; return [...sides(m.a), ...sides(m.b)]; })();
    const final = plan.matches.find((x) => x.level === plan.depth)!;
    expect(sides(final.a)).toContain('a1');
    expect(sides(final.b)).toContain('a2');
  });

  it('refuse une taille qui n\'est pas une puissance de 2', () => {
    expect(() => eliminationPlan(['a', 'b', 'c'], 3)).toThrow();
    expect(() => eliminationPlan(['a', 'b', 'c'], 2)).toThrow();
  });
});

type PlanSourceT = ReturnType<typeof eliminationPlan>['matches'][number]['a'];

describe('répartition en deux poules', () => {
  it('moitiés équilibrées, têtes de série 1-2 et 3-4 séparées, fédérations réparties', () => {
    const entries: DrawEntry[] = Array.from({ length: 13 }, (_, i) => ({ id: `e${i}`, seed: i < 4 ? i + 1 : null, federationId: `f${i % 2}` }));
    const [a, b] = splitInTwoPools(entries, rng);
    expect([a.length, b.length]).toEqual([7, 6]);
    expect(a[0]).toBe('e0'); // tête de série 1 en tête de la poule A
    expect(b[0]).toBe('e1'); // tête de série 2 en tête de la poule B
    expect(a).toContain('e3');
    expect(b).toContain('e2');
    expect(new Set([...a, ...b]).size).toBe(13);
  });
});
