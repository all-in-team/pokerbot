import { describe, it, expect } from "vitest";
import { evaluate, compare } from "./evaluator.js";
import type { Card } from "./cards.js";

const c = (...cards: string[]) => cards as Card[];

describe("hand evaluation", () => {
  it("names hands sensibly", () => {
    expect(evaluate(c("As", "Ks", "Qs", "Js", "Ts")).name).toMatch(/Straight Flush|Royal/i);
    expect(evaluate(c("Ac", "Ad", "Ah", "As", "9c")).name).toMatch(/Four/i);
    expect(evaluate(c("Ac", "Ad", "Ah", "2s", "2d")).name).toMatch(/Full House/i);
  });

  it("evaluates the best 5 out of 7 cards", () => {
    // Hole + board: best hand is a flush in spades.
    const h = evaluate(c("As", "2s", "9s", "5s", "Ks", "7d", "3c"));
    expect(h.name).toMatch(/Flush/i);
  });
});

describe("hand comparison (the engine's showdown authority)", () => {
  it("straight flush beats four of a kind", () => {
    expect(compare(c("9s", "8s", "7s", "6s", "5s"), c("Ac", "Ad", "Ah", "As", "9c"))).toBe(1);
  });

  it("four of a kind beats a full house", () => {
    expect(compare(c("Ac", "Ad", "Ah", "As", "9c"), c("Kc", "Kd", "Kh", "Qs", "Qd"))).toBe(1);
  });

  it("a flush beats a straight", () => {
    expect(compare(c("As", "Js", "9s", "5s", "2s"), c("Th", "9c", "8d", "7s", "6h"))).toBe(1);
  });

  it("ranks full houses by trips first", () => {
    // Aces full of deuces beats kings full of queens.
    expect(compare(c("Ac", "Ad", "Ah", "2s", "2d"), c("Kc", "Kd", "Kh", "Qs", "Qd"))).toBe(1);
  });

  it("recognises the wheel (A-2-3-4-5) as a 5-high straight", () => {
    // The wheel loses to a 6-high straight...
    expect(compare(c("Ah", "2s", "3d", "4c", "5h"), c("2h", "3s", "4d", "5c", "6h"))).toBe(-1);
    // ...but beats ace-high (it is a made straight).
    expect(compare(c("Ah", "2s", "3d", "4c", "5h"), c("Ad", "Kd", "Qs", "Jc", "9h"))).toBe(1);
  });

  it("detects exact ties (split pot) ", () => {
    expect(compare(c("Ah", "Kd", "Qs", "Jc", "Td"), c("As", "Kh", "Qd", "Jh", "Tc"))).toBe(0);
  });

  it("breaks ties on kickers", () => {
    // Pair of aces, king kicker beats pair of aces, queen kicker.
    expect(compare(c("Ah", "As", "Kd", "7c", "2h"), c("Ac", "Ad", "Qd", "7s", "2c"))).toBe(1);
  });
});
