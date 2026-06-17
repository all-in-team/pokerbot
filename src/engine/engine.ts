/**
 * Heads-up No-Limit Hold'em engine.
 *
 * Pure, deterministic, and immutable: createHand() builds a GameState from a
 * seed; applyAction() validates and applies one action, returning a NEW state
 * with the betting round / street / showdown advanced as far as the rules
 * require. Given the same seed and action sequence, you get identical states —
 * which is what makes every hand replayable.
 *
 * Heads-up rules enforced here:
 *  - The button posts the small blind and acts FIRST preflop.
 *  - The big blind acts first on the flop, turn, and river.
 *  - Min-raise = the last full raise increment; a short all-in does not reopen
 *    betting (opponent may then only call or fold).
 *  - Uncalled bets are returned; split pots award the odd chip to the big blind.
 */

import type { Card } from "./cards.js";
import { shuffledDeck } from "./cards.js";
import { createRng } from "./rng.js";
import { compare, evaluate } from "./evaluator.js";
import { getLegalActions, type ActionInput } from "./actions.js";
import {
  cloneState,
  opponent,
  pot,
  type Action,
  type GameState,
  type HandResult,
  type PlayerState,
  type Seat,
  type Street,
} from "./state.js";

export interface HandConfig {
  handId: number;
  seed: string;
  /** Seat on the button (small blind / first to act preflop). */
  button: Seat;
  smallBlind: number;
  bigBlind: number;
  players: [
    { name: string; stack: number },
    { name: string; stack: number },
  ];
  /**
   * Optional explicit deck order, bypassing the shuffle. Layout:
   *   [0,1] small-blind hole, [2,3] big-blind hole, [4,5,6] flop,
   *   [7] turn, [8] river, rest unused. Used for scripted scenarios and for
   *   exact replay from a stored deck.
   */
  fixedDeck?: Card[];
}

function makePlayer(seat: Seat, name: string, stack: number): PlayerState {
  return {
    seat,
    name,
    stack,
    committedThisStreet: 0,
    committedTotal: 0,
    holeCards: [],
    folded: false,
    allIn: false,
    actedThisStreet: false,
  };
}

/** Move `amount` chips from a player's stack into the pot. Marks all-in. */
function commit(p: PlayerState, amount: number): void {
  const moved = Math.min(amount, p.stack);
  p.stack -= moved;
  p.committedThisStreet += moved;
  p.committedTotal += moved;
  if (p.stack === 0) p.allIn = true;
}

/**
 * Deal a new hand. Shuffles a deck deterministically from the seed+handId,
 * posts blinds, deals hole cards, and sets the first player to act.
 */
export function createHand(config: HandConfig): GameState {
  const { handId, seed, button, smallBlind, bigBlind } = config;
  const rng = createRng(`${seed}#${handId}`);
  const deck = config.fixedDeck ? config.fixedDeck.slice() : shuffledDeck(rng);

  const players: [PlayerState, PlayerState] = [
    makePlayer(0, config.players[0].name, config.players[0].stack),
    makePlayer(1, config.players[1].name, config.players[1].stack),
  ];

  // Deal two hole cards to each, button first (cosmetic — the shuffle is random).
  const sb = button;
  const bb = opponent(button);
  players[sb].holeCards = [deck.shift()!, deck.shift()!];
  players[bb].holeCards = [deck.shift()!, deck.shift()!];

  const state: GameState = {
    handId,
    seed,
    button,
    smallBlind,
    bigBlind,
    players,
    board: [],
    deck,
    street: "preflop",
    toAct: null,
    currentBet: 0,
    lastRaiseSize: bigBlind,
    bettingReopened: true,
    actionHistory: [],
    result: null,
  };

  // Post blinds. These are forced and do NOT count as "acting" (the big blind
  // keeps its preflop option to raise after a limp).
  commit(players[sb], smallBlind);
  pushAction(state, { seat: sb, type: "post-sb", amount: players[sb].committedThisStreet, street: "preflop", allIn: players[sb].allIn });
  commit(players[bb], bigBlind);
  pushAction(state, { seat: bb, type: "post-bb", amount: players[bb].committedThisStreet, street: "preflop", allIn: players[bb].allIn });

  state.currentBet = Math.max(players[sb].committedThisStreet, players[bb].committedThisStreet);
  // The big blind defines the opening raise increment.
  state.lastRaiseSize = bigBlind;

  // Button acts first preflop — unless a blind put someone all-in, in which
  // case we may need to advance immediately.
  setFirstToAct(state, sb);
  return state;
}

function pushAction(state: GameState, action: Action): void {
  // Record the actual chips that ended up committed for blind posts.
  state.actionHistory.push(action);
}

function seatNeedsAction(state: GameState, seat: Seat): boolean {
  const p = state.players[seat];
  if (p.folded || p.allIn) return false;
  return !p.actedThisStreet || p.committedThisStreet < state.currentBet;
}

/** Decide who acts first on a street (or run out the hand if nobody can act). */
function setFirstToAct(state: GameState, preferred: Seat): void {
  if (seatNeedsAction(state, preferred)) {
    state.toAct = preferred;
  } else if (seatNeedsAction(state, opponent(preferred))) {
    state.toAct = opponent(preferred);
  } else {
    closeStreetAndAdvance(state);
  }
}

/**
 * Apply one action to the state and advance the game. Returns a new GameState;
 * the input is not mutated. Throws if the action is illegal.
 */
export function applyAction(state: GameState, input: ActionInput): GameState {
  if (state.toAct === null || state.street === "complete" || state.street === "showdown") {
    throw new Error(`applyAction: hand is not awaiting an action (street=${state.street})`);
  }
  const next = cloneState(state);
  const seat = next.toAct!;
  const p = next.players[seat];
  const legal = getLegalActions(next);

  switch (input.type) {
    case "fold": {
      if (!legal.canFold) throw illegal("fold", state);
      p.folded = true;
      pushAction(next, { seat, type: "fold", amount: 0, street: next.street });
      resolveFold(next, opponent(seat));
      return next;
    }
    case "check": {
      if (!legal.canCheck) throw illegal("check", state);
      p.actedThisStreet = true;
      pushAction(next, { seat, type: "check", amount: 0, street: next.street });
      break;
    }
    case "call": {
      if (!legal.canCall) throw illegal("call", state);
      const added = legal.callAmount;
      commit(p, added);
      p.actedThisStreet = true;
      pushAction(next, { seat, type: "call", amount: added, street: next.street, allIn: p.allIn });
      break;
    }
    case "bet":
    case "raise": {
      const isBet = input.type === "bet";
      if (isBet ? !legal.canBet : !legal.canRaise) throw illegal(input.type, state);
      const to = input.to;
      const allInTo = legal.maxTo;
      // Legal "to" is either a full raise within [minTo, maxTo], or an exact
      // short all-in shove (minTo === maxTo handled by the same bound).
      if (to < legal.minTo || to > legal.maxTo) {
        throw new Error(
          `applyAction: illegal ${input.type} to ${to}; legal range is [${legal.minTo}, ${legal.maxTo}]`,
        );
      }
      const prevBet = next.currentBet;
      const added = to - p.committedThisStreet;
      commit(p, added);
      const increment = to - prevBet;
      const fullRaise = increment >= next.lastRaiseSize || prevBet === 0 && to >= next.bigBlind;
      // Opponent must respond to the new bet; mark unacted.
      next.players[opponent(seat)].actedThisStreet = false;
      if (fullRaise) {
        next.lastRaiseSize = increment;
        next.bettingReopened = true;
      } else {
        // Short all-in: betting is not reopened — opponent can only call/fold.
        next.bettingReopened = false;
      }
      next.currentBet = to;
      p.actedThisStreet = true;
      pushAction(next, { seat, type: input.type, amount: added, street: next.street, allIn: p.allIn });
      break;
    }
  }

  advanceAfterAction(next, seat);
  return next;
}

function illegal(type: string, state: GameState): Error {
  return new Error(`applyAction: ${type} is not legal for seat ${state.toAct} on ${state.street}`);
}

/** After a (non-folding) action, decide the next actor or close the street. */
function advanceAfterAction(state: GameState, lastActor: Seat): void {
  const other = opponent(lastActor);
  if (seatNeedsAction(state, other)) {
    state.toAct = other;
  } else if (seatNeedsAction(state, lastActor)) {
    state.toAct = lastActor;
  } else {
    closeStreetAndAdvance(state);
  }
}

const STREET_ORDER: Street[] = ["preflop", "flop", "turn", "river", "showdown"];

function nextStreet(street: Street): Street {
  const i = STREET_ORDER.indexOf(street);
  return STREET_ORDER[i + 1]!;
}

/** Number of community cards present at the START of each street. */
const BOARD_AT_STREET: Record<string, number> = {
  preflop: 0,
  flop: 3,
  turn: 4,
  river: 5,
};

function dealBoardTo(state: GameState, count: number): void {
  while (state.board.length < count) {
    state.board.push(state.deck.shift() as Card);
  }
}

/**
 * Betting on the current street is complete. Sweep the street, then either run
 * the hand out to showdown (if all-in) or open the next street.
 */
function closeStreetAndAdvance(state: GameState): void {
  // Sweep current-street commitments into the pot (committedTotal already
  // tracks them); reset per-street counters.
  for (const p of state.players) {
    p.committedThisStreet = 0;
    p.actedThisStreet = false;
  }
  state.currentBet = 0;
  state.lastRaiseSize = state.bigBlind;
  state.bettingReopened = true;

  // If either player is all-in, no further betting is possible — run out the
  // remaining board and go to showdown.
  const someoneAllIn = state.players[0].allIn || state.players[1].allIn;
  if (someoneAllIn && state.street !== "river") {
    dealBoardTo(state, 5);
    state.street = "showdown";
    resolveShowdown(state);
    return;
  }

  if (state.street === "river") {
    state.street = "showdown";
    resolveShowdown(state);
    return;
  }

  const upcoming = nextStreet(state.street);
  state.street = upcoming;
  dealBoardTo(state, BOARD_AT_STREET[upcoming]!);

  if (upcoming === "showdown") {
    resolveShowdown(state);
    return;
  }

  // Postflop, the big blind (out of position) acts first.
  setFirstToAct(state, opponent(state.button));
}

/** Resolve a hand that ended because a player folded. */
function resolveFold(state: GameState, winner: Seat): void {
  const total = pot(state);
  const awarded: [number, number] = [0, 0];
  awarded[winner] = total;
  state.players[winner].stack += total;

  finalizeResult(state, {
    winners: [winner],
    awarded,
    net: [awarded[0] - state.players[0].committedTotal, awarded[1] - state.players[1].committedTotal],
    showdown: false,
    handDescr: [null, null],
  });
}

/** Resolve a showdown: refund uncalled chips, then award (or split) the pot. */
function resolveShowdown(state: GameState): void {
  const [p0, p1] = state.players;
  const awarded: [number, number] = [0, 0];

  // Return any uncalled portion of the larger contribution.
  const minCommit = Math.min(p0.committedTotal, p1.committedTotal);
  if (p0.committedTotal > minCommit) {
    const refund = p0.committedTotal - minCommit;
    p0.stack += refund;
    awarded[0] += refund;
  } else if (p1.committedTotal > minCommit) {
    const refund = p1.committedTotal - minCommit;
    p1.stack += refund;
    awarded[1] += refund;
  }

  const contested = minCommit * 2;
  const board = state.board;
  const hand0 = [...p0.holeCards, ...board];
  const hand1 = [...p1.holeCards, ...board];

  // A folded player cannot win a showdown (covers the all-in-after-fold edge).
  let cmp = 0;
  if (p0.folded) cmp = -1;
  else if (p1.folded) cmp = 1;
  else cmp = compare(hand0, hand1);

  let winners: Seat[];
  if (cmp > 0) {
    p0.stack += contested;
    awarded[0] += contested;
    winners = [0];
  } else if (cmp < 0) {
    p1.stack += contested;
    awarded[1] += contested;
    winners = [1];
  } else {
    // Split pot. Odd chip to the big blind (out of position).
    const half = Math.floor(contested / 2);
    const odd = contested - half * 2;
    const bb = opponent(state.button);
    const sb = state.button;
    state.players[sb].stack += half;
    awarded[sb] += half;
    state.players[bb].stack += half + odd;
    awarded[bb] += half + odd;
    winners = [0, 1];
  }

  finalizeResult(state, {
    winners,
    awarded,
    net: [awarded[0] - p0.committedTotal, awarded[1] - p1.committedTotal],
    showdown: true,
    handDescr: [
      p0.folded ? null : evaluate(hand0).descr,
      p1.folded ? null : evaluate(hand1).descr,
    ],
  });
}

function finalizeResult(state: GameState, result: HandResult): void {
  state.result = result;
  state.street = "complete";
  state.toAct = null;
}

/** Convenience: is the hand finished? */
export function isComplete(state: GameState): boolean {
  return state.street === "complete";
}

export { getLegalActions };
export type { ActionInput };
