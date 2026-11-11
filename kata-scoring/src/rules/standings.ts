/**
 * Classement d'un groupe en round-robin et départages (WKF 2026.0, art. 5.11 à 5.13, Annexe 4).
 *
 * Critères, dans l'ordre (individuel, 5.11) :
 *   1) plus grand nombre de points de victoire (3 par victoire)
 *   2) vainqueur du combat entre les athlètes à égalité
 *   3) plus grande somme de votes des juges obtenus dans tous les combats du groupe
 *   4) meilleur classement mondial (individuel seulement)
 *   5) combat supplémentaire avec un nouveau kata
 * Pour les équipes (5.12) : mêmes critères sans le classement mondial.
 *
 * Choix d'implémentation (le règlement est muet) :
 *   - à plus de 2 à égalité, le critère 2 n'est appliqué que s'il donne un ordre strict et complet
 *     (pas de cycle A>B>C>A) ; sinon on passe au critère 3.
 *   - un combat supplémentaire (kind: 'EXTRA') sert au critère 2 mais ne compte ni points ni votes.
 */
import { VICTORY_POINTS } from './scoring.js';

export interface Competitor {
  id: string;
  worldRank?: number | null;
}

export interface BoutRecord {
  id: string;
  akaId: string;
  aoId: string;
  akaVotes: number;
  aoVotes: number;
  winnerId: string;
  kind?: 'REGULAR' | 'EXTRA';
}

export interface Standing {
  id: string;
  played: number;
  wins: number;
  points: number;
  votesFor: number;
  votesAgainst: number;
  voteDiff: number;
  worldRank: number | null;
}

export interface RankedEntry extends Standing {
  rank: number;
  /** Égalité non résolue : un combat supplémentaire est nécessaire. */
  tied: boolean;
}

export interface GroupRanking {
  ranking: RankedEntry[];
  /** Ensembles d'identifiants encore à égalité (combat supplémentaire requis). */
  unresolvedTies: string[][];
}

export function computeStandings(competitors: Competitor[], bouts: BoutRecord[]): Map<string, Standing> {
  const map = new Map<string, Standing>();
  for (const c of competitors) {
    map.set(c.id, {
      id: c.id,
      played: 0,
      wins: 0,
      points: 0,
      votesFor: 0,
      votesAgainst: 0,
      voteDiff: 0,
      worldRank: c.worldRank ?? null,
    });
  }

  for (const b of bouts) {
    if (b.kind === 'EXTRA') continue;
    const aka = map.get(b.akaId);
    const ao = map.get(b.aoId);
    if (!aka || !ao) throw new Error(`Combat ${b.id} : participant inconnu`);
    if (b.winnerId !== b.akaId && b.winnerId !== b.aoId) {
      throw new Error(`Combat ${b.id} : vainqueur inconnu`);
    }
    aka.played++;
    ao.played++;
    aka.votesFor += b.akaVotes;
    aka.votesAgainst += b.aoVotes;
    ao.votesFor += b.aoVotes;
    ao.votesAgainst += b.akaVotes;
    const winner = b.winnerId === b.akaId ? aka : ao;
    winner.wins++;
    winner.points += VICTORY_POINTS;
  }

  for (const s of map.values()) s.voteDiff = s.votesFor - s.votesAgainst;
  return map;
}

/** Vainqueur du dernier combat entre a et b (tous types confondus), ou null s'ils ne se sont pas rencontrés. */
export function headToHead(a: string, b: string, bouts: BoutRecord[]): string | null {
  for (let i = bouts.length - 1; i >= 0; i--) {
    const x = bouts[i]!;
    if ((x.akaId === a && x.aoId === b) || (x.akaId === b && x.aoId === a)) return x.winnerId;
  }
  return null;
}

function splitBy<T>(items: T[], key: (t: T) => number, dir: 'asc' | 'desc'): T[][] {
  const sorted = [...items].sort((x, y) => (dir === 'asc' ? key(x) - key(y) : key(y) - key(x)));
  const out: T[][] = [];
  for (const item of sorted) {
    const last = out[out.length - 1];
    if (last && key(last[0]!) === key(item)) last.push(item);
    else out.push([item]);
  }
  return out;
}

/** Critère 2 appliqué à un ensemble : renvoie un ordre strict, ou null s'il n'y en a pas. */
function strictHeadToHeadOrder(ids: string[], bouts: BoutRecord[]): string[][] | null {
  const wins = new Map<string, number>(ids.map((id) => [id, 0]));
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const a = ids[i]!;
      const b = ids[j]!;
      const w = headToHead(a, b, bouts);
      if (!w) return null;
      wins.set(w, (wins.get(w) ?? 0) + 1);
    }
  }
  if (new Set(wins.values()).size !== ids.length) return null; // cycle ou égalité
  return [...ids].sort((x, y) => wins.get(y)! - wins.get(x)!).map((id) => [id]);
}

export function rankGroup(
  competitors: Competitor[],
  bouts: BoutRecord[],
  opts: { isTeam?: boolean } = {},
): GroupRanking {
  const standings = computeStandings(competitors, bouts);
  const st = (id: string) => standings.get(id)!;

  const resolveBucket = (ids: string[]): string[][] => {
    if (ids.length === 1) return [ids];

    const byH2h = strictHeadToHeadOrder(ids, bouts); // critère 2
    if (byH2h) return byH2h;

    // critère 3 : somme des votes obtenus
    return splitBy(ids, (id) => st(id).votesFor, 'desc').flatMap((cls) => {
      if (cls.length === 1 || opts.isTeam) return [cls];
      // critère 4 : classement mondial (individuel seulement), absent = moins bien classé
      return splitBy(cls, (id) => st(id).worldRank ?? Number.POSITIVE_INFINITY, 'asc');
    });
  };

  const classes: string[][] = splitBy([...standings.values()], (s) => s.points, 'desc').flatMap((bucket) =>
    resolveBucket(bucket.map((s) => s.id)),
  );

  const ranking: RankedEntry[] = [];
  const unresolvedTies: string[][] = [];
  let position = 1;
  for (const cls of classes) {
    const sorted = [...cls].sort();
    const tied = sorted.length > 1;
    if (tied) unresolvedTies.push(sorted); // critère 5 : combat supplémentaire
    for (const id of sorted) ranking.push({ ...st(id), rank: position, tied });
    position += sorted.length;
  }
  return { ranking, unresolvedTies };
}

export interface CrossGroupSelection {
  qualified: string[];
  /** Concurrents à égalité à la limite : un kata supplémentaire est requis (5.13 point 3). */
  tiedAtCutoff: string[];
  /** Nombre de places à attribuer parmi les concurrents à égalité. */
  slotsForTied: number;
}

/**
 * Sélectionne les `count` meilleurs d'un même rang (ex. les 2 meilleurs 2es) entre groupes différents,
 * selon la plus grande différence de votes pour/contre (5.13).
 */
export function selectBestAcrossGroups(candidates: Standing[], count: number): CrossGroupSelection {
  const sorted = [...candidates].sort((a, b) => b.voteDiff - a.voteDiff);
  if (count >= sorted.length) {
    return { qualified: sorted.map((s) => s.id), tiedAtCutoff: [], slotsForTied: 0 };
  }
  const cutoff = sorted[count - 1]!.voteDiff;
  const clear = sorted.filter((s) => s.voteDiff > cutoff);
  const tied = sorted.filter((s) => s.voteDiff === cutoff);
  if (clear.length + tied.length <= count) {
    return { qualified: [...clear, ...tied].map((s) => s.id), tiedAtCutoff: [], slotsForTied: 0 };
  }
  return {
    qualified: clear.map((s) => s.id),
    tiedAtCutoff: tied.map((s) => s.id),
    slotsForTied: count - clear.length,
  };
}
