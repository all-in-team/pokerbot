/**
 * Session model of the HUMAN's play, built ONLY from observed engine actions —
 * never invented. Accumulates HUD-style counters across completed hands and
 * derives rates + a sample-size confidence. Session-only (no DB); the shape is
 * ready to persist later (e.g. Supabase) without changing callers.
 *
 * Pure & engine-read-only: it inspects a completed GameState's actionHistory /
 * result. It does NOT touch engine/equity/EV.
 */

import type { GameState, Seat } from "@/engine/state.js";

interface Ratio {
  n: number;
  d: number;
}

export interface HumanStats {
  hands: number;
  vpip: Ratio; // voluntarily put $ in preflop
  pfr: Ratio; // preflop raise
  foldTo3bet: Ratio; // opened, faced a 3-bet, folded
  foldToCbet: Ratio; // faced a flop c-bet, folded
  aggr: { bets: number; calls: number }; // postflop aggression factor
  wtsd: Ratio; // went to showdown (of hands that saw a flop)
}

export interface HumanRead {
  hands: number;
  vpip: number;
  pfr: number;
  foldTo3bet: number;
  foldToCbet: number;
  /** Postflop aggression factor (bets+raises)/calls. */
  af: number;
  wtsd: number;
  /** 0..1 confidence from sample size (weak early). */
  weight: number;
}

/** Hands of observation to reach full confidence in the read. */
export const FULL_CONFIDENCE_HANDS = 15;

export function emptyHumanStats(): HumanStats {
  return {
    hands: 0,
    vpip: { n: 0, d: 0 },
    pfr: { n: 0, d: 0 },
    foldTo3bet: { n: 0, d: 0 },
    foldToCbet: { n: 0, d: 0 },
    aggr: { bets: 0, calls: 0 },
    wtsd: { n: 0, d: 0 },
  };
}

const isVoluntary = (t: string) => t === "call" || t === "bet" || t === "raise";

/** Fold a completed hand into the running human stats (returns a new object). */
export function observeHand(prev: HumanStats, state: GameState, humanSeat: Seat): HumanStats {
  if (state.street !== "complete") return prev;
  const s: HumanStats = structuredClone(prev);
  const acts = state.actionHistory;
  const pre = acts.filter((a) => a.street === "preflop");
  const flop = acts.filter((a) => a.street === "flop");
  const humanPre = pre.filter((a) => a.seat === humanSeat);
  const humanFoldedPre = humanPre.some((a) => a.type === "fold");

  s.hands += 1;
  s.vpip.d += 1;
  if (humanPre.some((a) => isVoluntary(a.type))) s.vpip.n += 1;
  s.pfr.d += 1;
  if (humanPre.some((a) => a.type === "raise")) s.pfr.n += 1;

  // Fold to 3-bet: the human opened (first preflop raise) and a later raise (by
  // someone else) put them to a decision; did they fold to it?
  const preRaises = pre.filter((a) => a.type === "raise");
  const firstRaise = preRaises[0];
  if (firstRaise && firstRaise.seat === humanSeat) {
    const threeBet = preRaises.find((a, i) => i > 0 && a.seat !== humanSeat);
    if (threeBet) {
      s.foldTo3bet.d += 1;
      const after = pre.slice(pre.indexOf(threeBet) + 1).find((a) => a.seat === humanSeat);
      if (after && after.type === "fold") s.foldTo3bet.n += 1;
    }
  }

  // Fold to flop c-bet: the last preflop aggressor (not the human) bets the flop
  // and the human, having seen the flop, folds to it.
  const aggressor = preRaises.length ? preRaises[preRaises.length - 1]!.seat : undefined;
  if (aggressor !== undefined && aggressor !== humanSeat && !humanFoldedPre && flop.length) {
    const cbet = flop.find((a) => a.seat === aggressor && a.type === "bet");
    if (cbet) {
      const humanResp = flop.find((a) => a.seat === humanSeat && flop.indexOf(a) > flop.indexOf(cbet));
      if (humanResp) {
        s.foldToCbet.d += 1;
        if (humanResp.type === "fold") s.foldToCbet.n += 1;
      }
    }
  }

  // Postflop aggression factor.
  for (const a of acts) {
    if (a.street === "preflop" || a.seat !== humanSeat) continue;
    if (a.type === "bet" || a.type === "raise") s.aggr.bets += 1;
    else if (a.type === "call") s.aggr.calls += 1;
  }

  // Went to showdown (of hands that saw a flop).
  if (!humanFoldedPre && flop.length) {
    s.wtsd.d += 1;
    if (state.result?.showdown && !state.players[humanSeat]?.folded) s.wtsd.n += 1;
  }

  return s;
}

const rate = (r: Ratio) => (r.d > 0 ? r.n / r.d : 0);

export function readOf(s: HumanStats): HumanRead {
  return {
    hands: s.hands,
    vpip: rate(s.vpip),
    pfr: rate(s.pfr),
    foldTo3bet: rate(s.foldTo3bet),
    foldToCbet: rate(s.foldToCbet),
    af: s.aggr.calls > 0 ? s.aggr.bets / s.aggr.calls : s.aggr.bets,
    wtsd: rate(s.wtsd),
    weight: Math.min(1, s.hands / FULL_CONFIDENCE_HANDS),
  };
}

export const EMPTY_READ: HumanRead = readOf(emptyHumanStats());
