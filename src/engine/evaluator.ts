/**
 * Hand-evaluation wrapper around pokersolver.
 *
 * pokersolver is the canonical ranking authority for the engine: it ranks
 * 5–7 card hands and resolves ties (kickers) correctly, and yields a
 * human-readable description we surface in the UI ("Full House, A's over K's").
 */

import pokersolver from "pokersolver";
import type { Card } from "./cards.js";

const { Hand } = pokersolver;

export interface HandEval {
  /** Hand class rank: 1 = high card … 9 = straight flush. Higher is better. */
  rank: number;
  /** Short class name, e.g. "Full House". */
  name: string;
  /** Descriptive name, e.g. "Full House, A's over K's". */
  descr: string;
}

/** Evaluate the best 5-card hand out of the given (5–7) cards. */
export function evaluate(cards: Card[]): HandEval {
  if (cards.length < 5) {
    throw new Error(`evaluate() needs at least 5 cards, got ${cards.length}`);
  }
  const h = Hand.solve(cards as unknown as string[]);
  return { rank: h.rank, name: h.name, descr: h.descr };
}

/**
 * French hand-class label, derived straight from the evaluator's class rank
 * (1 high card … 9 straight flush). This is a translation of the engine's own
 * classification — nothing is invented or recomputed.
 */
const CATEGORY_FR: Record<number, string> = {
  1: "Carte haute",
  2: "Paire",
  3: "Deux paires",
  4: "Brelan",
  5: "Quinte",
  6: "Couleur",
  7: "Full",
  8: "Carré",
  9: "Quinte flush",
};

/** French made-hand category for the best 5-card hand out of `cards` (5–7). */
export function handCategoryFr(cards: Card[]): string {
  return CATEGORY_FR[evaluate(cards).rank] ?? "—";
}

export type Comparison = -1 | 0 | 1;

/**
 * Compare two card sets. Returns:
 *   1  if `a` wins,
 *  -1  if `b` wins,
 *   0  if they tie (split pot).
 */
export function compare(a: Card[], b: Card[]): Comparison {
  const ha = Hand.solve(a as unknown as string[]);
  const hb = Hand.solve(b as unknown as string[]);
  const winners = Hand.winners([ha, hb]);
  const aWins = winners.includes(ha);
  const bWins = winners.includes(hb);
  if (aWins && bWins) return 0;
  return aWins ? 1 : -1;
}
