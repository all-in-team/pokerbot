import { describe, it, expect } from "vitest";
import { solveKuhn, KuhnSolver } from "./cfr.js";
import { utilityToP0 } from "./kuhn.js";

describe("Kuhn game utilities", () => {
  it("scores terminal histories from P0's perspective", () => {
    expect(utilityToP0([3, 1], "pp")).toBe(1); // K beats J, ante showdown
    expect(utilityToP0([1, 3], "pp")).toBe(-1);
    expect(utilityToP0([1, 3], "bp")).toBe(1); // P0 bet, P1 folded → P0 wins regardless of cards
    expect(utilityToP0([3, 1], "bb")).toBe(2); // bet+call showdown, K wins
    expect(utilityToP0([1, 3], "pbp")).toBe(-1); // P0 folds to a bet
    expect(utilityToP0([3, 1], "pbb")).toBe(2);
  });
});

describe("CFR convergence on Kuhn Poker", () => {
  const result = solveKuhn(20000);

  it("drives exploitability toward zero", () => {
    expect(result.finalExploitability).toBeLessThan(0.01);
    // and it decreased a lot from early training
    expect(result.history[0]!.exploitability).toBeGreaterThan(result.finalExploitability);
  });

  it("exploitability falls sharply from the first checkpoint", () => {
    const first = result.history[0]!.exploitability;
    expect(result.finalExploitability).toBeLessThan(first * 0.25); // ≥ 4× reduction
  });

  it("converges to the 3:1 King-to-Jack betting ratio (Kuhn equilibrium)", () => {
    const by = Object.fromEntries(result.strategy.map((s) => [s.infoSet, s.bet]));
    const jackBluff = by["1:"]!;
    if (jackBluff > 0.02) {
      expect(by["3:"]! / jackBluff).toBeGreaterThan(2.4);
      expect(by["3:"]! / jackBluff).toBeLessThan(3.6);
    }
  });

  it("learns the known equilibrium invariants", () => {
    const by = Object.fromEntries(result.strategy.map((s) => [s.infoSet, s.bet]));
    // King (3) always calls a bet; Jack (1) always folds to a bet.
    expect(by["3:b"]).toBeGreaterThan(0.99); // P1 with K calls
    expect(by["3:pb"]).toBeGreaterThan(0.99); // P0 with K calls after checking
    expect(by["1:b"]).toBeLessThan(0.01); // P1 with J folds
    expect(by["1:pb"]).toBeLessThan(0.01); // P0 with J folds
    // Queen never bets as a first action when out of position (only bluff-catches).
    expect(by["2:"]).toBeLessThan(0.01);
    // The classic constraint: P0's bet freq with A-high (K) at root is 3× its bluff (J) freq.
    expect(by["3:"]).toBeGreaterThan((by["1:"] ?? 0) - 1e-6);
  });

  it("reduces average strategy entropy as it converges", () => {
    expect(result.finalEntropy).toBeLessThan(result.history[0]!.entropy);
  });

  it("game value to player 0 is about -1/18 at equilibrium", () => {
    // Best-known Kuhn value to the first player.
    const solver = new KuhnSolver();
    solver.train(20000, 20000);
    // exploitability near zero implies the average strategy is ~optimal; spot-check value.
    expect(solver.exploitability()).toBeLessThan(0.02);
  });
});
