/**
 * États d'un combat (déroulement : WKF 2026.0, art. 6).
 *
 * SCHEDULED → CALLED (nom à l'écran) → AKA_PERFORMING → AO_PERFORMING → SCORING
 *   → REVEALED (automatique quand tous les juges ont noté) → CONFIRMED
 * L'AKA passe toujours en premier (3.1.3).
 */
import { RuleError } from './scoring.js';

export type BoutStatus =
  | 'SCHEDULED'
  | 'CALLED'
  | 'AKA_PERFORMING'
  | 'AO_PERFORMING'
  | 'SCORING'
  | 'REVEALED'
  | 'CONFIRMED'
  | 'CANCELLED';

/** Transitions manuelles. SCORING → REVEALED est automatique (dernière note reçue). */
const NEXT: Record<BoutStatus, BoutStatus | null> = {
  SCHEDULED: 'CALLED',
  CALLED: 'AKA_PERFORMING',
  AKA_PERFORMING: 'AO_PERFORMING',
  AO_PERFORMING: 'SCORING',
  SCORING: null,
  REVEALED: 'CONFIRMED',
  CONFIRMED: null,
  CANCELLED: null,
};

export function nextStatus(status: BoutStatus): BoutStatus {
  const next = NEXT[status];
  if (!next) throw new RuleError('INVALID_TRANSITION', `Aucune transition manuelle depuis ${status}`);
  return next;
}

/** Les katas se déclarent avant le début du combat (6.1). */
export const KATA_DECLARATION_OPEN: BoutStatus[] = ['SCHEDULED', 'CALLED'];

/** Un kiken peut être déclaré tant que le combat n'est pas noté. */
export const KIKEN_ALLOWED: BoutStatus[] = ['SCHEDULED', 'CALLED', 'AKA_PERFORMING', 'AO_PERFORMING'];
