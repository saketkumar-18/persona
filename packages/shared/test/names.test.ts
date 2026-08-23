import { describe, expect, it } from 'vitest';
import { randomAlias, randomEmoji, aliasFromSeed, GHOST_EMOJIS } from '../src/names';

describe('anonymous identity helpers', () => {
  it('aliases are "Adjective Noun"', () => {
    for (let i = 0; i < 50; i += 1) {
      expect(randomAlias()).toMatch(/^[A-Z][a-z]+ [A-Z][a-z]+$/);
    }
  });

  it('emojis come from the fixed set only', () => {
    const set = new Set<string>(GHOST_EMOJIS);
    for (let i = 0; i < 50; i += 1) {
      expect(set.has(randomEmoji())).toBe(true);
    }
  });

  it('aliasFromSeed is deterministic', () => {
    expect(aliasFromSeed('gl_abc')).toEqual(aliasFromSeed('gl_abc'));
    expect(aliasFromSeed('gl_abc').alias).toMatch(/^[A-Z][a-z]+ [A-Z][a-z]+$/);
  });

  it('different seeds usually produce different identities', () => {
    const a = aliasFromSeed('seed-1');
    const b = aliasFromSeed('seed-2');
    expect(a.alias === b.alias && a.emoji === b.emoji).toBe(false);
  });
});
