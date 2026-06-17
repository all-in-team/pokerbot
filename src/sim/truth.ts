/**
 * Truth layer: for each decision in a hand, compute the deciding bot's TRUE
 * all-in equity (both hole cards known, board as it stood at that moment) and
 * pair it with the bot's PERCEIVED equity. The gap is where a bot is misreading
 * the spot — exactly the signal the viewer surfaces and the coach learns from.
 */

import { computeEquity, type EquityOptions } from "../engine/equity.js";
import type { Card } from "../engine/cards.js";
import type { Seat, Street } from "../engine/state.js";
import type { HandLog } from "./match.js";

export function boardAtStreet(fullBoard: Card[], street: Street): Card[] {
  switch (street) {
    case "preflop":
      return [];
    case "flop":
      return fullBoard.slice(0, 3);
    case "turn":
      return fullBoard.slice(0, 4);
    default:
      return fullBoard.slice(0, 5);
  }
}

export interface TruthPoint {
  decisionIndex: number;
  seat: Seat;
  street: Street;
  /** Deciding seat's true equity at the moment of the decision (0..1). */
  trueEquity: number;
  perceivedEquity?: number;
  /** perceived − true; positive = overconfident, negative = underconfident. */
  misreadDelta?: number;
  exact: boolean;
}

export function annotateHandTruth(log: HandLog, options: EquityOptions = {}): TruthPoint[] {
  const holes = log.holeCards as [Card[], Card[]];
  const points: TruthPoint[] = [];

  for (const d of log.decisions) {
    const board = boardAtStreet(log.state.board, d.street);
    const me = holes[d.seat];
    const opp = holes[d.seat === 0 ? 1 : 0];
    const eq = computeEquity(me, opp, board, options);
    const trueEquity = eq.equity[0];
    const perceived = d.perceivedEquity;
    points.push({
      decisionIndex: d.index,
      seat: d.seat,
      street: d.street,
      trueEquity,
      perceivedEquity: perceived,
      misreadDelta: perceived === undefined ? undefined : perceived - trueEquity,
      exact: eq.exact,
    });
  }
  return points;
}
