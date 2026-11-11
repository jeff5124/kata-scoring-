import { describe, expect, it } from 'vitest';
import { drawPanel, eligibleJudges, type PanelCandidate } from './panel.js';
import { nextStatus } from './boutState.js';
import { RuleError } from './scoring.js';

const judge = (id: string, federationId: string | null, country: string | null): PanelCandidate => ({
  id,
  federationId,
  country,
});

const judges = [
  judge('j1', 'f1', 'BEN'),
  judge('j2', 'f2', 'FRA'),
  judge('j3', 'f3', 'JPN'),
  judge('j4', 'f4', 'ESP'),
  judge('j5', 'f5', 'ITA'),
  judge('j6', 'f6', 'EGY'),
  judge('j7', 'f7', 'MAR'),
  judge('j8', 'f8', 'TUR'),
];

describe('eligibleJudges (4.8)', () => {
  it('exclut les juges de la même fédération ou du même pays qu\'un participant', () => {
    const ok = eligibleJudges(judges, [
      { federationId: 'f1', country: 'BEN' },
      { federationId: 'fX', country: 'FRA' },
    ]);
    expect(ok.map((j) => j.id)).toEqual(['j3', 'j4', 'j5', 'j6', 'j7', 'j8']);
  });

  it('garde un juge sans fédération ni pays renseignés', () => {
    expect(eligibleJudges([judge('j9', null, null)], [{ federationId: 'f1', country: 'BEN' }])).toHaveLength(1);
  });
});

describe('drawPanel', () => {
  const participants = [{ federationId: 'f1', country: 'BEN' }];

  it('tire le bon nombre de juges, positions 1..N, le premier est juge en chef', () => {
    const panel = drawPanel(judges, participants, 5);
    expect(panel).toHaveLength(5);
    expect(panel.map((s) => s.position)).toEqual([1, 2, 3, 4, 5]);
    expect(panel.filter((s) => s.isChief)).toHaveLength(1);
    expect(panel[0]!.isChief).toBe(true);
    expect(new Set(panel.map((s) => s.officialId)).size).toBe(5);
    expect(panel.map((s) => s.officialId)).not.toContain('j1');
  });

  it('est déterministe avec un générateur fixé', () => {
    const a = drawPanel(judges, participants, 7, () => 0);
    const b = drawPanel(judges, participants, 7, () => 0);
    expect(a).toEqual(b);
  });

  it('échoue s\'il n\'y a pas assez de juges éligibles', () => {
    try {
      drawPanel(judges, participants, 8);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(RuleError);
      expect((e as RuleError).code).toBe('NOT_ENOUGH_JUDGES');
    }
  });
});

describe('nextStatus', () => {
  it('suit le déroulement du combat', () => {
    expect(nextStatus('SCHEDULED')).toBe('CALLED');
    expect(nextStatus('CALLED')).toBe('AKA_PERFORMING');
    expect(nextStatus('AKA_PERFORMING')).toBe('AO_PERFORMING');
    expect(nextStatus('AO_PERFORMING')).toBe('SCORING');
    expect(nextStatus('REVEALED')).toBe('CONFIRMED');
  });

  it('refuse les transitions manuelles impossibles (SCORING se termine par les notes)', () => {
    for (const s of ['SCORING', 'CONFIRMED', 'CANCELLED'] as const) {
      expect(() => nextStatus(s)).toThrow(RuleError);
    }
  });
});
