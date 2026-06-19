/**
 * Bot contract. A bot sees a DecisionView (what a player legitimately knows at
 * the table — its own cards, the board, stacks, position, the betting so far,
 * and the legal actions) and returns a Decision.
 *
 * decide() is async-capable so the same interface serves both instant heuristic
 * bots and the API-backed reasoning agents added in a later phase.
 */

import type { Card } from "../engine/cards.js";
import type { Action, Position as TablePosition, Seat, Street } from "../engine/state.js";
import type { ActionInput, LegalActions } from "../engine/actions.js";

/** Legacy binary position (heads-up). Kept for the HU reasoning prompts. */
export type Position = "button" | "bigBlind";

/** 6-max table position label (BTN/SB/BB/UTG/HJ/CO). Re-export of engine type. */
export type { TablePosition };

/** Public, legitimately-known info about one opponent at the table. */
export interface OpponentView {
  seat: Seat;
  position: TablePosition;
  stack: number;
  committedThisStreet: number;
  committedTotal: number;
  folded: boolean;
  allIn: boolean;
}

export interface DecisionView {
  handId: number;
  seat: Seat;
  street: Street;
  position: Position;
  holeCards: Card[];
  board: Card[];
  /** Total chips in the pot right now. */
  pot: number;
  /** Chips required to call (0 if the player can check). */
  toCall: number;
  myStack: number;
  oppStack: number;
  myCommittedThisStreet: number;
  oppCommittedThisStreet: number;
  bigBlind: number;
  legal: LegalActions;
  actionHistory: Action[];

  // --- Multiway view (populated by the ring runner; absent ⇒ treat as heads-up).
  /** The hero's real table position. */
  tablePosition?: TablePosition;
  /** Every OTHER seat's public state, in seat order. */
  opponents?: OpponentView[];
  /** Total seats dealt this hand (2..6). */
  numPlayers?: number;
  /** Seats still in the hand (not folded), hero included. */
  activePlayers?: number;
}

export interface Decision {
  action: ActionInput;
  /** 0..1 self-rated confidence (optional; reasoning agents always set it). */
  confidence?: number;
  /** Short natural-language rationale shown in the UI (optional for heuristics). */
  reasoning?: string;
  /** The bot's own estimate of its equity, 0..1 (compared to true equity). */
  perceivedEquity?: number;
}

export interface Bot {
  name: string;
  /** Style label for the UI, e.g. "TAG", "LAG", "nit", "maniac". */
  style?: string;
  decide(view: DecisionView): Decision | Promise<Decision>;
}
