/**
 * No-Limit Hold'em engine for 2–6 players.
 *
 * Pure, deterministic, and immutable: createHand() builds a GameState from a
 * seed; applyAction() validates and applies one action, returning a NEW state
 * with the betting round / street / showdown advanced as far as the rules
 * require. Given the same seed and action sequence, you get identical states —
 * which is what makes every hand replayable.
 *
 * Rules enforced here:
 *  - Heads-up (N=2): button posts the SB and acts first preflop; BB acts first
 *    postflop. Ring (N≥3): SB left of button, BB next; preflop starts UTG
 *    (left of BB); postflop starts at the first live seat left of the button.
 *  - Antes (optional): every player posts the ante before the blinds; antes feed
 *    the pot but do not count toward the current bet.
 *  - Min-raise = the last full raise increment; a short all-in does not reopen
 *    betting (already-acted players may then only call or fold).
 *  - Uncalled bets are returned. Side pots are formed by all-in levels; each pot
 *    is awarded to the best eligible hand(s), odd chips going to the lowest seat
 *    index among the winners (deterministic).
 */

import type { Card } from "./cards.js";
import { shuffledDeck } from "./cards.js";
import { createRng } from "./rng.js";
import { compare, evaluate } from "./evaluator.js";
import { getLegalActions, type ActionInput } from "./actions.js";
import {
  cloneState,
  computePositions,
  pot,
  seatOrderFrom,
  type Action,
  type AtLeastTwo,
  type GameState,
  type HandResult,
  type PlayerState,
  type PotResult,
  type Seat,
  type Street,
} from "./state.js";

export interface HandConfig {
  handId: number;
  seed: string;
  /** Seat on the button. (HU: also the small blind / first to act preflop.) */
  button: Seat;
  smallBlind: number;
  bigBlind: number;
  /** Ante posted by every player (default 0 = no ante). */
  ante?: number;
  /** 2–6 players. */
  players: AtLeastTwo<{ name: string; stack: number }>;
  /**
   * Optional explicit deck order, bypassing the shuffle. Layout: two cards per
   * player dealt in clockwise order starting from the small blind, then the
   * board (flop, turn, river), then filler. For HU (button=0) this is
   * [SB hole(2), BB hole(2), flop(3), turn, river, …] — same as before.
   * Used for scripted scenarios and exact replay from a stored deck.
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

/** Move `amount` chips into the current-street bet (and the pot). Marks all-in. */
function commit(p: PlayerState, amount: number): void {
  const moved = Math.min(amount, p.stack);
  p.stack -= moved;
  p.committedThisStreet += moved;
  p.committedTotal += moved;
  if (p.stack === 0) p.allIn = true;
}

/** Post an ante: feeds the pot but does NOT count toward the current bet. */
function postAnte(p: PlayerState, amount: number): number {
  const moved = Math.min(amount, p.stack);
  p.stack -= moved;
  p.committedTotal += moved;
  if (p.stack === 0) p.allIn = true;
  return moved;
}

/** Blind seats for a table: HU button is the SB; ring SB/BB are left of button. */
function blindSeats(playerCount: number, button: Seat): { sb: Seat; bb: Seat } {
  if (playerCount === 2) return { sb: button, bb: (button + 1) % 2 };
  return { sb: (button + 1) % playerCount, bb: (button + 2) % playerCount };
}

/**
 * Deal a new hand. Shuffles a deck deterministically from the seed+handId, posts
 * antes then blinds, deals hole cards, and sets the first player to act.
 */
export function createHand(config: HandConfig): GameState {
  const { handId, seed, button, smallBlind, bigBlind } = config;
  const ante = config.ante ?? 0;
  const n = config.players.length;
  const rng = createRng(`${seed}#${handId}`);
  const deck = config.fixedDeck ? config.fixedDeck.slice() : shuffledDeck(rng);

  const players = config.players.map((p, i) => makePlayer(i, p.name, p.stack)) as AtLeastTwo<PlayerState>;
  const { sb, bb } = blindSeats(n, button);

  // Deal two hole cards to each player, clockwise from the small blind. Cards
  // are consumed consecutively per player to keep scripted/fixed decks stable.
  for (const seat of seatOrderFrom(n, sb)) {
    players[seat]!.holeCards = [deck.shift()!, deck.shift()!];
  }

  const state: GameState = {
    handId,
    seed,
    button,
    smallBlind,
    bigBlind,
    ante,
    players,
    positions: computePositions(n, button),
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

  // 1) Antes — every player, before the blinds. They feed the pot but are not
  // part of the betting line (committedThisStreet stays 0).
  if (ante > 0) {
    for (const seat of seatOrderFrom(n, sb)) {
      const p = players[seat]!;
      const posted = postAnte(p, ante);
      if (posted > 0) {
        pushAction(state, { seat, type: "post-ante", amount: posted, street: "preflop", allIn: p.allIn });
      }
    }
  }

  // 2) Blinds. Forced, and do NOT count as "acting" (the BB keeps its option).
  commit(players[sb]!, smallBlind);
  pushAction(state, { seat: sb, type: "post-sb", amount: players[sb]!.committedThisStreet, street: "preflop", allIn: players[sb]!.allIn });
  commit(players[bb]!, bigBlind);
  pushAction(state, { seat: bb, type: "post-bb", amount: players[bb]!.committedThisStreet, street: "preflop", allIn: players[bb]!.allIn });

  state.currentBet = Math.max(players[sb]!.committedThisStreet, players[bb]!.committedThisStreet);
  state.lastRaiseSize = bigBlind; // the big blind defines the opening increment

  // Preflop action starts UTG = first live seat left of the BB. (HU: that is the
  // button/SB.) If nobody can act (everyone all-in from antes/blinds), run out.
  const first = firstToActFrom(state, (bb + 1) % n);
  if (first === null) closeStreetAndAdvance(state);
  else state.toAct = first;

  return state;
}

function pushAction(state: GameState, action: Action): void {
  state.actionHistory.push(action);
}

function seatNeedsAction(state: GameState, seat: Seat): boolean {
  const p = state.players[seat]!;
  if (p.folded || p.allIn) return false;
  return !p.actedThisStreet || p.committedThisStreet < state.currentBet;
}

/** Clockwise from `start` (inclusive): first seat that still needs to act. */
function firstToActFrom(state: GameState, start: Seat): Seat | null {
  for (const s of seatOrderFrom(state.players.length, start)) {
    if (seatNeedsAction(state, s)) return s;
  }
  return null;
}

/** Clockwise strictly AFTER `from`: next seat that still needs to act. */
function nextToActAfter(state: GameState, from: Seat): Seat | null {
  const n = state.players.length;
  for (let i = 1; i <= n; i++) {
    const s = (from + i) % n;
    if (seatNeedsAction(state, s)) return s;
  }
  return null;
}

/** Non-folded seats (still contesting the pot, all-in or not). */
function liveSeats(state: GameState): Seat[] {
  return state.players.filter((p) => !p.folded).map((p) => p.seat);
}

/** Count of players who can still voluntarily act (not folded, not all-in). */
function canActCount(state: GameState): number {
  return state.players.filter((p) => !p.folded && !p.allIn).length;
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
  const p = next.players[seat]!;
  const legal = getLegalActions(next);

  switch (input.type) {
    case "fold": {
      if (!legal.canFold) throw illegal("fold", state);
      p.folded = true;
      pushAction(next, { seat, type: "fold", amount: 0, street: next.street });
      // If only one player remains, the hand ends without a showdown.
      if (liveSeats(next).length === 1) {
        resolveUncontested(next, liveSeats(next)[0]!);
        return next;
      }
      advanceAfterAction(next, seat);
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
      if (to < legal.minTo || to > legal.maxTo) {
        throw new Error(
          `applyAction: illegal ${input.type} to ${to}; legal range is [${legal.minTo}, ${legal.maxTo}]`,
        );
      }
      const prevBet = next.currentBet;
      const added = to - p.committedThisStreet;
      commit(p, added);
      const increment = to - prevBet;
      const fullRaise = increment >= next.lastRaiseSize || (prevBet === 0 && to >= next.bigBlind);
      // Everyone else must respond to the new bet; mark them unacted.
      for (const q of next.players) if (q.seat !== seat) q.actedThisStreet = false;
      if (fullRaise) {
        next.lastRaiseSize = increment;
        next.bettingReopened = true;
      } else {
        // Short all-in: betting is not reopened — others can only call/fold.
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

/** After a (non-terminal) action, pick the next actor or close the street. */
function advanceAfterAction(state: GameState, lastActor: Seat): void {
  const next = nextToActAfter(state, lastActor);
  if (next !== null) state.toAct = next;
  else closeStreetAndAdvance(state);
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
 * Betting on the current street is complete. Sweep per-street counters, then
 * either run the hand out to showdown (if no further betting is possible) or
 * open the next street.
 */
function closeStreetAndAdvance(state: GameState): void {
  for (const p of state.players) {
    p.committedThisStreet = 0;
    p.actedThisStreet = false;
  }
  state.currentBet = 0;
  state.lastRaiseSize = state.bigBlind;
  state.bettingReopened = true;

  // Safety: a lone survivor takes the pot (no showdown).
  const live = liveSeats(state);
  if (live.length === 1) {
    resolveUncontested(state, live[0]!);
    return;
  }

  // If at most one player can still act, no more betting is possible: run the
  // remaining board out and go to showdown.
  if (canActCount(state) <= 1 && state.street !== "river") {
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

  // Postflop, action starts at the first live seat left of the button.
  const start = (state.button + 1) % state.players.length;
  const first = firstToActFrom(state, start);
  if (first === null) closeStreetAndAdvance(state); // all-in: deal the next street
  else state.toAct = first;
}

/** Resolve a hand that ended because everyone but one player folded. */
function resolveUncontested(state: GameState, winner: Seat): void {
  const n = state.players.length;
  const total = pot(state);
  const awarded = new Array<number>(n).fill(0);
  awarded[winner] = total;
  state.players[winner]!.stack += total;

  finalizeResult(state, {
    winners: [winner],
    awarded: awarded as AtLeastTwo<number>,
    net: state.players.map((p, i) => awarded[i]! - p.committedTotal) as AtLeastTwo<number>,
    showdown: false,
    handDescr: state.players.map(() => null),
    pots: [{ amount: total, eligible: [winner], winners: [winner] }],
  });
}

/** Best eligible hand(s) at the board — returns all tied winners' seats. */
function bestHands(state: GameState, eligible: Seat[]): Seat[] {
  const board = state.board;
  let best: Seat[] = [eligible[0]!];
  for (let i = 1; i < eligible.length; i++) {
    const s = eligible[i]!;
    const cmp = compare(
      [...state.players[s]!.holeCards, ...board],
      [...state.players[best[0]!]!.holeCards, ...board],
    );
    if (cmp > 0) best = [s];
    else if (cmp === 0) best.push(s);
  }
  return best;
}

function sameSet(a: Seat[], b: Seat[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * Resolve a showdown: refund any uncalled bet, build side pots by all-in level,
 * then award each pot to its best eligible hand(s).
 */
function resolveShowdown(state: GameState): void {
  const n = state.players.length;
  const awarded = new Array<number>(n).fill(0);

  // 1) Return the uncalled portion of the single largest contribution.
  const contrib = state.players.map((p) => p.committedTotal);
  const effective = contrib.slice();
  const sortedDesc = [...contrib].sort((a, b) => b - a);
  const highest = sortedDesc[0] ?? 0;
  const second = sortedDesc[1] ?? 0;
  if (highest > second) {
    const topSeat = contrib.indexOf(highest);
    const refund = highest - second;
    effective[topSeat] = second;
    state.players[topSeat]!.stack += refund;
    awarded[topSeat] = (awarded[topSeat] ?? 0) + refund;
  }

  // 2) Build side pots from distinct all-in levels of the effective contributions.
  const levels = [...new Set(effective.filter((x) => x > 0))].sort((a, b) => a - b);
  const rawPots: { amount: number; eligible: Seat[] }[] = [];
  let prev = 0;
  for (const level of levels) {
    let contributors = 0;
    const eligible: Seat[] = [];
    for (let s = 0; s < n; s++) {
      if (effective[s]! >= level) {
        contributors++;
        if (!state.players[s]!.folded) eligible.push(s);
      }
    }
    rawPots.push({ amount: (level - prev) * contributors, eligible });
    prev = level;
  }

  // Merge consecutive layers that have the identical eligible set (a folded
  // player's dead chips shouldn't create a separate contestable pot).
  const pots: { amount: number; eligible: Seat[] }[] = [];
  for (const layer of rawPots) {
    const last = pots[pots.length - 1];
    if (last && sameSet(last.eligible, layer.eligible)) last.amount += layer.amount;
    else pots.push({ amount: layer.amount, eligible: [...layer.eligible] });
  }

  // 3) Award each pot to the best eligible hand(s); odd chips to lowest seat.
  const potResults: PotResult[] = [];
  const winnersSet = new Set<Seat>();
  for (const p of pots) {
    if (p.amount === 0) {
      potResults.push({ amount: 0, eligible: p.eligible, winners: [] });
      continue;
    }
    // Defensive: a layer whose contributors all folded (dead chips) still pays
    // out to the remaining live players rather than vanishing.
    const eligible = p.eligible.length > 0 ? p.eligible : liveSeats(state);
    const winners = eligible.length === 1 ? [eligible[0]!] : bestHands(state, eligible);
    const ordered = [...winners].sort((a, b) => a - b);
    const base = Math.floor(p.amount / ordered.length);
    let remainder = p.amount - base * ordered.length;
    for (const s of ordered) {
      const give = base + (remainder > 0 ? 1 : 0);
      if (remainder > 0) remainder--;
      awarded[s] = (awarded[s] ?? 0) + give;
      state.players[s]!.stack += give;
      winnersSet.add(s);
    }
    potResults.push({ amount: p.amount, eligible: p.eligible, winners: ordered });
  }

  const board = state.board;
  finalizeResult(state, {
    winners: [...winnersSet].sort((a, b) => a - b),
    awarded: awarded as AtLeastTwo<number>,
    net: state.players.map((p, i) => awarded[i]! - p.committedTotal) as AtLeastTwo<number>,
    showdown: true,
    handDescr: state.players.map((p) => (p.folded ? null : evaluate([...p.holeCards, ...board]).descr)),
    pots: potResults,
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
