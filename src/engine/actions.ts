/**
 * Legal-action generation and the action-input contract.
 *
 * Bots are handed a LegalActions descriptor and return an ActionInput. Bet and
 * raise are expressed as a "to" amount — the TOTAL chips the player will have
 * committed on the current street after the action ("raise to 300") — which is
 * the natural way to size in poker and avoids call-portion ambiguity.
 */

import type { GameState, Seat } from "./state.js";

export type ActionInput =
  | { type: "fold" }
  | { type: "check" }
  | { type: "call" }
  | { type: "bet"; to: number }
  | { type: "raise"; to: number };

export interface LegalActions {
  toAct: Seat;
  /** Chips required to match the current bet (capped at the player's stack). */
  toCall: number;
  canFold: boolean;
  canCheck: boolean;
  canCall: boolean;
  /** Chips added by a call (== min(toCall, stack)). All-in if it equals stack. */
  callAmount: number;
  /** Whether an aggressive action is available, and which kind it is. */
  canBet: boolean;
  canRaise: boolean;
  aggressiveType: "bet" | "raise";
  /** Min/max "to" total for a bet/raise (committedThisStreet after the action). */
  minTo: number;
  maxTo: number;
  /** Chips added for the min bet/raise and for the all-in shove. */
  minRaiseAmount: number;
  maxRaiseAmount: number;
}

export function getLegalActions(state: GameState): LegalActions {
  if (state.toAct === null) {
    throw new Error("getLegalActions: no player is to act");
  }
  const seat = state.toAct;
  const p = state.players[seat];
  const cb = state.currentBet;
  const c = p.committedThisStreet;
  const s = p.stack;

  const toCall = Math.max(0, cb - c);
  const callAmount = Math.min(toCall, s);

  const canCheck = toCall === 0;
  const canCall = toCall > 0 && s > 0;
  const canFold = toCall > 0;

  const aggressiveType: "bet" | "raise" = cb === 0 ? "bet" : "raise";

  // Full (non-all-in) minimum target: a bet must be >= one big blind; a raise
  // must increase the bet by at least the last full raise increment.
  const fullMinTo = cb === 0 ? state.bigBlind : cb + state.lastRaiseSize;
  const maxTo = c + s; // shove everything

  let canAggress = false;
  let minTo = 0;
  if (state.bettingReopened && maxTo > cb && s > 0) {
    // Must be able to put in strictly more than the current bet to aggress.
    canAggress = true;
    minTo = maxTo >= fullMinTo ? fullMinTo : maxTo; // short all-in if can't afford full
  }

  const canBet = canAggress && aggressiveType === "bet";
  const canRaise = canAggress && aggressiveType === "raise";

  return {
    toAct: seat,
    toCall,
    canFold,
    canCheck,
    canCall,
    callAmount,
    canBet,
    canRaise,
    aggressiveType,
    minTo: canAggress ? minTo : 0,
    maxTo: canAggress ? maxTo : 0,
    minRaiseAmount: canAggress ? minTo - c : 0,
    maxRaiseAmount: canAggress ? maxTo - c : 0,
  };
}
