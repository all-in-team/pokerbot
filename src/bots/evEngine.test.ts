import { describe, it, expect } from "vitest";
import { decideEV, skewRange, type RangeParams } from "./evEngine.js";
import { createRng } from "../engine/rng.js";
import { freshDeck, type Card } from "../engine/cards.js";
import type { DecisionView, OpponentView } from "./types.js";
import type { ActionInput, LegalActions } from "../engine/actions.js";
import type { HumanRead } from "../lib/client/humanModel.js";

const POS = ["BTN", "CO", "HJ", "UTG", "SB", "BB"] as const;

function opps(n: number): OpponentView[] {
  return Array.from({ length: n }, (_, i) => ({
    seat: i + 1,
    position: POS[(i + 1) % POS.length]!,
    stack: 200,
    committedThisStreet: 0,
    committedTotal: 0,
    folded: false,
    allIn: false,
  }));
}

function mkView(o: {
  holeCards: string[];
  board: string[];
  toCall?: number;
  pot?: number;
  canAggress?: boolean;
  nOpps?: number;
  minTo?: number;
  maxTo?: number;
}): DecisionView {
  const toCall = o.toCall ?? 0;
  const canAggress = o.canAggress ?? true;
  const facing = toCall > 0;
  const minTo = o.minTo ?? Math.max(2, toCall * 2 || 2);
  const maxTo = o.maxTo ?? 200;
  const legal: LegalActions = {
    toAct: 0,
    toCall,
    canFold: facing,
    canCheck: !facing,
    canCall: facing,
    callAmount: toCall,
    canBet: canAggress && !facing,
    canRaise: canAggress && facing,
    aggressiveType: facing ? "raise" : "bet",
    minTo,
    maxTo,
    minRaiseAmount: minTo,
    maxRaiseAmount: maxTo,
  };
  return {
    handId: 0,
    seat: 0,
    street: o.board.length === 0 ? "preflop" : o.board.length === 3 ? "flop" : o.board.length === 4 ? "turn" : "river",
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
    legal,
    actionHistory: [],
    tablePosition: "BTN",
    opponents: opps(o.nOpps ?? 1),
    numPlayers: (o.nOpps ?? 1) + 1,
    activePlayers: (o.nOpps ?? 1) + 1,
  };
}

function legalOK(a: ActionInput, legal: LegalActions): boolean {
  switch (a.type) {
    case "fold":
      return legal.canFold;
    case "check":
      return legal.canCheck;
    case "call":
      return legal.canCall;
    case "bet":
      return legal.canBet && a.to >= legal.minTo && a.to <= legal.maxTo;
    case "raise":
      return legal.canRaise && a.to >= legal.minTo && a.to <= legal.maxTo;
  }
}

describe("decideEV — always legal, never crashes (random spots)", () => {
  it("returns a legal action on a large sample of random spots", () => {
    const rng = createRng("spots");
    for (let t = 0; t < 200; t++) {
      // Random distinct cards.
      const deck = freshDeck();
      for (let i = deck.length - 1; i > 0; i--) {
        const j = rng.int(i + 1);
        const tmp = deck[i]!;
        deck[i] = deck[j]!;
        deck[j] = tmp;
      }
      const boardSize = [0, 3, 4, 5][rng.int(4)]!;
      const hole = [deck[0]!, deck[1]!];
      const board = deck.slice(2, 2 + boardSize);
      const facing = rng.next() < 0.5;
      const pot = 4 + rng.int(120);
      const toCall = facing ? 1 + rng.int(pot + 1) : 0;
      const view = mkView({
        holeCards: hole,
        board,
        toCall,
        pot,
        canAggress: rng.next() < 0.85,
        nOpps: 1 + rng.int(4),
        minTo: facing ? toCall * 2 + 1 : 2,
        maxTo: pot + 200,
      });
      const d = decideEV(view, { seed: `s${t}`, evSamples: 24 }, rng);
      expect(legalOK(d.action, view.legal)).toBe(true);
      expect(typeof d.perceivedEquity).toBe("number");
      expect(d.trace.candidates.length).toBeGreaterThan(0);
    }
  });
});

describe("decideEV — EV invariant", () => {
  it("when fold is legal, the chosen action's EV is >= EV(fold)=0", () => {
    const rng = createRng("inv");
    for (let t = 0; t < 60; t++) {
      const deck = freshDeck();
      for (let i = deck.length - 1; i > 0; i--) {
        const j = rng.int(i + 1);
        const tmp = deck[i]!;
        deck[i] = deck[j]!;
        deck[j] = tmp;
      }
      const boardSize = [0, 3, 4, 5][rng.int(4)]!;
      const pot = 6 + rng.int(80);
      const toCall = 1 + rng.int(pot + 1);
      const view = mkView({
        holeCards: [deck[0]!, deck[1]!],
        board: deck.slice(2, 2 + boardSize),
        toCall, // facing a bet → fold is legal
        pot,
        nOpps: 1 + rng.int(3),
        minTo: toCall * 2 + 1,
        maxTo: pot + 200,
      });
      const d = decideEV(view, { seed: `i${t}`, evSamples: 32 }, rng);
      expect(view.legal.canFold).toBe(true);
      const chosen = d.trace.candidates.find((c) => c.label === d.trace.chosen)!;
      expect(chosen.ev).toBeGreaterThanOrEqual(d.trace.foldEv ?? 0);
    }
  });
});

describe("decideEV — EV monotonic in equity (consistency)", () => {
  it("at a fixed spot, a stronger hand never has a lower call-EV than a weaker hand", () => {
    const rng = createRng("mono");
    const spot = { board: ["8h", "8d", "2c"], toCall: 12, pot: 30, nOpps: 1, minTo: 24, maxTo: 200 };
    // Strong = top set (888), weak = total air (7-2 offsuit, no pair/draw).
    const strong = decideEV(mkView({ holeCards: ["8s", "8c"], ...spot }), { seed: "x", evSamples: 400 }, rng);
    const weak = decideEV(mkView({ holeCards: ["7c", "3d"], ...spot }), { seed: "x", evSamples: 400 }, rng);
    const callEv = (d: typeof strong) => d.trace.candidates.find((c) => c.kind === "call")!.ev;
    expect(strong.perceivedEquity!).toBeGreaterThan(weak.perceivedEquity!);
    expect(callEv(strong)).toBeGreaterThanOrEqual(callEv(weak));
  });
});

describe("skewRange — exploit deforms assumptions in the right direction", () => {
  const base: RangeParams = { width: 0.5, contShift: 0 };
  const read = (p: Partial<HumanRead> = {}): HumanRead => ({
    hands: 40, vpip: 0.25, pfr: 0.18, foldTo3bet: 0.4, foldToCbet: 0.45, af: 2, wtsd: 0.3, weight: 1, ...p,
  });

  it("over-folder ⇒ tighter assumed continuation range (more fold equity)", () => {
    const s = skewRange(base, read({ foldToCbet: 0.75 }), true);
    expect(s.contShift).toBeGreaterThan(base.contShift);
  });

  it("calling station ⇒ wider assumed continuation range (less fold equity)", () => {
    const s = skewRange(base, read({ foldToCbet: 0.2, wtsd: 0.55 }), true);
    expect(s.contShift).toBeLessThan(base.contShift);
  });

  it("nit (tight preflop) ⇒ narrower assumed prior range", () => {
    const s = skewRange(base, read({ vpip: 0.1 }), true);
    expect(s.width).toBeLessThan(base.width);
  });

  it("does nothing for a non-human seat or an empty read", () => {
    expect(skewRange(base, read({ foldToCbet: 0.75 }), false)).toEqual(base);
    expect(skewRange(base, read({ foldToCbet: 0.75, weight: 0 }), true)).toEqual(base);
  });
});
