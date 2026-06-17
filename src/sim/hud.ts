/**
 * HUD statistics, computed from hand histories — the same numbers a real online
 * HUD shows, so the bots (and the viewer) can read tendencies and leaks.
 *
 *   VPIP   voluntarily put $ in pot (preflop)        — looseness
 *   PFR    preflop raise                              — preflop aggression
 *   3-bet  re-raised an open preflop                  — preflop aggression
 *   AF     (bets+raises)/calls postflop               — postflop aggression
 *   F2CB   fold to flop continuation bet              — a classic leak
 *   WTSD   went to showdown                           — stickiness
 *   bb/100 big blinds won per 100 hands               — the bottom line
 */

import type { Action, Seat } from "../engine/state.js";
import type { HandLog } from "./match.js";

export interface HandForStats {
  button: Seat;
  bigBlind: number;
  actionHistory: Action[];
  showdown: boolean;
  winners: Seat[];
  net: [number, number];
}

export interface HudStats {
  hands: number;
  vpip: number;
  pfr: number;
  threeBet: number;
  af: number;
  foldToCbet: number;
  wtsd: number;
  wonAtShowdown: number;
  winRateBb100: number;
  netChips: number;
  handsWon: number;
  /** Raw counters, useful for merging across sessions and for transparency. */
  counts: {
    vpip: number;
    pfr: number;
    threeBetOpp: number;
    threeBetMade: number;
    postflopAggressive: number;
    postflopCalls: number;
    facedCbet: number;
    foldedToCbet: number;
    showdowns: number;
    showdownsWon: number;
  };
}

const other = (s: Seat): Seat => (s === 0 ? 1 : 0);
const voluntary = (a: Action) => a.type === "call" || a.type === "bet" || a.type === "raise";

export function handLogToStats(log: HandLog): HandForStats {
  const r = log.state.result!;
  return {
    button: log.config.button,
    bigBlind: log.config.bigBlind,
    actionHistory: log.state.actionHistory,
    showdown: r.showdown,
    winners: r.winners,
    net: r.net,
  };
}

export function computeHudStats(hands: HandForStats[], seat: Seat): HudStats {
  const c = {
    vpip: 0,
    pfr: 0,
    threeBetOpp: 0,
    threeBetMade: 0,
    postflopAggressive: 0,
    postflopCalls: 0,
    facedCbet: 0,
    foldedToCbet: 0,
    showdowns: 0,
    showdownsWon: 0,
  };
  let netChips = 0;
  let handsWon = 0;
  let totalBb = 0;

  for (const h of hands) {
    const acts = h.actionHistory;
    const pre = acts.filter((a) => a.street === "preflop");
    const mine = pre.filter((a) => a.seat === seat);

    // VPIP / PFR
    if (mine.some(voluntary)) c.vpip++;
    if (mine.some((a) => a.type === "raise")) c.pfr++;

    // 3-bet: did the opponent open (first preflop raise) and did we re-raise?
    const preRaises = pre.filter((a) => a.type === "raise");
    const firstRaise = preRaises[0];
    if (firstRaise && firstRaise.seat === other(seat)) {
      c.threeBetOpp++;
      if (preRaises.some((a, i) => i > 0 && a.seat === seat)) c.threeBetMade++;
    }

    // Postflop aggression factor
    for (const a of acts) {
      if (a.street === "preflop" || a.seat !== seat) continue;
      if (a.type === "bet" || a.type === "raise") c.postflopAggressive++;
      else if (a.type === "call") c.postflopCalls++;
    }

    // Fold to flop c-bet: the preflop aggressor bets the flop, we fold to it.
    const lastPreRaise = preRaises[preRaises.length - 1];
    const aggressor = lastPreRaise?.seat;
    if (aggressor !== undefined && aggressor === other(seat)) {
      const flop = acts.filter((a) => a.street === "flop");
      const aggressorFlopFirst = flop.find((a) => a.seat === aggressor);
      if (aggressorFlopFirst && aggressorFlopFirst.type === "bet") {
        // We faced a c-bet if we acted on the flop after it.
        const myFlopResponse = flop.find(
          (a) => a.seat === seat && flop.indexOf(a) > flop.indexOf(aggressorFlopFirst),
        );
        if (myFlopResponse) {
          c.facedCbet++;
          if (myFlopResponse.type === "fold") c.foldedToCbet++;
        }
      }
    }

    // Showdown + results
    if (h.showdown) {
      c.showdowns++;
      if (h.winners.includes(seat)) c.showdownsWon++;
    }
    netChips += h.net[seat];
    if (h.net[seat] > 0) handsWon++;
    totalBb += h.net[seat] / h.bigBlind;
  }

  const n = hands.length || 1;
  const rate = (x: number, d: number) => (d > 0 ? x / d : 0);

  return {
    hands: hands.length,
    vpip: rate(c.vpip, n),
    pfr: rate(c.pfr, n),
    threeBet: rate(c.threeBetMade, c.threeBetOpp),
    af: c.postflopCalls > 0 ? c.postflopAggressive / c.postflopCalls : c.postflopAggressive,
    foldToCbet: rate(c.foldedToCbet, c.facedCbet),
    wtsd: rate(c.showdowns, n),
    wonAtShowdown: rate(c.showdownsWon, c.showdowns),
    winRateBb100: (totalBb / n) * 100,
    netChips,
    handsWon,
    counts: c,
  };
}

/** Format a HUD line for console/log output. */
export function formatHud(name: string, s: HudStats): string {
  const pct = (x: number) => `${(x * 100).toFixed(0)}%`;
  return (
    `${name.padEnd(12)} | VPIP ${pct(s.vpip).padStart(4)} | PFR ${pct(s.pfr).padStart(4)} | ` +
    `3bet ${pct(s.threeBet).padStart(4)} | AF ${s.af.toFixed(1).padStart(4)} | ` +
    `F2CB ${pct(s.foldToCbet).padStart(4)} | WTSD ${pct(s.wtsd).padStart(4)} | ` +
    `${s.winRateBb100 >= 0 ? "+" : ""}${s.winRateBb100.toFixed(1)} bb/100`
  );
}
