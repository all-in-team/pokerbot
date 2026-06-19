import { describe, it, expect } from "vitest";
import {
  createPlayTable,
  dealHand,
  advance,
  applyHuman,
  heroLegal,
  liveFrame,
  type PlayTable,
} from "./playDriver.js";

const STACKS = () => Array.from({ length: 6 }, () => 200);

// Button = 5 ⇒ SB=0, BB=1, UTG=2. Putting the hero at UTG means it's the hero's
// turn immediately after the deal — a deterministic spot to assert against.
function utgHeroHand(): { table: PlayTable; state: ReturnType<typeof dealHand> } {
  const table = createPlayTable({ heroSeat: 2, seed: "t" });
  const state = dealHand(table, STACKS(), 5, 0);
  return { table, state };
}

describe("playDriver — legal actions & bounds", () => {
  it("gives the hero the correct opener spot (facing the BB) with right min/max", () => {
    const { state } = utgHeroHand();
    expect(state.toAct).toBe(2); // UTG = hero acts first
    const legal = heroLegal(state, 2)!;
    expect(legal).not.toBeNull();
    expect(legal.toCall).toBe(2); // facing the big blind
    expect(legal.canFold).toBe(true);
    expect(legal.canCheck).toBe(false);
    expect(legal.canCall).toBe(true);
    expect(legal.canRaise).toBe(true);
    expect(legal.aggressiveType).toBe("raise");
    expect(legal.minTo).toBe(4); // currentBet(2) + last full raise(2)
    // max "to" = everything the hero can put in this street.
    const hero = state.players[2]!;
    expect(legal.maxTo).toBe(hero.committedThisStreet + hero.stack);
    expect(legal.minTo).toBeLessThanOrEqual(legal.maxTo);
  });

  it("returns null legal actions when it is not the hero's turn", () => {
    const table = createPlayTable({ heroSeat: 1, seed: "t" });
    const dealt = dealHand(table, STACKS(), 5, 0); // toAct = UTG(2), a bot
    expect(heroLegal(dealt, 1)).toBeNull();
  });
});

describe("playDriver — advancing the engine", () => {
  it("runs bots until it is the hero's turn (or the hand ends)", async () => {
    const table = createPlayTable({ heroSeat: 1, seed: "t" }); // hero = BB
    const dealt = dealHand(table, STACKS(), 5, 0);
    const before = dealt.actionHistory.length; // antes + blinds
    const s = await advance(dealt, table);
    expect(s.actionHistory.length).toBeGreaterThan(before); // bots acted
    if (s.street !== "complete") {
      expect(s.toAct).toBe(1); // paused exactly on the hero
    }
  });

  it("a human fold ends the hand (bots play it out)", async () => {
    const { table, state } = utgHeroHand();
    const s = await applyHuman(state, { type: "fold" }, table);
    expect(s.players[2]!.folded).toBe(true);
    expect(s.street).toBe("complete");
    expect(s.result).not.toBeNull();
  });

  it("a human call is applied and the state advances", async () => {
    const { table, state } = utgHeroHand();
    const s = await applyHuman(state, { type: "call" }, table);
    // The hero's call is recorded in the engine's history.
    expect(s.actionHistory.some((a) => a.seat === 2 && a.type === "call")).toBe(true);
    expect(s.actionHistory.length).toBeGreaterThan(state.actionHistory.length);
  });

  it("a human raise respects the legal bounds (engine validates)", async () => {
    const { table, state } = utgHeroHand();
    const legal = heroLegal(state, 2)!;
    const s = await applyHuman(state, { type: "raise", to: legal.minTo }, table);
    expect(s.actionHistory.some((a) => a.seat === 2 && a.type === "raise")).toBe(true);
  });
});

describe("playDriver — live frame", () => {
  it("reveals the hero's cards and hides live villains pre-showdown", () => {
    const { state } = utgHeroHand();
    const f = liveFrame(state, 2);
    expect(f.toAct).toBe(2);
    expect(f.seats).toHaveLength(6);
    const hero = f.seats.find((s) => s.seat === 2)!;
    expect(hero.revealed).toBe(true);
    expect(hero.cards).toHaveLength(2);
    const villain = f.seats.find((s) => s.seat === 0)!; // SB, not folded
    expect(villain.revealed).toBe(false);
  });
});
