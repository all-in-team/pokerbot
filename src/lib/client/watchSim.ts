/**
 * Client-safe entry point for the /watch visualiser.
 *
 * Runs 6-max (2..6) heuristic bot-vs-bot poker entirely in the browser: it
 * imports ONLY the pure engine + heuristic bots and the in-memory runner.
 * It deliberately avoids the DB-backed selfplay driver (better-sqlite3) and
 * process.argv, both of which would break the browser bundle.
 */

import { playHand, playRingSession, type HandLog } from "@/sim/match.js";
import { createHeuristicBot } from "@/bots/heuristic.js";
import type { Bot } from "@/bots/types.js";
import type { Seat } from "@/engine/state.js";

/**
 * Every seat runs the SAME EV-seeking heuristic brain (no TAG/LAG/nit/maniac
 * archetypes). Seats differ only by an independent RNG seed, so play varies
 * without giving anyone a divergent style.
 */
const EV_BRAIN = { tightness: 0.62, aggression: 0.6, bluffFreq: 0.12 } as const;

export interface WatchTable {
  bots: Bot[];
  seats: number;
  smallBlind: number;
  bigBlind: number;
  ante: number;
  startingStack: number;
  seed: string;
}

export interface WatchTableOptions {
  seats?: number; // 2..6, default 6
  seed?: string;
  startingStack?: number; // default 200 (100bb)
  smallBlind?: number; // default 1
  bigBlind?: number; // default 2
  ante?: number; // default 2 ($1/$2 ante $2)
}

/** Seat N heuristic bots with rotating personalities. */
export function createWatchTable(opts: WatchTableOptions = {}): WatchTable {
  const seats = Math.max(2, Math.min(6, opts.seats ?? 6));
  const seed = opts.seed ?? "watch";
  const bots: Bot[] = Array.from({ length: seats }, (_, i) =>
    createHeuristicBot({ name: `Bot ${i + 1}`, style: "EV", seed: `${seed}:bot${i}`, ...EV_BRAIN }),
  );
  return {
    bots,
    seats,
    smallBlind: opts.smallBlind ?? 1,
    bigBlind: opts.bigBlind ?? 2,
    ante: opts.ante ?? 2,
    startingStack: opts.startingStack ?? 200,
    seed,
  };
}

/** Mutable cross-hand state for continuous "next hand" watching. */
export interface WatchState {
  stacks: number[];
  button: Seat;
  handId: number;
}

export function initialWatchState(table: WatchTable): WatchState {
  return {
    stacks: Array.from({ length: table.seats }, () => table.startingStack),
    button: 0,
    handId: 0,
  };
}

/**
 * Play one hand, carrying stacks. Any seat too short to post the big blind is
 * re-bought to the starting stack (so the table never stalls). Returns the
 * HandLog plus the next cross-hand state (stacks/button/handId advanced).
 */
export async function playNextHand(
  table: WatchTable,
  prev: WatchState,
): Promise<{ log: HandLog; next: WatchState }> {
  const n = table.seats;
  const stacks = prev.stacks.map((s) => (s < table.bigBlind ? table.startingStack : s));

  const players = stacks.map((stack, i) => ({ name: table.bots[i]!.name, stack })) as [
    { name: string; stack: number },
    { name: string; stack: number },
    ...{ name: string; stack: number }[],
  ];

  const log = await playHand(
    {
      handId: prev.handId,
      seed: `${table.seed}#${prev.handId}`,
      button: prev.button,
      smallBlind: table.smallBlind,
      bigBlind: table.bigBlind,
      ante: table.ante,
      players,
    },
    table.bots,
  );

  return {
    log,
    next: {
      stacks: log.state.players.map((p) => p.stack),
      button: ((prev.button + 1) % n) as Seat,
      handId: prev.handId + 1,
    },
  };
}

/** Convenience: play a fixed-length session up front (for tests / batch load). */
export async function runWatchSession(opts: WatchTableOptions & { hands?: number } = {}): Promise<HandLog[]> {
  const table = createWatchTable(opts);
  const res = await playRingSession(
    {
      seed: table.seed,
      smallBlind: table.smallBlind,
      bigBlind: table.bigBlind,
      ante: table.ante,
      startingStacks: Array.from({ length: table.seats }, () => table.startingStack),
      hands: opts.hands ?? 1,
      rebuy: true,
    },
    table.bots,
  );
  return res.hands;
}
