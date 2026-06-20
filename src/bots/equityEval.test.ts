import { describe, it, expect } from "vitest";
import { equityVsRange, equityEvDecide, type EquityEvConfig } from "./equityEval.js";
import { createHeuristicBot } from "./heuristic.js";
import { exploitPlan, createExploitBot } from "../lib/client/exploitBot.js";
import { createRng } from "../engine/rng.js";
import type { HumanRead } from "../lib/client/humanModel.js";
import type { Card } from "../engine/cards.js";
import type { DecisionView, OpponentView } from "./types.js";

const cfg = (p: Partial<EquityEvConfig> = {}): EquityEvConfig => ({ aggression: 0.6, bluffFreq: 0.2, samples: 300, ...p });
const rng = () => createRng("eqtest");

function mkView(o: {
  holeCards: string[];
  board: string[];
  toCall?: number;
  pot?: number;
  canAggress?: boolean;
  minTo?: number;
  maxTo?: number;
  activePlayers?: number;
  opponents?: OpponentView[];
  street?: DecisionView["street"];
}): DecisionView {
  const toCall = o.toCall ?? 0;
  const canAggress = o.canAggress ?? true;
  return {
    handId: 1,
    seat: 3,
    street: o.street ?? "flop",
    position: "button",
    holeCards: o.holeCards as Card[],
    board: o.board as Card[],
    pot: o.pot ?? 20,
    toCall,
    myStack: 200,
    oppStack: 200,
    myCommittedThisStreet: 0,
    oppCommittedThisStreet: 0,
    bigBlind: 2,
    legal: {
      toAct: 3,
      toCall,
      canFold: toCall > 0,
      canCheck: toCall === 0,
      canCall: toCall > 0,
      callAmount: toCall,
      canBet: canAggress && toCall === 0,
      canRaise: canAggress && toCall > 0,
      aggressiveType: toCall === 0 ? "bet" : "raise",
      minTo: o.minTo ?? 2,
      maxTo: o.maxTo ?? 200,
      minRaiseAmount: 2,
      maxRaiseAmount: 200,
    },
    actionHistory: [],
    tablePosition: "BTN",
    opponents: o.opponents ?? [{ seat: 0, position: "BB", stack: 200, committedThisStreet: 0, committedTotal: 0, folded: false, allIn: false }],
    numPlayers: 2,
    activePlayers: o.activePlayers ?? 2,
  };
}

describe("equityVsRange — equity sanity", () => {
  it("a strong made hand has high equity, trash has low equity", () => {
    const strong = equityVsRange(["Ah", "As"], ["2h", "7d", "Kc"], 1, { iterations: 800, rangeBar: 0.34 });
    const trash = equityVsRange(["2c", "7d"], ["As", "Ks", "Qh"], 1, { iterations: 800, rangeBar: 0.34 });
    expect(strong).toBeGreaterThan(0.75);
    expect(trash).toBeLessThan(0.35);
    expect(strong).toBeGreaterThan(trash);
  });

  it("returns a probability in [0,1] and shrinks as opponents are added", () => {
    const hu = equityVsRange(["Ah", "Kh"], ["Qh", "7d", "2c"], 1, { iterations: 600 });
    const fourway = equityVsRange(["Ah", "Kh"], ["Qh", "7d", "2c"], 3, { iterations: 600 });
    for (const e of [hu, fourway]) {
      expect(e).toBeGreaterThanOrEqual(0);
      expect(e).toBeLessThanOrEqual(1);
    }
    expect(fourway).toBeLessThan(hu); // more opponents to beat → less equity
  });

  it("is deterministic (cached / seeded) for identical inputs", () => {
    const a = equityVsRange(["Td", "Th"], ["2c", "9s", "Kd"], 1, { iterations: 400 });
    const b = equityVsRange(["Td", "Th"], ["2c", "9s", "Kd"], 1, { iterations: 400 });
    expect(a).toBe(b);
  });
});

describe("equityEvDecide — max-EV decisions", () => {
  it("folds when equity is below the pot odds", () => {
    // Trash on A-K-Q facing a big bet (pot odds ≈ 43%); equity is far lower.
    const view = mkView({ holeCards: ["7c", "2d"], board: ["Ks", "Qh", "8s"], toCall: 30, pot: 40, minTo: 60 });
    const d = equityEvDecide(view, cfg(), rng());
    expect(d.action.type).toBe("fold");
    expect(d.source).toBe("equity-EV");
  });

  it("value bets when clearly ahead", () => {
    // Top set, no bet to call → bet for value.
    const view = mkView({ holeCards: ["8c", "8d"], board: ["8h", "2s", "5c"] });
    const d = equityEvDecide(view, cfg(), rng());
    expect(d.action.type).toBe("bet");
    expect((d.perceivedEquity ?? 0)).toBeGreaterThan(0.6);
  });

  it("calls a bet it has the right price for", () => {
    // Middle pair vs a small bet (pot odds ≈ 17%): not strong enough to raise,
    // but well ahead of the price → call.
    const view = mkView({ holeCards: ["7h", "6h"], board: ["Ah", "7d", "2c"], toCall: 6, pot: 30, minTo: 12 });
    const d = equityEvDecide(view, cfg(), rng());
    expect(d.action.type).toBe("call");
  });

  it("semi-bluffs a real draw, but checks pure air", () => {
    // Clean flush draw, lead, aggressive profile → turns the draw into a bet.
    const draw = mkView({ holeCards: ["9c", "6c"], board: ["Kc", "4c", "2h"] });
    const dDraw = equityEvDecide(draw, cfg({ aggression: 0.9, bluffFreq: 0.9 }), rng());
    expect(dDraw.action.type).toBe("bet");

    // No pair, no draw, no bluffing → check.
    const air = mkView({ holeCards: ["7c", "2d"], board: ["Ks", "Qh", "8s"] });
    const dAir = equityEvDecide(air, cfg({ aggression: 0.5, bluffFreq: 0 }), rng());
    expect(dAir.action.type).toBe("check");
  });
});

describe("integration — heuristic bot labels postflop equity-EV", () => {
  it("uses the equity/EV policy postflop (source = equity-EV)", async () => {
    const bot = createHeuristicBot({ name: "EV", seed: "b", tightness: 0.6, aggression: 0.6, bluffFreq: 0.15, equitySamples: 200 });
    const d = await bot.decide(mkView({ holeCards: ["Ah", "As"], board: ["2h", "7d", "Kc"] }));
    expect(d.source).toBe("equity-EV");
  });
});

describe("exploitation layer sits ON TOP of equity-EV", () => {
  const HUMAN = 0;
  const read = (p: Partial<HumanRead> = {}): HumanRead => ({
    hands: 40, vpip: 0.25, pfr: 0.18, foldTo3bet: 0.4, foldToCbet: 0.45, af: 2, wtsd: 0.3, weight: 1, ...p,
  });

  it("deviates (bluff) on top of a passive equity-EV base decision", () => {
    // Weak hand, lead, low bluff freq → equity-EV checks (passive).
    const view = mkView({ holeCards: ["7c", "2d"], board: ["Ks", "Qh", "8s"] });
    const base = equityEvDecide(view, cfg({ bluffFreq: 0 }), rng());
    expect(base.action.type).toBe("check");
    expect(base.source).toBe("equity-EV");

    // The exploit layer reads an over-folder and turns that check into a bluff.
    const plan = exploitPlan(view, base, read({ foldToCbet: 0.7 }), HUMAN);
    expect(plan.kind).toBe("bluff");
    expect(plan.prob).toBeGreaterThan(0);
  });

  it("the wrapped bot still returns a legal action and preserves the equity-EV source", async () => {
    const base = createHeuristicBot({ name: "EV", seed: "b", tightness: 0.6, aggression: 0.6, bluffFreq: 0.15, equitySamples: 150 });
    const wrapped = createExploitBot({ base, seed: "b", getRead: () => read({ foldToCbet: 0.7 }), humanSeat: HUMAN });
    const view = mkView({ holeCards: ["Ah", "As"], board: ["2h", "7d", "Kc"] });
    const d = await wrapped.decide(view);
    expect(["bet", "check", "call", "raise", "fold"]).toContain(d.action.type);
    expect(d.source).toBe("equity-EV");
  });
});
