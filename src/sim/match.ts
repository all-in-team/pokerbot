/**
 * Match runner: drives two bots through hands and (later) whole sessions.
 *
 * Builds a DecisionView from the GameState (showing each bot only what a player
 * legitimately knows), asks the bot to decide, normalizes the action to a legal
 * one, and applies it. Captures per-decision metadata (reasoning, confidence,
 * perceived equity) alongside the engine's action history for logging/replay.
 */

import { applyAction, createHand, getLegalActions, type HandConfig } from "../engine/engine.js";
import { pot, type GameState, type Seat, type Street } from "../engine/state.js";
import type { ActionInput } from "../engine/actions.js";
import type { Bot, DecisionView, Position } from "../bots/types.js";

export interface DecisionRecord {
  index: number;
  seat: Seat;
  street: Street;
  action: ActionInput;
  potBefore: number;
  toCall: number;
  reasoning?: string;
  confidence?: number;
  perceivedEquity?: number;
}

export interface HandLog {
  config: HandConfig;
  /** Final, completed game state (board, result, action history all populated). */
  state: GameState;
  /** Per-decision metadata, parallel to the voluntary actions taken. */
  decisions: DecisionRecord[];
  /** Hole cards as dealt, by seat (kept explicitly for replay/logging). */
  holeCards: [string[], string[]];
}

function positionOf(state: GameState, seat: Seat): Position {
  return seat === state.button ? "button" : "bigBlind";
}

function buildView(state: GameState, seat: Seat): DecisionView {
  const me = state.players[seat]!;
  const opp = state.players[seat === 0 ? 1 : 0]!;
  const legal = getLegalActions(state);
  return {
    handId: state.handId,
    seat,
    street: state.street,
    position: positionOf(state, seat),
    holeCards: me.holeCards,
    board: state.board,
    pot: pot(state),
    toCall: legal.toCall,
    myStack: me.stack,
    oppStack: opp.stack,
    myCommittedThisStreet: me.committedThisStreet,
    oppCommittedThisStreet: opp.committedThisStreet,
    bigBlind: state.bigBlind,
    legal,
    actionHistory: state.actionHistory,
  };
}

export interface PlayHandHooks {
  /** Called after each voluntary action is applied (for live streaming). */
  onDecision?: (record: DecisionRecord, state: GameState) => void | Promise<void>;
}

/** Play a single hand to completion. */
export async function playHand(
  config: HandConfig,
  bots: [Bot, Bot],
  hooks: PlayHandHooks = {},
): Promise<HandLog> {
  let state = createHand(config);
  const holeCards: [string[], string[]] = [
    [...state.players[0].holeCards],
    [...state.players[1].holeCards],
  ];
  const decisions: DecisionRecord[] = [];
  let guard = 0;

  while (state.street !== "complete") {
    if (state.toAct === null) throw new Error("match: no actor but hand incomplete");
    const seat = state.toAct;
    const view = buildView(state, seat);
    const decision = await bots[seat]!.decide(view);

    const record: DecisionRecord = {
      index: decisions.length,
      seat,
      street: state.street,
      action: decision.action,
      potBefore: view.pot,
      toCall: view.toCall,
      reasoning: decision.reasoning,
      confidence: decision.confidence,
      perceivedEquity: decision.perceivedEquity,
    };
    decisions.push(record);

    state = applyAction(state, decision.action);
    if (hooks.onDecision) await hooks.onDecision(record, state);
    if (++guard > 400) throw new Error("match: hand did not terminate");
  }

  return { config, state, decisions, holeCards };
}

export interface SessionConfig {
  seed: string;
  smallBlind: number;
  bigBlind: number;
  startingStacks: [number, number];
  hands: number;
  /** Re-buy both players to the starting stacks each hand (cash-game style). */
  rebuy?: boolean;
}

export interface SessionResult {
  hands: HandLog[];
  /** Cumulative net chips per seat across the session. */
  net: [number, number];
  finalStacks: [number, number];
  handsPlayed: number;
}

/**
 * Play a session of N hands. The button alternates each hand. Stacks carry
 * over unless `rebuy` is set; the session stops early if a player can't post
 * the big blind (and rebuy is off).
 */
export async function playSession(
  config: SessionConfig,
  bots: [Bot, Bot],
  hooks: PlayHandHooks & { onHand?: (log: HandLog, index: number) => void | Promise<void> } = {},
): Promise<SessionResult> {
  const hands: HandLog[] = [];
  const net: [number, number] = [0, 0];
  let stacks: [number, number] = [...config.startingStacks];
  let button: Seat = 0;
  let played = 0;

  for (let h = 0; h < config.hands; h++) {
    if (config.rebuy) stacks = [...config.startingStacks];
    if (Math.min(stacks[0], stacks[1]) < config.bigBlind) break;

    const log = await playHand(
      {
        handId: h,
        seed: config.seed,
        button,
        smallBlind: config.smallBlind,
        bigBlind: config.bigBlind,
        players: [
          { name: bots[0].name, stack: stacks[0] },
          { name: bots[1].name, stack: stacks[1] },
        ],
      },
      bots,
      hooks,
    );

    hands.push(log);
    const result = log.state.result!;
    net[0] += result.net[0];
    net[1] += result.net[1];
    stacks = [log.state.players[0].stack, log.state.players[1].stack];
    button = (button === 0 ? 1 : 0) as Seat;
    played++;
    if (hooks.onHand) await hooks.onHand(log, h);
  }

  return { hands, net, finalStacks: stacks, handsPlayed: played };
}
