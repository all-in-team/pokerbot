import { describe, it, expect } from "vitest";
import { comboKey, lookupPreflop, preflopScenarioKey, sampleAction } from "./preflopLookup.js";
import { PREFLOP_RANGES } from "@/data/preflop-ranges.js";
import { createRng } from "@/engine/rng.js";
import type { Card } from "@/engine/cards.js";
import type { Action, Street } from "@/engine/state.js";
import type { DecisionView } from "@/bots/types.js";

/** Minimal DecisionView for lookup tests (lookup only reads a few fields). */
function view(opts: {
  pos: DecisionView["tablePosition"];
  hole: string[];
  history?: Action[];
  numPlayers?: number;
  street?: Street;
}): DecisionView {
  return {
    handId: 0,
    seat: 0,
    street: opts.street ?? "preflop",
    position: "bigBlind",
    tablePosition: opts.pos,
    holeCards: opts.hole as Card[],
    board: [],
    pot: 0,
    toCall: 2,
    myStack: 200,
    oppStack: 200,
    myCommittedThisStreet: 0,
    oppCommittedThisStreet: 0,
    bigBlind: 2,
    numPlayers: opts.numPlayers ?? 6,
    activePlayers: opts.numPlayers ?? 6,
    opponents: [],
    legal: {
      toAct: 0, toCall: 2, canFold: true, canCheck: false, canCall: true, callAmount: 2,
      canBet: false, canRaise: true, aggressiveType: "raise", minTo: 4, maxTo: 200,
      minRaiseAmount: 2, maxRaiseAmount: 198,
    },
    actionHistory: opts.history ?? [],
  };
}

const act = (seat: number, type: Action["type"]): Action => ({ seat, type, amount: 0, street: "preflop" });

describe("comboKey (169-combo notation)", () => {
  it("maps cards to canonical notation, order-independent", () => {
    expect(comboKey(["As", "Ks"] as Card[])).toBe("AKs");
    expect(comboKey(["As", "Kd"] as Card[])).toBe("AKo");
    expect(comboKey(["Kd", "As"] as Card[])).toBe("AKo"); // order independent
    expect(comboKey(["7h", "7d"] as Card[])).toBe("77");
    expect(comboKey(["Td", "9s"] as Card[])).toBe("T9o");
    expect(comboKey(["9s", "Td"] as Card[])).toBe("T9o");
  });
});

describe("preflopScenarioKey (spot detection)", () => {
  it("detects RFI by position when nobody has voluntarily entered", () => {
    // folded around to the button (UTG, HJ, CO folded).
    const h = [act(2, "fold"), act(3, "fold"), act(4, "fold")];
    expect(preflopScenarioKey(view({ pos: "BTN", hole: ["As", "Ad"], history: h }))).toBe("RFI:BTN");
    expect(preflopScenarioKey(view({ pos: "UTG", hole: ["As", "Ad"], history: [] }))).toBe("RFI:UTG");
  });

  it("detects BB facing a single open", () => {
    const h = [act(2, "raise"), act(3, "fold"), act(4, "fold"), act(5, "fold"), act(0, "fold")];
    expect(preflopScenarioKey(view({ pos: "BB", hole: ["Ks", "Kd"], history: h }))).toBe("BBvsOpen");
  });

  it("returns null for uncovered spots (heuristic fallback)", () => {
    // Heads-up (seed ranges are 6-max only)
    expect(preflopScenarioKey(view({ pos: "SB", hole: ["As", "Ad"], numPlayers: 2 }))).toBeNull();
    // A limped pot (a call before, hero not BB)
    expect(preflopScenarioKey(view({ pos: "BTN", hole: ["As", "Ad"], history: [act(2, "call")] }))).toBeNull();
    // CO facing an open (vs-open from non-BB not seeded)
    expect(preflopScenarioKey(view({ pos: "CO", hole: ["As", "Ad"], history: [act(2, "raise")] }))).toBeNull();
    // Postflop
    expect(preflopScenarioKey(view({ pos: "BTN", hole: ["As", "Ad"], street: "flop" }))).toBeNull();
  });
});

describe("lookupPreflop", () => {
  it("returns the table action for a known in-range hand", () => {
    const r = lookupPreflop(view({ pos: "BTN", hole: ["As", "Ad"], history: [] }));
    expect(r).not.toBeNull();
    expect(r!.source).toBe("approx");
    expect(r!.scenario).toBe("RFI:BTN");
    expect(r!.combo).toBe("AA");
    expect(r!.dist.raise).toBe(1); // AA opens 100%
  });

  it("treats out-of-range hands as fold within a covered scenario", () => {
    const r = lookupPreflop(view({ pos: "UTG", hole: ["7s", "2d"], history: [] }));
    expect(r).not.toBeNull();
    expect(r!.dist).toEqual({ fold: 1, call: 0, raise: 0 }); // 72o not opened UTG
  });

  it("returns a 3-bet for a premium in BB defence", () => {
    const h = [act(2, "raise"), act(3, "fold"), act(4, "fold"), act(5, "fold"), act(0, "fold")];
    const r = lookupPreflop(view({ pos: "BB", hole: ["As", "Kd"], history: h }));
    expect(r!.scenario).toBe("BBvsOpen");
    expect(r!.dist.raise).toBe(1); // AKo 3-bets
    expect(r!.dist.raiseTo).toBe(11);
  });

  it("returns null when no table covers the spot", () => {
    expect(lookupPreflop(view({ pos: "SB", hole: ["As", "Ad"], numPlayers: 2 }))).toBeNull();
  });
});

describe("range tables (data integrity)", () => {
  it("every stored hand's frequencies sum to ~1", () => {
    for (const table of Object.values(PREFLOP_RANGES)) {
      for (const [combo, a] of Object.entries(table.combos)) {
        const sum = a.fold + a.call + a.raise;
        expect(Math.abs(sum - 1)).toBeLessThan(1e-9);
        if (a.raise > 0) expect(a.raiseTo).toBeGreaterThan(0); // raises carry a size
        expect(combo).toMatch(/^[2-9TJQKA]{2}[so]?$/); // valid 169-combo key
      }
    }
  });
});

describe("sampleAction (deterministic, distribution-respecting)", () => {
  it("maps rolls to actions by cumulative frequency", () => {
    const d = { fold: 0.3, call: 0.5, raise: 0.2, raiseTo: 11 };
    expect(sampleAction(d, 0.0)).toBe("fold");
    expect(sampleAction(d, 0.29)).toBe("fold");
    expect(sampleAction(d, 0.3)).toBe("call");
    expect(sampleAction(d, 0.79)).toBe("call");
    expect(sampleAction(d, 0.8)).toBe("raise");
    expect(sampleAction(d, 0.999)).toBe("raise");
  });

  it("a pure distribution always yields its action", () => {
    const pure = { fold: 0, call: 0, raise: 1, raiseTo: 2.5 };
    for (const roll of [0, 0.25, 0.5, 0.75, 0.999]) expect(sampleAction(pure, roll)).toBe("raise");
  });

  it("sampling with a seeded RNG matches the distribution (deterministic)", () => {
    const d = { fold: 0, call: 0.7, raise: 0.3, raiseTo: 11 };
    const rng = createRng("sample-seed");
    const counts = { fold: 0, call: 0, raise: 0 };
    const N = 4000;
    for (let i = 0; i < N; i++) counts[sampleAction(d, rng.next())]++;
    expect(counts.fold).toBe(0);
    expect(counts.call / N).toBeCloseTo(0.7, 1); // within ~5%
    expect(counts.raise / N).toBeCloseTo(0.3, 1);

    // Same seed ⇒ identical sequence (determinism).
    const rngA = createRng("det");
    const rngB = createRng("det");
    const seqA = Array.from({ length: 50 }, () => sampleAction(d, rngA.next()));
    const seqB = Array.from({ length: 50 }, () => sampleAction(d, rngB.next()));
    expect(seqA).toEqual(seqB);
  });
});
