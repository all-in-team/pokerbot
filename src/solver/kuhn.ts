/**
 * Kuhn Poker — the canonical game for demonstrating CFR convergence to a Nash
 * equilibrium. A 3-card deck (J=1, Q=2, K=3), one card each, one ante, a single
 * betting round. Tiny enough to compute exact exploitability, rich enough to
 * have non-trivial mixed-strategy equilibria — so CFR's convergence is visible
 * and measurable.
 *
 * Histories use 'p' = pass/check/fold and 'b' = bet/call.
 * Terminal histories: pp, bp, bb, pbp, pbb.
 */

export const ACTIONS = ["p", "b"] as const;
export type Action = (typeof ACTIONS)[number];

/** All 6 ordered deals of 2 distinct cards from {1,2,3}, each with prob 1/6. */
export const DEALS: [number, number][] = (() => {
  const out: [number, number][] = [];
  for (let a = 1; a <= 3; a++) for (let b = 1; b <= 3; b++) if (a !== b) out.push([a, b]);
  return out;
})();

const TERMINALS = new Set(["pp", "bp", "bb", "pbp", "pbb"]);

export function isTerminal(history: string): boolean {
  return TERMINALS.has(history);
}

/** Player to act at this (non-terminal) history. 0 acts on "", "pb"; 1 on "p", "b". */
export function currentPlayer(history: string): 0 | 1 {
  return (history.length % 2) as 0 | 1;
}

export function infoSetKey(card: number, history: string): string {
  return `${card}:${history}`;
}

/** Parse the history out of an info-set key. */
export function historyOfKey(key: string): string {
  return key.slice(key.indexOf(":") + 1);
}

/** Terminal utility from player 0's perspective. */
export function utilityToP0(cards: [number, number], history: string): number {
  const p0Wins = cards[0] > cards[1];
  switch (history) {
    case "pp": // checked down, ante-only showdown
      return p0Wins ? 1 : -1;
    case "bp": // P0 bet, P1 folded
      return 1;
    case "bb": // bet + call showdown
      return p0Wins ? 2 : -2;
    case "pbp": // P0 checked, P1 bet, P0 folded
      return -1;
    case "pbb": // P0 checked, P1 bet, P0 called → showdown
      return p0Wins ? 2 : -2;
    default:
      throw new Error(`utilityToP0: non-terminal history "${history}"`);
  }
}
