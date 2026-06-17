/**
 * Serializable game-state types for heads-up No-Limit Hold'em.
 *
 * Everything here is plain JSON-friendly data: a GameState can be persisted to
 * SQLite and replayed exactly. The engine treats GameState as immutable —
 * applyAction() returns a new state rather than mutating in place.
 *
 * Heads-up seat/button rules implemented elsewhere in the engine:
 *  - The button posts the SMALL blind and acts FIRST preflop.
 *  - The big blind acts first on every postflop street.
 */

import type { Card } from "./cards.js";

export type Seat = 0 | 1;

export type Street = "preflop" | "flop" | "turn" | "river" | "showdown" | "complete";

export type ActionType =
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
   * in by this action (call portion + raise portion).
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
  /** Chips committed on the CURRENT street (resets each street). */
  committedThisStreet: number;
  /** Total chips committed across all streets this hand. */
  committedTotal: number;
  /** Hole cards. Empty until dealt. */
  holeCards: Card[];
  folded: boolean;
  allIn: boolean;
  /**
   * Whether this player has acted since the last bet/raise on the current
   * street. Posting blinds does NOT count as acting (preserves the BB's
   * preflop option). Reset to false for both players when a new bet/raise
   * reopens the action.
   */
  actedThisStreet: boolean;
}

export interface HandResult {
  /** Seats that won chips (1 element = outright, 2 = split pot). */
  winners: Seat[];
  /** Chips awarded to each seat (indexed by seat). Includes returned uncalled bets. */
  awarded: [number, number];
  /** Net chip change for each seat this hand (final stack − starting stack). */
  net: [number, number];
  /** True if the hand went to showdown (both players' cards compared). */
  showdown: boolean;
  /** Per-seat hand description at showdown (e.g. "Two Pair, A's & K's"). */
  handDescr?: [string | null, string | null];
}

export interface GameState {
  handId: number;
  seed: string;

  /** Seat on the button (= small blind, acts first preflop). */
  button: Seat;
  smallBlind: number;
  bigBlind: number;

  players: [PlayerState, PlayerState];
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
   * False after a player goes all-in for LESS than a full raise: the opponent
   * may then only call or fold, not re-raise.
   */
  bettingReopened: boolean;

  actionHistory: Action[];
  result: HandResult | null;
}

/** Total chips currently in the pot (everything committed so far this hand). */
export function pot(state: GameState): number {
  return state.players[0].committedTotal + state.players[1].committedTotal;
}

/** The opponent of a given seat (heads-up). */
export function opponent(seat: Seat): Seat {
  return (seat === 0 ? 1 : 0) as Seat;
}

/** Deep clone of a GameState (structuredClone keeps it JSON-faithful). */
export function cloneState(state: GameState): GameState {
  return structuredClone(state);
}
