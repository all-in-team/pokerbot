import { describe, it, expect } from "vitest";
import { computeEquity } from "./equity.js";
import type { Card } from "./cards.js";

const c = (...cards: string[]) => cards as Card[];

describe("equity (truth layer)", () => {
  it("AA vs KK preflop is roughly 82% (Monte Carlo)", () => {
    const r = computeEquity(c("As", "Ah"), c("Ks", "Kh"), [], { iterations: 20000, seed: "aakk" });
    expect(r.exact).toBe(false);
    expect(r.equity[0]).toBeGreaterThan(0.78);
    expect(r.equity[0]).toBeLessThan(0.86);
    expect(r.equity[0] + r.equity[1]).toBeCloseTo(1, 5);
  });

  it("is exact on the river (0 cards to come)", () => {
    // Board pairs the kings → KK has a set, AA has only aces. KK wins outright.
    const r = computeEquity(c("As", "Ah"), c("Kc", "Kd"), c("Ks", "7d", "2c", "9h", "3s"));
    expect(r.exact).toBe(true);
    expect(r.samples).toBe(1);
    expect(r.equity[0]).toBe(0);
    expect(r.equity[1]).toBe(1);
  });

  it("enumerates exactly on the turn (44 river cards)", () => {
    const r = computeEquity(c("As", "Ah"), c("Ks", "Kh"), c("2c", "7d", "9s", "Tc"));
    expect(r.exact).toBe(true);
    expect(r.samples).toBe(44); // 52 − 4 hole − 4 board
    expect(r.equity[0]).toBeGreaterThan(0.9); // AA crushing on a dry board
  });

  it("enumerates exactly on the flop (~990 run-outs)", () => {
    const r = computeEquity(c("As", "Ah"), c("Ks", "Kh"), c("2c", "7d", "9s"));
    expect(r.exact).toBe(true);
    // C(45, 2) = 990 two-card run-outs.
    expect(r.samples).toBe(990);
  });

  it("reports a draw as dead when it cannot win", () => {
    // Quads vs a hand that can't catch up: 7c7d7h7s board, opponent has nothing.
    const r = computeEquity(c("Ah", "Ad"), c("Kh", "Qd"), c("As", "Ac", "2d", "5s", "9h"));
    expect(r.equity[0]).toBe(1); // four aces
    expect(r.equity[1]).toBe(0);
  });

  it("is deterministic for a fixed Monte Carlo seed", () => {
    const a = computeEquity(c("As", "Ah"), c("Ks", "Kh"), [], { iterations: 5000, seed: "fixed" });
    const b = computeEquity(c("As", "Ah"), c("Ks", "Kh"), [], { iterations: 5000, seed: "fixed" });
    expect(a.equity).toEqual(b.equity);
  });
});
