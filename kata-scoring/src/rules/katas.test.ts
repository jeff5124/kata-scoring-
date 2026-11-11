import { describe, expect, it } from 'vitest';
import { availableKatas, checkKata } from './katas.js';

describe('checkKata', () => {
  it('refuse un numéro hors de la liste officielle (1 à 102)', () => {
    for (const k of [0, 103, -1, 1.5]) {
      expect(checkKata({ history: [], kata: k, isMedalRound: false })).toBe('KATA_NOT_IN_LIST');
    }
    expect(checkKata({ history: [], kata: 1, isMedalRound: false })).toBe('OK');
    expect(checkKata({ history: [], kata: 102, isMedalRound: false })).toBe('OK');
  });

  it("impose des katas différents jusqu'au 5e tour (senior)", () => {
    expect(checkKata({ history: [10], kata: 10, isMedalRound: false })).toBe('MUST_BE_DIFFERENT');
    expect(checkKata({ history: [10, 20, 30, 40], kata: 10, isMedalRound: false })).toBe('MUST_BE_DIFFERENT');
    expect(checkKata({ history: [10, 20, 30, 40], kata: 50, isMedalRound: false })).toBe('OK');
  });

  it('autorise une répétition à partir du 6e tour, mais pas deux fois de suite', () => {
    const history = [10, 20, 30, 40, 50];
    expect(checkKata({ history, kata: 10, isMedalRound: false })).toBe('OK');
    expect(checkKata({ history, kata: 50, isMedalRound: false })).toBe('NO_CONSECUTIVE_REPEAT');
  });

  it('U14 : la répétition est autorisée à partir du 5e tour', () => {
    const history = [10, 20, 30, 40];
    expect(checkKata({ history, kata: 10, isMedalRound: false, isU14: true })).toBe('OK');
    expect(checkKata({ history, kata: 40, isMedalRound: false, isU14: true })).toBe('NO_CONSECUTIVE_REPEAT');
    expect(checkKata({ history: [10, 20, 30], kata: 10, isMedalRound: false, isU14: true })).toBe('MUST_BE_DIFFERENT');
  });

  it('jamais plus de 2 exécutions du même kata', () => {
    const history = [10, 20, 30, 40, 50, 10];
    expect(checkKata({ history, kata: 10, isMedalRound: false })).toBe('MAX_2_PER_COMPETITION');
    expect(checkKata({ history, kata: 10, isMedalRound: true })).toBe('MAX_2_PER_COMPETITION');
  });

  it('tour des médailles : tout kata permis sauf déjà exécuté 2 fois', () => {
    expect(checkKata({ history: [10, 20], kata: 10, isMedalRound: true })).toBe('OK');
    expect(checkKata({ history: [10, 20], kata: 20, isMedalRound: true })).toBe('OK');
  });

  it('option : appliquer la règle des répétitions consécutives au tour des médailles', () => {
    expect(
      checkKata({ history: [10, 20], kata: 20, isMedalRound: true, consecutiveRuleInMedalRound: true }),
    ).toBe('NO_CONSECUTIVE_REPEAT');
  });
});

describe('availableKatas', () => {
  it('propose les 102 katas au premier tour', () => {
    expect(availableKatas({ history: [], isMedalRound: false })).toHaveLength(102);
  });

  it('exclut les katas déjà exécutés pendant les tours imposés comme différents', () => {
    const list = availableKatas({ history: [7, 8], isMedalRound: false });
    expect(list).toHaveLength(100);
    expect(list).not.toContain(7);
    expect(list).not.toContain(8);
  });
});
