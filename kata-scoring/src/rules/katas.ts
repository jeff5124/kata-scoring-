/**
 * Règles de choix des katas (WKF 2026.0, art. 5.1, 5.2, 6.3 et Annexe 1).
 *
 * - Seuls les katas de la liste officielle (numéros 1 à 102) sont autorisés ; le numéro fait foi.
 * - Jusqu'à 5 katas différents (4 en U14), un par tour.
 * - Ensuite, un kata ne peut pas être répété deux fois de suite, ni être exécuté plus de 2 fois.
 * - Au tour des médailles, tout kata est permis sauf s'il a déjà été exécuté deux fois.
 */

export const KATA_MIN = 1;
export const KATA_MAX = 102;
export const DISTINCT_KATAS_SENIOR = 5;
export const DISTINCT_KATAS_U14 = 4;
export const MAX_PERFORMANCES_PER_KATA = 2;

export type KataCheck =
  | 'OK'
  | 'KATA_NOT_IN_LIST'
  | 'MAX_2_PER_COMPETITION'
  | 'MUST_BE_DIFFERENT'
  | 'NO_CONSECUTIVE_REPEAT';

export interface KataCheckInput {
  /** Katas déjà exécutés dans la compétition, dans l'ordre des tours. */
  history: number[];
  /** Numéro du kata annoncé pour ce tour. */
  kata: number;
  /** Tour pour les médailles (finale ou match pour le bronze). */
  isMedalRound: boolean;
  /** Catégorie des moins de 14 ans (4 katas différents au lieu de 5). */
  isU14?: boolean;
  /**
   * Le règlement est ambigu sur la répétition consécutive au tour des médailles (5.2.1).
   * Par défaut (lecture littérale) : au tour des médailles, seule la limite de 2 exécutions s'applique.
   */
  consecutiveRuleInMedalRound?: boolean;
}

export function isOfficialKata(kata: number): boolean {
  return Number.isInteger(kata) && kata >= KATA_MIN && kata <= KATA_MAX;
}

export function checkKata(input: KataCheckInput): KataCheck {
  const { history, kata, isMedalRound, isU14 = false, consecutiveRuleInMedalRound = false } = input;

  if (!isOfficialKata(kata)) return 'KATA_NOT_IN_LIST';

  const times = history.filter((k) => k === kata).length;
  if (times >= MAX_PERFORMANCES_PER_KATA) return 'MAX_2_PER_COMPETITION';

  const last = history.length > 0 ? history[history.length - 1] : undefined;

  if (isMedalRound) {
    if (consecutiveRuleInMedalRound && last === kata) return 'NO_CONSECUTIVE_REPEAT';
    return 'OK';
  }

  const round = history.length + 1;
  const distinctUntil = isU14 ? DISTINCT_KATAS_U14 : DISTINCT_KATAS_SENIOR;
  if (round <= distinctUntil && times >= 1) return 'MUST_BE_DIFFERENT';
  if (last === kata) return 'NO_CONSECUTIVE_REPEAT';
  return 'OK';
}

/** Liste des katas que l'athlète peut annoncer pour ce tour (pour l'interface du coureur). */
export function availableKatas(input: Omit<KataCheckInput, 'kata'>): number[] {
  const out: number[] = [];
  for (let k = KATA_MIN; k <= KATA_MAX; k++) {
    if (checkKata({ ...input, kata: k }) === 'OK') out.push(k);
  }
  return out;
}
