/**
 * Guess handling.
 *
 * All of this runs on the *server*. The client never learns the word (unless
 * it is the drawer), so it cannot be trusted to decide whether a guess is
 * correct, and it must not be given the raw material to check locally.
 */

/**
 * Reduce a word or guess to a canonical form for comparison.
 *
 * - Unicode-normalizes and strips combining marks, so "café" == "cafe".
 * - Lowercases.
 * - Removes punctuation, symbols, separators and whitespace, so
 *   "ice-cream", "ice cream" and "icecream" all collapse to "icecream".
 *
 * Letters and digits from any script survive, which keeps non-English custom
 * word lists usable.
 */
export function normalizeGuess(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[\p{P}\p{S}\p{Z}\s_]+/gu, '')
    .normalize('NFC');
}

/**
 * Levenshtein edit distance between two strings.
 *
 * Two-row dynamic programming: O(n*m) time, O(min(n,m)) space. `max` short
 * circuits once every cell in a row exceeds the bound, which is what makes the
 * "off by one letter" check cheap.
 */
export function levenshtein(a: string, b: string, max = Infinity): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  // Keep the shorter string on the inner axis to minimise allocation.
  if (a.length > b.length) [a, b] = [b, a];
  if (b.length - a.length > max) return max + 1;

  const n = a.length;
  let prev = new Array<number>(n + 1);
  let curr = new Array<number>(n + 1);

  for (let i = 0; i <= n; i++) prev[i] = i;

  for (let j = 1; j <= b.length; j++) {
    curr[0] = j;
    let rowMin = curr[0]!;
    const bj = b.charCodeAt(j - 1);

    for (let i = 1; i <= n; i++) {
      const cost = a.charCodeAt(i - 1) === bj ? 0 : 1;
      const v = Math.min(
        curr[i - 1]! + 1, // insertion
        prev[i]! + 1, // deletion
        prev[i - 1]! + cost, // substitution
      );
      curr[i] = v;
      if (v < rowMin) rowMin = v;
    }

    if (rowMin > max) return max + 1;
    [prev, curr] = [curr, prev];
  }

  return prev[n]!;
}

export type GuessResult =
  /** Exact match after normalization. */
  | 'correct'
  /** One edit away — worth a private nudge, but not a point. */
  | 'close'
  /** Nowhere near. Goes to chat as an ordinary message. */
  | 'wrong';

/**
 * Classify a guess against the secret word.
 *
 * The "close" tier is deliberately conservative: a single edit only, and only
 * for words long enough that one edit isn't most of the word. Without that
 * length guard, guessing "cat" would report "close" for "bat", "car", "cap",
 * "hat", "cot" and so on, which leaks far too much.
 */
export function checkGuess(guess: string, word: string): GuessResult {
  const g = normalizeGuess(guess);
  const w = normalizeGuess(word);
  if (!g || !w) return 'wrong';
  if (g === w) return 'correct';
  if (w.length < 4) return 'wrong';
  return levenshtein(g, w, 1) === 1 ? 'close' : 'wrong';
}

/**
 * Characters that are always visible in the masked pattern because they carry
 * structure rather than information.
 */
function isStructural(ch: string): boolean {
  return /[\s\-'’.]/.test(ch);
}

/**
 * Build the masked pattern guessers see, e.g. "_ _ a _" for "bear" with index
 * 2 revealed. `revealed` holds indices into the original word.
 */
export function maskWord(word: string, revealed: ReadonlySet<number> = new Set()): string {
  return Array.from(word)
    .map((ch, i) => (isStructural(ch) ? ch : revealed.has(i) ? ch : '_'))
    .join(' ');
}

/**
 * Pick which letter indices to reveal, and in what order.
 *
 * Never reveals so much that the word becomes trivially readable: at most
 * `count` letters, and never more than half of them.
 */
export function pickHintIndices(word: string, count: number, rand: () => number = Math.random): number[] {
  const candidates: number[] = [];
  for (let i = 0; i < word.length; i++) {
    if (!isStructural(word[i]!)) candidates.push(i);
  }
  const limit = Math.max(0, Math.min(count, Math.floor(candidates.length / 2)));

  // Fisher-Yates on a copy, then take the first `limit`.
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [candidates[i], candidates[j]] = [candidates[j]!, candidates[i]!];
  }
  return candidates.slice(0, limit);
}
