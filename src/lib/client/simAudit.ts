/**
 * Fast headless bot-vs-bot AUDIT of the unified EV brain (decideEV).
 *
 * This is a DEBUG / BENCHMARK tool — there is NO learning: decideEV stays a fixed
 * function, nothing trains. It runs N hands of 6-max bot-vs-bot at top speed (no
 * animation, no human read, no exploit skew) through the SAME engine + brain, and
 * aggregates behaviour stats so you can eyeball whether the play is sane (e.g.
 * "all-in ~100%" = bug) and re-check after a fix.
 *
 * Deterministic for a fixed seed (reproducible); random seed by default.
 * Touches neither decideEV nor the engine.
 */

import { applyAction, createHand, type HandConfig } from "@/engine/engine.js";
import { pot as potOf, type AtLeastTwo, type GameState, type Seat, type Street } from "@/engine/state.js";
import { buildView } from "@/sim/match.js";
import { createHeuristicBot } from "@/bots/heuristic.js";
import { randomSeed } from "@/lib/client/randomSeed.js";
import type { Bot } from "@/bots/types.js";

/** Same EV-seeking brain every bot uses on /watch — no archetypes, no read. */
const EV_BRAIN = { tightness: 0.62, aggression: 0.6, bluffFreq: 0.12 } as const;

export type ActionCat = "fold" | "check" | "call" | "bet" | "raise" | "all-in";
const STREETS: Street[] = ["preflop", "flop", "turn", "river"];

export interface StreetDist {
  counts: Record<ActionCat, number>;
  total: number;
  /** Percentages per category (0..100). */
  pct: Record<ActionCat, number>;
}

export interface AuditResult {
  hands: number;
  seats: number;
  /** Action mix per street. */
  byStreet: Record<Street, StreetDist>;
  /** % of hands with at least one preflop all-in. */
  preflopAllInPct: number;
  /** Voluntarily-put-money-in-pot %, over all dealt seat-hands. */
  vpip: number;
  /** Preflop-raise %, over all dealt seat-hands. */
  pfr: number;
  /** Average final pot, in big blinds. */
  avgPotBb: number;
  /** % of hands decided at showdown. */
  showdownPct: number;
  /** bb/100 per seat index (length = seats) — flags a seat dominating abnormally. */
  bb100: number[];
}

export interface AuditConfig {
  hands: number;
  seed?: string;
  seats?: number;
  smallBlind?: number;
  bigBlind?: number;
  ante?: number;
  startingStack?: number;
  /** MC iterations per decision — kept modest for audit speed (same decideEV). */
  evSamples?: number;
  /** Hands between event-loop yields (keeps the UI responsive). */
  chunk?: number;
  onProgress?: (done: number, total: number) => void;
}

const ZERO_CATS = (): Record<ActionCat, number> => ({ fold: 0, check: 0, call: 0, bet: 0, raise: 0, "all-in": 0 });

/** Run the audit. Returns aggregated behaviour stats. */
export async function runAudit(cfg: AuditConfig): Promise<AuditResult> {
  const seats = Math.max(2, Math.min(6, cfg.seats ?? 6));
  const sb = cfg.smallBlind ?? 1;
  const bb = cfg.bigBlind ?? 2;
  const ante = cfg.ante ?? 2;
  const startingStack = cfg.startingStack ?? 200;
  const seed = cfg.seed ?? randomSeed("audit");
  const evSamples = cfg.evSamples ?? 24;
  const chunk = Math.max(1, cfg.chunk ?? 25);
  const totalHands = Math.max(0, Math.floor(cfg.hands));

  // Same EV brain, no human read / no skew.
  const bots: Bot[] = Array.from({ length: seats }, (_, i) =>
    createHeuristicBot({ name: `Bot ${i + 1}`, style: "EV", seed: `${seed}:bot${i}`, evSamples, ...EV_BRAIN }),
  );

  const counts: Record<Street, Record<ActionCat, number>> = {
    preflop: ZERO_CATS(), flop: ZERO_CATS(), turn: ZERO_CATS(), river: ZERO_CATS(),
    showdown: ZERO_CATS(), complete: ZERO_CATS(),
  };
  let preflopAllInHands = 0;
  let vpipCount = 0;
  let pfrCount = 0;
  let potBbSum = 0;
  let showdownCount = 0;
  let handsPlayed = 0;
  const net = new Array<number>(seats).fill(0);

  for (let h = 0; h < totalHands; h++) {
    const stacks = Array.from({ length: seats }, () => startingStack); // rebuy each hand (cash)
    const players = stacks.map((stack, i) => ({ name: bots[i]!.name, stack })) as AtLeastTwo<{ name: string; stack: number }>;
    const config: HandConfig = {
      handId: h,
      seed: `${seed}#${h}`,
      button: (h % seats) as Seat,
      smallBlind: sb,
      bigBlind: bb,
      ante,
      players,
    };

    let state: GameState = createHand(config);
    let preflopAllIn = false;
    const vpipSeen = new Set<Seat>();
    const pfrSeen = new Set<Seat>();
    let guard = 0;

    while (state.street !== "complete" && state.toAct !== null) {
      const seat = state.toAct;
      const view = buildView(state, seat);
      const street = state.street;
      const decision = await bots[seat]!.decide(view);
      state = applyAction(state, decision.action);
      const wentAllIn = state.players[seat]?.allIn === true;

      const t = decision.action.type;
      const cat: ActionCat = wentAllIn && t !== "fold" && t !== "check" ? "all-in" : (t as ActionCat);
      counts[street][cat] += 1;

      if (street === "preflop") {
        if (wentAllIn) preflopAllIn = true;
        if (t === "call" || t === "bet" || t === "raise") vpipSeen.add(seat);
        if (t === "bet" || t === "raise") pfrSeen.add(seat);
      }
      if (++guard > 600) break; // safety, never infinite
    }

    handsPlayed += 1;
    if (preflopAllIn) preflopAllInHands += 1;
    vpipCount += vpipSeen.size;
    pfrCount += pfrSeen.size;
    potBbSum += potOf(state) / bb;
    const result = state.result;
    if (result) {
      if (result.showdown) showdownCount += 1;
      for (let i = 0; i < seats; i++) net[i]! += result.net[i] ?? 0;
    }

    if ((h + 1) % chunk === 0) {
      cfg.onProgress?.(h + 1, totalHands);
      await new Promise<void>((r) => setTimeout(r, 0)); // yield to keep UI responsive
    }
  }
  cfg.onProgress?.(totalHands, totalHands);

  const byStreet = {} as Record<Street, StreetDist>;
  for (const s of STREETS) {
    const c = counts[s];
    const total = (Object.values(c) as number[]).reduce((a, b) => a + b, 0);
    const pct = ZERO_CATS();
    if (total > 0) for (const k of Object.keys(c) as ActionCat[]) pct[k] = (c[k] / total) * 100;
    byStreet[s] = { counts: c, total, pct };
  }
  // showdown/complete streets carry no voluntary actions; expose the 4 real ones.
  byStreet.showdown = { counts: ZERO_CATS(), total: 0, pct: ZERO_CATS() };
  byStreet.complete = { counts: ZERO_CATS(), total: 0, pct: ZERO_CATS() };

  const denom = handsPlayed * seats || 1;
  return {
    hands: handsPlayed,
    seats,
    byStreet,
    preflopAllInPct: handsPlayed ? (preflopAllInHands / handsPlayed) * 100 : 0,
    vpip: (vpipCount / denom) * 100,
    pfr: (pfrCount / denom) * 100,
    avgPotBb: handsPlayed ? potBbSum / handsPlayed : 0,
    showdownPct: handsPlayed ? (showdownCount / handsPlayed) * 100 : 0,
    bb100: net.map((n) => (handsPlayed ? (n / bb / handsPlayed) * 100 : 0)),
  };
}
