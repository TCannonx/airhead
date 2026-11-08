import { describe, expect, it } from 'vitest';
import { beforeText, prepRulesFor, readWorkSettings, type PrepRule } from './settings';

const cash: PrepRule = {
  id: 'r1',
  match: ['barber', 'haircut'],
  reminder: 'Bring €20 cash',
  minutes_before: 720,
};

describe('prep rules', () => {
  it('match event titles by any word, ignoring case', () => {
    expect(prepRulesFor('HAIRCUT with Joe', [cash])).toEqual([cash]);
    expect(prepRulesFor('Barber', [cash])).toEqual([cash]);
    expect(prepRulesFor('Dentist', [cash])).toEqual([]);
  });

  it('read their timing in plain words', () => {
    expect(beforeText(720)).toBe('12 h before');
    expect(beforeText(1440)).toBe('1 day before');
    expect(beforeText(45)).toBe('45 min before');
  });

  it('survive in work settings; broken ones are dropped field by field', () => {
    const ok = readWorkSettings({ data: { work: { prep_rules: [cash] } } } as never);
    expect(ok.prep_rules).toEqual([cash]);
    const bad = readWorkSettings({
      data: { work: { prep_rules: [{ id: 'x', match: [], reminder: '', minutes_before: -1 }] } },
    } as never);
    expect(bad.prep_rules).toEqual([]);
  });
});
