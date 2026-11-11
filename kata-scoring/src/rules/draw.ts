/**
 * Tirage des poules et construction du tableau (WKF 2026.0, 3.4, 3.7 et tableau 3.7.9).
 *
 * Lecture du tableau 3.7.9 (la mise en page du PDF est dégradée, voir README « points à valider ») :
 *  - les groupes qui n'ont que 3 athlètes (au lieu de 4) sont, dans l'ordre : 8 groupes → 8,4,2,6,5,1,3,7 ;
 *    6 → 6,3,2,5,4,1 ; 5 → 5,2,1 (puis 3,4) ; 4 → 4,2,1,3 ; 3 → 3,2,1 ; 2 → 2,1. Ces tailles reproduisent
 *    toutes les lignes lisibles du tableau (ex. 30 athlètes → 44434443, 13 → 3343).
 *  - la ligne « Graine » place les têtes de série 3, 2, 4, 1 aux colonnes 2, 4, 6, 8 (8 groupes) et 1, 2, 3, 4 (4 groupes) ;
 *    on en déduit la position du groupe de la tête de série s : ceil(f_s × nombre de groupes), f = 1, ½, ¼, ¾.
 */
import { groupCount, qualificationRule } from './groups.js';
import { RuleError } from './scoring.js';

export type Rng = () => number;

/** Ordre dans lequel les groupes (1..g) passent de 4 à 3 athlètes. */
const SMALL_GROUP_ORDER: Record<number, number[]> = {
  8: [8, 4, 2, 6, 5, 1, 3, 7],
  6: [6, 3, 2, 5, 4, 1],
  5: [5, 2, 1, 3, 4],
  4: [4, 2, 1, 3],
  3: [3, 2, 1],
  2: [2, 1],
  1: [1],
};

/** Taille de chaque groupe, indexée par position (groupe 1 = index 0), selon le tableau 3.7.9. */
export function groupSizesByPosition(n: number): number[] {
  const g = groupCount(n);
  const max = Math.ceil(n / g);
  const smalls = g * max - n;
  const sizes = Array.from({ length: g }, () => max);
  for (const pos of SMALL_GROUP_ORDER[g]!.slice(0, smalls)) sizes[pos - 1] = max - 1;
  return sizes;
}

const SEED_FRACTIONS = [1, 0.5, 0.25, 0.75];

/** Numéro de groupe (1..g) de chaque tête de série 1..4 ; une tête de série en conflit n'est pas placée. */
export function seedSlots(groups: number): Map<number, number> {
  const slots = new Map<number, number>();
  const taken = new Set<number>();
  SEED_FRACTIONS.forEach((f, i) => {
    const slot = Math.ceil(f * groups);
    if (slot >= 1 && slot <= groups && !taken.has(slot)) {
      taken.add(slot);
      slots.set(i + 1, slot);
    }
  });
  return slots;
}

export interface DrawEntry {
  id: string;
  /** Tête de série 1..4 (3.4.1), sinon absent. */
  seed?: number | null;
  /** Fédération : deux athlètes de la même fédération sont séparés tant que c'est possible. */
  federationId?: string | null;
}

export function shuffle<T>(items: readonly T[], rng: Rng): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

/** Répartit les inscrits dans les groupes (tableau 3.7.9) : retourne, par groupe, la liste des identifiants. */
export function distributeToGroups(entries: DrawEntry[], rng: Rng): string[][] {
  const sizes = groupSizesByPosition(entries.length);
  const groups: DrawEntry[][] = sizes.map(() => []);
  const slots = seedSlots(sizes.length);
  const placed = new Set<string>();

  const seeded = entries
    .filter((e) => e.seed != null && slots.has(e.seed))
    .sort((a, b) => a.seed! - b.seed!);
  for (const e of seeded) {
    const g = groups[slots.get(e.seed!)! - 1]!;
    if (g.length < sizes[slots.get(e.seed!)! - 1]! && !g.some((x) => x.seed === e.seed)) {
      g.push(e);
      placed.add(e.id);
    }
  }

  for (const e of shuffle(entries.filter((x) => !placed.has(x.id)), rng)) {
    let best = -1;
    let bestScore = Infinity;
    groups.forEach((g, i) => {
      if (g.length >= sizes[i]!) return;
      const sameFed = e.federationId ? g.filter((x) => x.federationId === e.federationId).length : 0;
      // priorité : pas de même fédération, puis le groupe le plus vide ; égalité → hasard
      const score = sameFed * 100 + g.length + rng() * 0.5;
      if (score < bestScore) {
        bestScore = score;
        best = i;
      }
    });
    groups[best]!.push(e);
  }
  return groups.map((g) => g.map((e) => e.id));
}

export interface RoundRobinPair {
  round: number;
  aka: string;
  ao: string;
}

/** Calendrier toutes rondes (méthode du cercle) ; l'AKA et l'AO alternent pour équilibrer l'ordre de passage. */
export function roundRobinSchedule(ids: string[]): RoundRobinPair[] {
  if (ids.length < 2) return [];
  const list: (string | null)[] = [...ids];
  if (list.length % 2 === 1) list.push(null);
  const n = list.length;
  const pairs: RoundRobinPair[] = [];
  for (let r = 0; r < n - 1; r++) {
    for (let i = 0; i < n / 2; i++) {
      const a = list[i];
      const b = list[n - 1 - i];
      if (a == null || b == null) continue;
      const flip = (r + i) % 2 === 1;
      pairs.push({ round: r + 1, aka: flip ? b : a, ao: flip ? a : b });
    }
    list.splice(1, 0, list.pop()!); // rotation, le premier reste fixe
  }
  return pairs;
}

export interface Qualifier {
  id: string;
  /** Groupe d'origine (1..g) : pour éviter une revanche immédiate. */
  group: number;
}

export interface KnockoutPair {
  aka: Qualifier;
  ao: Qualifier;
}

/**
 * Tableau à 2, 4 ou 8 qualifiés, classés du mieux au moins bien (vainqueurs de groupe d'abord, dans l'ordre des groupes,
 * puis les suivants). Le rang 1 rencontre le rang N, etc. (1-8, 4-5, 3-6, 2-7) : les deux premiers ne se croisent qu'en finale.
 * Deux athlètes du même groupe ne se rencontrent pas au premier tour si on peut l'éviter.
 * Retourne les paires dans l'ordre du tableau : les paires 2k et 2k+1 alimentent la même demi-finale.
 */
export function knockoutPairs(ranked: Qualifier[]): KnockoutPair[] {
  const n = ranked.length;
  if (![2, 4, 8].includes(n)) throw new RuleError('PLAYER_COUNT_UNSUPPORTED', `Tableau impossible avec ${n} qualifiés`);
  const order = n === 8 ? [1, 8, 4, 5, 3, 6, 2, 7] : n === 4 ? [1, 4, 2, 3] : [1, 2];
  const slots = order.map((r) => ranked[r - 1]!);

  // anti-revanche : on échange un adversaire avec un autre de la moitié basse du classement
  const clash = (i: number) => slots[i]!.group === slots[i + 1]!.group;
  for (let i = 0; i < slots.length; i += 2) {
    if (!clash(i)) continue;
    for (let j = 0; j < slots.length; j += 2) {
      if (j === i) continue;
      const cand = j; // échange l'AO de la paire i avec l'AO de la paire j
      const a = slots[i + 1]!;
      const b = slots[cand + 1]!;
      if (slots[i]!.group !== b.group && slots[cand]!.group !== a.group) {
        slots[i + 1] = b;
        slots[cand + 1] = a;
        break;
      }
    }
  }
  const pairs: KnockoutPair[] = [];
  for (let i = 0; i < slots.length; i += 2) pairs.push({ aka: slots[i]!, ao: slots[i + 1]! });
  return pairs;
}

export { qualificationRule };

// ───────────── Élimination avec repêchage (3.6) ─────────────

export const nextPow2 = (n: number): number => {
  let p = 1;
  while (p < n) p *= 2;
  return p;
};

/** Ordre des têtes de série dans un tableau de `size` places (1-8, 4-5, 2-7, 3-6 pour 8) ; les paires voisines se rencontrent. */
export function seedingOrder(size: number): number[] {
  let order = [1];
  while (order.length < size) {
    const next = order.length * 2;
    order = order.flatMap((s) => [s, next + 1 - s]);
  }
  return order;
}

export type PlanSource = { kind: 'entry'; id: string } | { kind: 'match'; level: number; index: number };

export interface PlanMatch {
  /** Niveau dans l'arbre : 1 = premier tour possible, `depth` = finale du tableau. */
  level: number;
  index: number;
  a: PlanSource;
  b: PlanSource;
}

export interface EliminationPlan {
  depth: number;
  matches: PlanMatch[];
  /** La finale du tableau ; un athlète seul (pas de combat) ou null si le tableau est vide. */
  root: PlanSource | null;
}

/**
 * Tableau à élimination directe pour les athlètes `ids`, classés du meilleur au moins bon, dans un tableau de `size` places
 * (puissance de 2). Les places en trop sont des exempts, attribués aux mieux classés : ils n'ont pas de combat au premier tour.
 */
export function eliminationPlan(ids: string[], size: number): EliminationPlan {
  if (size < 1 || (size & (size - 1)) !== 0 || ids.length > size) {
    throw new RuleError('PLAYER_COUNT_UNSUPPORTED', `Tableau de ${size} places impossible pour ${ids.length} athlètes`);
  }
  const depth = Math.log2(size);
  const order = seedingOrder(size);
  const matches: PlanMatch[] = [];
  const node = (level: number, index: number): PlanSource | null => {
    if (level === 0) {
      const rank = order[index]!;
      return rank <= ids.length ? { kind: 'entry', id: ids[rank - 1]! } : null;
    }
    const a = node(level - 1, 2 * index);
    const b = node(level - 1, 2 * index + 1);
    if (!a || !b) return a ?? b;
    matches.push({ level, index, a, b });
    return { kind: 'match', level, index };
  };
  return { depth, matches, root: node(depth, 0) };
}

/**
 * Répartit les inscrits en deux poules (3.2.4) : tête de série 1 et 2 dans des poules différentes, 3 et 4 de même.
 * Retourne chaque poule classée (têtes de série d'abord), prête pour `eliminationPlan`.
 */
export function splitInTwoPools(entries: DrawEntry[], rng: Rng): [string[], string[]] {
  const total = entries.length;
  const cap = [Math.ceil(total / 2), Math.floor(total / 2)];
  const pools: DrawEntry[][] = [[], []];
  const seedPool: Record<number, number> = { 1: 0, 2: 1, 3: 1, 4: 0 };
  const placed = new Set<string>();
  for (const e of [...entries].filter((x) => x.seed != null && seedPool[x.seed] !== undefined).sort((a, b) => a.seed! - b.seed!)) {
    const p = seedPool[e.seed!]!;
    if (pools[p]!.length < cap[p]! && !pools[p]!.some((x) => x.seed === e.seed)) {
      pools[p]!.push(e);
      placed.add(e.id);
    }
  }
  for (const e of shuffle(entries.filter((x) => !placed.has(x.id)), rng)) {
    let best = -1;
    let bestScore = Infinity;
    pools.forEach((pool, i) => {
      if (pool.length >= cap[i]!) return;
      const sameFed = e.federationId ? pool.filter((x) => x.federationId === e.federationId).length : 0;
      const score = sameFed * 100 + pool.length + rng() * 0.5;
      if (score < bestScore) {
        bestScore = score;
        best = i;
      }
    });
    pools[best]!.push(e);
  }
  return [pools[0]!.map((e) => e.id), pools[1]!.map((e) => e.id)];
}
