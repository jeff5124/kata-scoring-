/**
 * Tirage au sort du panel de juges (WKF 2026.0, art. 4.1, 4.3, 4.8).
 *
 * - Les juges sont tirés au hasard parmi les juges disponibles.
 * - Un juge ne doit pas avoir la même nationalité ni appartenir à la même fédération nationale
 *   que l'un des participants (4.8).
 */
import { RuleError } from './scoring.js';

export interface PanelCandidate {
  id: string;
  federationId: string | null;
  country: string | null;
}

export interface Participant {
  federationId: string | null;
  country: string | null;
}

export interface PanelSeat {
  officialId: string;
  /** Position 1 à N (J1 à J7). */
  position: number;
  /** Le juge en position 1 fait office de juge en chef. */
  isChief: boolean;
}

export function eligibleJudges(candidates: PanelCandidate[], participants: Participant[]): PanelCandidate[] {
  const federations = new Set(participants.map((p) => p.federationId).filter((x): x is string => !!x));
  const countries = new Set(participants.map((p) => p.country?.trim()).filter((x): x is string => !!x));
  return candidates.filter(
    (c) => !(c.federationId && federations.has(c.federationId)) && !(c.country && countries.has(c.country.trim())),
  );
}

export function drawPanel(
  candidates: PanelCandidate[],
  participants: Participant[],
  size: number,
  rng: () => number = Math.random,
): PanelSeat[] {
  const eligible = eligibleJudges(candidates, participants);
  if (eligible.length < size) {
    throw new RuleError('NOT_ENOUGH_JUDGES', `${eligible.length} juges éligibles pour ${size} places`);
  }
  const pool = [...eligible];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [pool[i], pool[j]] = [pool[j]!, pool[i]!];
  }
  return pool.slice(0, size).map((c, i) => ({ officialId: c.id, position: i + 1, isChief: i === 0 }));
}
