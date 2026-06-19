"use client";

/**
 * Replay reconstruction. A stored HandLog (config + the exact action sequence)
 * is deterministically re-run through the engine to produce one ArenaView per
 * step — deal, then after each action — so the viewer can scrub any past hand.
 */

import { applyAction, createHand } from "@/engine/engine.js";
import { computeEquity } from "@/engine/equity.js";
import { pot as potOf, type GameState, type Seat } from "@/engine/state.js";
import { computeHudStats } from "@/sim/hud.js";
import type { Card } from "@/engine/cards.js";
import type { ArenaView, PlayerView, ThoughtView } from "./director.js";
import type { BotMeta } from "./bots.js";
import type { HandLog } from "@/sim/match.js";

export interface ReplayFrame {
  view: ArenaView;
  caption: string;
}

const EMPTY_HUD = [computeHudStats([], 0), computeHudStats([], 1)] as [
  ArenaView["hud"][0],
  ArenaView["hud"][1],
];

function playerView(state: GameState, seat: Seat, meta: BotMeta): PlayerView {
  const p = state.players[seat]!;
  return {
    seat,
    name: p.name,
    style: meta.personality,
    stack: p.stack,
    committedThisStreet: p.committedThisStreet,
    committedTotal: p.committedTotal,
    holeCards: p.holeCards,
    folded: p.folded,
    allIn: p.allIn,
    isButton: seat === state.button,
    isToAct: seat === state.toAct,
    position: seat === state.button ? "button" : "bigBlind",
  };
}

export function buildHandFrames(log: HandLog, meta: [BotMeta, BotMeta]): ReplayFrame[] {
  const holes = log.holeCards as [Card[], Card[]];
  const equityCache = new Map<number, [number, number]>();
  const trueEquity = (state: GameState): { eq: [number, number]; exact: boolean } => {
    const key = state.board.length;
    let eq = equityCache.get(key);
    let exact = key >= 3;
    if (!eq) {
      const r = computeEquity(holes[0], holes[1], state.board, { iterations: 1500, seed: `replay:${log.config.handId}:${key}` });
      eq = r.equity;
      exact = r.exact;
      equityCache.set(key, eq);
    }
    return { eq, exact };
  };

  const thoughts: [ThoughtView | null, ThoughtView | null] = [null, null];

  const frame = (state: GameState, decisionsSoFar: number, caption: string): ReplayFrame => {
    const truth = trueEquity(state);
    const view: ArenaView = {
      handId: state.handId,
      handIndex: log.config.handId,
      handsPlayed: 0,
      street: state.street,
      button: state.button,
      toAct: state.toAct,
      pot: potOf(state),
      smallBlind: state.smallBlind,
      bigBlind: state.bigBlind,
      currentBet: state.currentBet,
      board: state.board,
      players: [playerView(state, 0, meta[0]), playerView(state, 1, meta[1])],
      bots: [
        { name: meta[0].name, style: meta[0].personality },
        { name: meta[1].name, style: meta[1].personality },
      ],
      decisions: log.decisions.slice(0, decisionsSoFar),
      thoughts: [thoughts[0], thoughts[1]],
      equity: {
        true: truth.eq,
        exact: truth.exact,
        perceived: [thoughts[0]?.perceivedEquity ?? null, thoughts[1]?.perceivedEquity ?? null],
      },
      hud: EMPTY_HUD,
      sessionNet: [0, 0],
      result: state.result,
      isComplete: state.street === "complete",
      lastEvent: "idle",
    };
    return { view, caption };
  };

  let state = createHand(log.config);
  const frames: ReplayFrame[] = [frame(state, 0, "Cards dealt · blinds posted")];

  log.decisions.forEach((d, i) => {
    const seat = d.seat;
    const amount = "to" in d.action ? d.action.to : 0;
    thoughts[seat] = {
      seat,
      street: d.street,
      actionType: d.action.type,
      amount,
      reasoning: d.reasoning,
      confidence: d.confidence,
      perceivedEquity: d.perceivedEquity,
    };
    state = applyAction(state, d.action);
    const verb = d.action.type + (amount ? ` to ${amount}` : "");
    frames.push(frame(state, i + 1, `${meta[seat]!.name} ${verb}`));
  });

  return frames;
}
