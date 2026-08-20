import { describe, expect, it } from 'vitest';
import { checkGuess, levenshtein, maskWord, normalizeGuess, pickHintIndices } from '../src/guess.js';

describe('normalizeGuess', () => {
  it('lowercases', () => {
    expect(normalizeGuess('BeAr')).toBe('bear');
  });

  it('strips diacritics', () => {
    expect(normalizeGuess('café')).toBe('cafe');
    expect(normalizeGuess('jalapeño')).toBe('jalapeno');
    expect(normalizeGuess('naïve')).toBe('naive');
  });

  it('strips whitespace so spacing never matters', () => {
    expect(normalizeGuess('ice cream')).toBe('icecream');
    expect(normalizeGuess('  ice   cream  ')).toBe('icecream');
    expect(normalizeGuess('icecream')).toBe('icecream');
  });

  it('strips punctuation and symbols', () => {
    expect(normalizeGuess('hot-dog')).toBe('hotdog');
    expect(normalizeGuess("jack-o'-lantern")).toBe('jackolantern');
    expect(normalizeGuess('yo-yo!!!')).toBe('yoyo');
    expect(normalizeGuess('...pizza?')).toBe('pizza');
  });

  it('keeps digits', () => {
    expect(normalizeGuess('area 51')).toBe('area51');
  });

  it('returns empty for input with no alphanumerics', () => {
    expect(normalizeGuess('   ')).toBe('');
    expect(normalizeGuess('???!!!')).toBe('');
  });

  it('collapses the spacing variants of a masked-looking guess consistently', () => {
    expect(normalizeGuess('HOT DOG')).toBe(normalizeGuess('hotdog'));
  });
});

describe('levenshtein', () => {
  it('is zero for identical strings', () => {
    expect(levenshtein('kitten', 'kitten')).toBe(0);
  });

  it('handles empty strings', () => {
    expect(levenshtein('', '')).toBe(0);
    expect(levenshtein('', 'abc')).toBe(3);
    expect(levenshtein('abc', '')).toBe(3);
  });

  it('computes the classic example', () => {
    expect(levenshtein('kitten', 'sitting')).toBe(3);
    expect(levenshtein('saturday', 'sunday')).toBe(3);
    expect(levenshtein('flaw', 'lawn')).toBe(2);
  });

  it('counts a single substitution, insertion or deletion as one', () => {
    expect(levenshtein('bear', 'beer')).toBe(1);
    expect(levenshtein('bear', 'bears')).toBe(1);
    expect(levenshtein('bears', 'bear')).toBe(1);
  });

  it('is symmetric', () => {
    expect(levenshtein('elephant', 'relevant')).toBe(levenshtein('relevant', 'elephant'));
  });

  it('short circuits above max without lying about small distances', () => {
    expect(levenshtein('bear', 'beer', 1)).toBe(1);
    // A distance of 3 with max=1 only has to report "more than 1".
    expect(levenshtein('kitten', 'sitting', 1)).toBeGreaterThan(1);
    // Length difference alone can exceed the bound.
    expect(levenshtein('a', 'abcdefgh', 2)).toBeGreaterThan(2);
  });
});

describe('checkGuess', () => {
  it('accepts an exact match', () => {
    expect(checkGuess('elephant', 'elephant')).toBe('correct');
  });

  it('accepts matches that differ only in case, spacing, accents or punctuation', () => {
    expect(checkGuess('ICE CREAM', 'ice cream')).toBe('correct');
    expect(checkGuess('icecream', 'ice cream')).toBe('correct');
    expect(checkGuess('  Hot-Dog!  ', 'hot dog')).toBe('correct');
    expect(checkGuess('cafe', 'café')).toBe('correct');
  });

  it('reports a one-edit miss as close', () => {
    expect(checkGuess('elephent', 'elephant')).toBe('close');
    expect(checkGuess('penguine', 'penguin')).toBe('close');
    expect(checkGuess('gitar', 'guitar')).toBe('close');
  });

  it('reports a two-edit miss as wrong', () => {
    expect(checkGuess('elefent', 'elephant')).toBe('wrong');
  });

  it('never reports close for short words, which would leak too much', () => {
    // "bat", "car", "cap", "cot" are all one edit from "cat".
    expect(checkGuess('bat', 'cat')).toBe('wrong');
    expect(checkGuess('cot', 'cat')).toBe('wrong');
    expect(checkGuess('cap', 'cat')).toBe('wrong');
  });

  it('treats blank or symbol-only guesses as wrong', () => {
    expect(checkGuess('', 'bear')).toBe('wrong');
    expect(checkGuess('!!!', 'bear')).toBe('wrong');
  });

  it('does not treat an unrelated word as close', () => {
    expect(checkGuess('helicopter', 'elephant')).toBe('wrong');
  });
});

describe('maskWord', () => {
  it('masks every letter when nothing is revealed', () => {
    expect(maskWord('bear')).toBe('_ _ _ _');
  });

  it('reveals the requested indices', () => {
    expect(maskWord('bear', new Set([2]))).toBe('_ _ a _');
    expect(maskWord('bear', new Set([0, 3]))).toBe('b _ _ r');
  });

  it('always shows spaces and hyphens so word structure is visible', () => {
    expect(maskWord('hot dog')).toBe('_ _ _   _ _ _');
    expect(maskWord('yo-yo')).toBe('_ _ - _ _');
  });

  it('reveals structural characters without counting them as hints', () => {
    expect(maskWord('ice cream', new Set([0]))).toBe('i _ _   _ _ _ _ _');
  });
});

describe('pickHintIndices', () => {
  it('never reveals more than half the letters', () => {
    // "bear" has 4 letters, so at most 2 even when 5 hints are requested.
    expect(pickHintIndices('bear', 5).length).toBe(2);
    expect(pickHintIndices('cat', 5).length).toBe(1);
  });

  it('honours a smaller requested count', () => {
    expect(pickHintIndices('elephant', 2).length).toBe(2);
  });

  it('returns nothing when no hints are requested', () => {
    expect(pickHintIndices('elephant', 0)).toEqual([]);
  });

  it('never points at a space or hyphen', () => {
    const word = 'hot air balloon';
    for (const i of pickHintIndices(word, 5)) {
      expect(word[i]).not.toBe(' ');
    }
  });

  it('returns distinct in-range indices', () => {
    const word = 'helicopter';
    const idx = pickHintIndices(word, 4);
    expect(new Set(idx).size).toBe(idx.length);
    for (const i of idx) {
      expect(i).toBeGreaterThanOrEqual(0);
      expect(i).toBeLessThan(word.length);
    }
  });

  it('is deterministic given a deterministic rng', () => {
    const rng = () => 0.5;
    expect(pickHintIndices('helicopter', 3, rng)).toEqual(pickHintIndices('helicopter', 3, rng));
  });
});
