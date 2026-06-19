/**
 * Serializable game-state types for No-Limit Hold'em (2–6 players).
 *
 * Everything here is plain JSON-friendly data: a GameState can be persisted to
 * SQLite and replayed exactly. The engine treats GameState as immutable —
 * applyAction() returns a new state rather than mutating in place.
 *
 * Seat/position rules implemented in the engine:
 *  - Heads-up (N=2): the BUTTON posts the small blind and acts FIRST preflop;
 *    the big blind acts first postflop. (Button == SB.)
 *  - Ring (N≥3): SB = left of button, BB = next; preflop action starts UTG
 *    (left of BB); postflop action starts at the first live seat left of button.
 *  - Antes (optional, all players) are posted before the blinds.
 */

import type { Card } from "./cards.js";

/** A seat index, 0..N-1, where N = players.length (2..6). */
export type Seat = number;

/**
 * A fixed-min, variable-length tuple: at least two entries, possibly more (up to
 * the player count). Indexing `[0]`/`[1]` stays exact (non-undefined under
 * noUncheckedIndexedAccess); higher indices are `T | undefined`.
 */
export type AtLeastTwo<T> = [T, T, ...T[]];

export type Street = "preflop" | "flop" | "turn" | "river" | "showdown" | "complete";

/** Table positions. For HU the button is the SB, so only SB/BB are used. */
export type Position = "BTN" | "SB" | "BB" | "UTG" | "HJ" | "CO";

export type ActionType =
  | "post-ante"
  | "post-sb"
  | "post-bb"
  | "fold"
  | "check"
  | "call"
  | "bet"
  | "raise";

export interface Action {
  /** Seat that took the action. */
  seat: Seat;
  type: ActionType;
  /**
   * Chips ADDED to the pot by this action (the delta from the player's stack),
   * not the cumulative bet. For fold/check this is 0. For call it is the amount
   * needed to match (capped by stack). For bet/raise it is the total chips put
   * in by this action (call portion + raise portion). For post-ante/sb/bb it is
   * the posted amount (capped by stack).
   */
  amount: number;
  /** The street this action occurred on. */
  street: Street;
  /** True if this action put the player all-in. */
  allIn?: boolean;
}

export interface PlayerState {
  seat: Seat;
  name: string;
  /** Chips behind (not yet committed). */
  stack: number;
  /** Chips committed on the CURRENT street (resets each street). Excludes antes. */
  committedThisStreet: number;
  /** Total chips committed across all streets this hand (antes included). */
  committedTotal: number;
  /** Hole cards. Empty until dealt. */
  holeCards: Card[];
  folded: boolean;
  allIn: boolean;
  /**
   * Whether this player has acted since the last bet/raise on the current
   * street. Posting blinds/antes does NOT count as acting (preserves the BB's
   * preflop option). Reset to false for every other live player when a new
   * bet/raise reopens the action.
   */
  actedThisStreet: boolean;
}

/**
 * One contested pot at showdown (main pot, then side_1, side_2, …). `eligible`
 * are the non-folded seats that can win it; `winners` is the subset that did.
 */
export interface PotResult {
  /** Chips in this pot (dead chips from folded contributors included). */
  amount: number;
  /** Non-folded seats eligible to win this pot. */
  eligible: Seat[];
  /** Seats that won (split) this pot. */
  winners: Seat[];
}

export interface HandResult {
  /** All seats that won chips this hand (sorted, ascending by seat). */
  winners: Seat[];
  /** Chips awarded to each seat (indexed by seat). Includes returned uncalled bets. */
  awarded: AtLeastTwo<number>;
  /** Net chip change for each seat this hand (awarded − committedTotal). */
  net: AtLeastTwo<number>;
  /** True if the hand was decided by comparing cards (vs. everyone folding). */
  showdown: boolean;
  /** Per-seat hand description at showdown; null for folded seats. */
  handDescr?: (string | null)[];
  /** Pot-by-pot breakdown (main + side pots) for the front-end / audits. */
  pots?: PotResult[];
}

export interface GameState {
  handId: number;
  seed: string;

  /** Seat on the button. (HU: also the small blind.) */
  button: Seat;
  smallBlind: number;
  bigBlind: number;
  /** Ante posted by every player at the start of the hand (0 = no ante). */
  ante: number;

  players: AtLeastTwo<PlayerState>;
  /** Position label per seat (indexed by seat), e.g. positions[seat] === "BTN". */
  positions: Position[];
  board: Card[];
  /** Undealt cards remaining in the shuffled deck (front = next to deal). */
  deck: Card[];

  street: Street;
  /** Seat to act, or null if the hand needs no further player action. */
  toAct: Seat | null;

  /** Highest committedThisStreet that must be matched to stay in. */
  currentBet: number;
  /**
   * Size of the last full raise increment on this street. Used for min-raise
   * sizing and to decide whether a short all-in reopens the betting.
   */
  lastRaiseSize: number;
  /**
   * False after a player goes all-in for LESS than a full raise: players who
   * already acted may then only call or fold, not re-raise.
   */
  bettingReopened: boolean;

  actionHistory: Action[];
  result: HandResult | null;
}

/** Total chips currently in the pot (everything committed so far this hand). */
export function pot(state: GameState): number {
  let total = 0;
  for (const p of state.players) total += p.committedTotal;
  return total;
}

/** Number of seats at the table. */
export function numPlayers(state: GameState): number {
  return state.players.length;
}

/**
 * The opponent of a given seat — heads-up only. Retained for the existing
 * HU-specific callers (viewer/match). Meaningless for N>2.
 */
export function opponent(seat: Seat): Seat {
  return seat === 0 ? 1 : 0;
}

/** Seats in clockwise action order starting AT `start` (inclusive). */
export function seatOrderFrom(playerCount: number, start: Seat): Seat[] {
  const order: Seat[] = [];
  for (let i = 0; i < playerCount; i++) order.push((start + i) % playerCount);
  return order;
}

/**
 * Compute the position label for every seat given the table size and button.
 * HU: button → "SB", other → "BB". Ring (N≥3): BTN/SB/BB plus UTG…CO filling
 * the seats from left-of-BB up to the button.
 */
export function computePositions(playerCount: number, button: Seat): Position[] {
  const positions: Position[] = new Array(playerCount).fill("UTG");

  if (playerCount === 2) {
    positions[button] = "SB"; // HU: the button is the small blind
    positions[(button + 1) % 2] = "BB";
    return positions;
  }

  const sb = (button + 1) % playerCount;
  const bb = (button + 2) % playerCount;
  positions[button] = "BTN";
  positions[sb] = "SB";
  positions[bb] = "BB";

  // Labels for the seats between the BB and the button (early → late).
  const MIDDLE: Record<number, Position[]> = {
    3: [],
    4: ["UTG"],
    5: ["UTG", "CO"],
    6: ["UTG", "HJ", "CO"],
  };
  const mids = MIDDLE[playerCount] ?? [];
  let idx = 0;
  for (let i = 1; i < playerCount; i++) {
    const s = (bb + i) % playerCount;
    if (s === button) break;
    positions[s] = mids[idx++] ?? "UTG";
  }
  return positions;
}

/** Deep clone of a GameState (structuredClone keeps it JSON-faithful). */
export function cloneState(state: GameState): GameState {
  return structuredClone(state);
}
