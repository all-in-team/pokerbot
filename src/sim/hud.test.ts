import { describe, it, expect } from "vitest";
import { computeHudStats, type HandForStats } from "./hud.js";
import type { Action, Seat } from "../engine/state.js";

const a = (seat: Seat, type: Action["type"], street: Action["street"]): Action => ({
  seat,
  type,
  amount: 0,
  street,
});

// Hand: button(seat0/SB) opens, BB(seat1) calls, BB checks flop, SB c-bets, BB folds.
const cbetFoldHand: HandForStats = {
  button: 0,
  bigBlind: 2,
  showdown: false,
  winners: [0],
  net: [4, -4],
  actionHistory: [
    a(0, "post-sb", "preflop"),
    a(1, "post-bb", "preflop"),
    a(0, "raise", "preflop"),
    a(1, "call", "preflop"),
    a(1, "check", "flop"),
    a(0, "bet", "flop"),
    a(1, "fold", "flop"),
  ],
};

// Hand: SB opens, BB 3-bets, SB calls; goes to showdown, BB wins.
const threeBetHand: HandForStats = {
  button: 0,
  bigBlind: 2,
  showdown: true,
  winners: [1],
  net: [-20, 20],
  actionHistory: [
    a(0, "post-sb", "preflop"),
    a(1, "post-bb", "preflop"),
    a(0, "raise", "preflop"),
    a(1, "raise", "preflop"), // 3-bet
    a(0, "call", "preflop"),
    a(1, "bet", "flop"),
    a(0, "call", "flop"),
    a(1, "bet", "turn"),
    a(0, "call", "turn"),
    a(1, "check", "river"),
    a(0, "check", "river"),
  ],
};

describe("HUD stats", () => {
  it("reads the c-bet / fold scenario from both sides", () => {
    const sb = computeHudStats([cbetFoldHand], 0);
    expect(sb.vpip).toBe(1); // raised preflop
    expect(sb.pfr).toBe(1);
    expect(sb.af).toBe(1); // one bet, no calls postflop
    expect(sb.counts.facedCbet).toBe(0); // SB was the aggressor

    const bb = computeHudStats([cbetFoldHand], 1);
    expect(bb.vpip).toBe(1); // called preflop
    expect(bb.pfr).toBe(0);
    expect(bb.foldToCbet).toBe(1); // folded to the c-bet
    expect(bb.counts.facedCbet).toBe(1);
  });

  it("computes 3-bet, AF, WTSD and win rate", () => {
    const sb = computeHudStats([threeBetHand], 0);
    expect(sb.counts.threeBetOpp).toBe(0); // SB opened, faced the 3-bet (4-bet opp, not tracked)
    expect(sb.af).toBe(0); // SB only called postflop
    expect(sb.counts.postflopCalls).toBe(2);

    const bb = computeHudStats([threeBetHand], 1);
    expect(bb.threeBet).toBe(1); // had the opportunity and took it
    expect(bb.counts.threeBetOpp).toBe(1);
    expect(bb.af).toBe(2); // two bets, zero calls postflop → 2/0 reported as 2
    expect(bb.wtsd).toBe(1);
    expect(bb.winRateBb100).toBeCloseTo((20 / 2) * 100, 5);
  });

  it("aggregates rates across multiple hands", () => {
    const s = computeHudStats([cbetFoldHand, threeBetHand], 1);
    expect(s.hands).toBe(2);
    expect(s.vpip).toBe(1); // VPIP'd both hands
    expect(s.pfr).toBe(0.5); // raised 1 of 2
    expect(s.netChips).toBe(16); // -4 + 20
  });
});
