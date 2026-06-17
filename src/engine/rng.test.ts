import { describe, it, expect } from "vitest";
import { createRng } from "./rng.js";
import { shuffledDeck, freshDeck } from "./cards.js";

describe("seeded RNG", () => {
  it("is deterministic for the same seed", () => {
    const a = createRng("seed-1");
    const b = createRng("seed-1");
    const seqA = Array.from({ length: 20 }, () => a.next());
    const seqB = Array.from({ length: 20 }, () => b.next());
    expect(seqA).toEqual(seqB);
  });

  it("differs for different seeds", () => {
    const a = createRng("seed-1");
    const b = createRng("seed-2");
    expect(a.next()).not.toEqual(b.next());
  });

  it("produces floats in [0, 1)", () => {
    const r = createRng("range");
    for (let i = 0; i < 1000; i++) {
      const v = r.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("int(n) stays in [0, n)", () => {
    const r = createRng("ints");
    for (let i = 0; i < 1000; i++) {
      const v = r.int(6);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(6);
      expect(Number.isInteger(v)).toBe(true);
    }
  });
});

describe("deck", () => {
  it("freshDeck has 52 unique cards", () => {
    const d = freshDeck();
    expect(d).toHaveLength(52);
    expect(new Set(d).size).toBe(52);
  });

  it("shuffle is a permutation (same 52 cards) and seed-deterministic", () => {
    const d1 = shuffledDeck(createRng("deck-seed"));
    const d2 = shuffledDeck(createRng("deck-seed"));
    expect(d1).toEqual(d2);
    expect(new Set(d1).size).toBe(52);
    expect([...d1].sort()).toEqual([...freshDeck()].sort());
  });

  it("different seeds usually produce different orders", () => {
    const d1 = shuffledDeck(createRng("a"));
    const d2 = shuffledDeck(createRng("b"));
    expect(d1).not.toEqual(d2);
  });
});
