/**
 * The TRUTH LAYER: independent all-in equity between two concrete hands given
 * the current board. This is what we compare a bot's *perceived* equity against
 * to spot misreads.
 *
 * Strategy:
 *  - 0 cards to come (river): exact, one comparison.
 *  - 1–2 cards to come (turn / flop): exhaustive enumeration — still cheap
 *    (≤ ~1,000 combos) and EXACT, so postflop equity needs no sampling.
 *  - 5 cards to come (preflop): Monte Carlo with a configurable iteration count.
 */

import { compare } from "./evaluator.js";
import { freshDeck, type Card } from "./cards.js";
import { createRng } from "./rng.js";

export interface EquityResult {
  /** Equity for seat 0 and seat 1 (each in 0..1; win + half of ties). */
  equity: [number, number];
  win: [number, number];
  tie: number;
  /** Number of board run-outs evaluated. */
  samples: number;
  /** True if the result is exact (enumeration), false if Monte Carlo. */
  exact: boolean;
}

export interface EquityOptions {
  /** Monte Carlo iterations when sampling is required (preflop). Default 2000. */
  iterations?: number;
  /** Seed for reproducible Monte Carlo. */
  seed?: string;
}

function remainingDeck(known: Card[]): Card[] {
  const used = new Set(known);
  return freshDeck().filter((c) => !used.has(c));
}

function tally(
  hole0: Card[],
  hole1: Card[],
  board: Card[],
): -1 | 0 | 1 {
  return compare([...hole0, ...board], [...hole1, ...board]);
}

/** All k-combinations of an array (k is 1 or 2 in practice here). */
function* combinations<T>(arr: T[], k: number): Generator<T[]> {
  const n = arr.length;
  if (k === 1) {
    for (let i = 0; i < n; i++) yield [arr[i]!];
    return;
  }
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) yield [arr[i]!, arr[j]!];
  }
}

export function computeEquity(
  hole0: Card[],
  hole1: Card[],
  board: Card[] = [],
  options: EquityOptions = {},
): EquityResult {
  const known = [...hole0, ...hole1, ...board];
  const deck = remainingDeck(known);
  const toCome = 5 - board.length;

  const win: [number, number] = [0, 0];
  let tie = 0;
  let samples = 0;
  const record = (r: -1 | 0 | 1) => {
    if (r === 1) win[0]++;
    else if (r === -1) win[1]++;
    else tie++;
    samples++;
  };

  let exact: boolean;
  if (toCome <= 0) {
    record(tally(hole0, hole1, board));
    exact = true;
  } else if (toCome <= 2) {
    // Exhaustive enumeration of the remaining board cards.
    for (const combo of combinations(deck, toCome)) {
      record(tally(hole0, hole1, [...board, ...combo]));
    }
    exact = true;
  } else {
    // Preflop (5 to come): Monte Carlo sample.
    const iterations = options.iterations ?? 2000;
    const rng = createRng(options.seed ?? `${known.join("")}#mc`);
    for (let i = 0; i < iterations; i++) {
      // Partial Fisher-Yates to draw `toCome` distinct cards from the deck.
      const pool = deck.slice();
      const drawn: Card[] = [];
      for (let d = 0; d < toCome; d++) {
        const idx = d + rng.int(pool.length - d);
        const tmp = pool[d]!;
        pool[d] = pool[idx]!;
        pool[idx] = tmp;
        drawn.push(pool[d]!);
      }
      record(tally(hole0, hole1, [...board, ...drawn]));
    }
    exact = false;
  }

  return {
    equity: [
      (win[0] + tie / 2) / samples,
      (win[1] + tie / 2) / samples,
    ],
    win,
    tie,
    samples,
    exact,
  };
}
