import { describe, it, expect } from "vitest";
import { createHand, applyAction, getLegalActions, type HandConfig } from "./engine.js";
import type { LegalActions, ActionInput } from "./actions.js";
import { createRng, type Rng } from "./rng.js";
import { pot, type AtLeastTwo, type GameState, type Seat } from "./state.js";
import { freshDeck, type Card } from "./cards.js";

type PlayerCfg = { name: string; stack: number };

function players(stacks: number[]): AtLeastTwo<PlayerCfg> {
  return stacks.map((stack, i) => ({ name: `P${i}`, stack })) as AtLeastTwo<PlayerCfg>;
}

/** A random-but-legal policy that aggresses (and shoves) often, to force
 *  multiway all-ins and side pots. */
function randomAction(l: LegalActions, rng: Rng): ActionInput {
  const options: ActionInput[] = [];
  if (l.canCheck) options.push({ type: "check" });
  if (l.canCall) options.push({ type: "call" });
  if (l.canFold && rng.next() < 0.2) options.push({ type: "fold" });
  if (l.canBet || l.canRaise) {
    // Bias toward big bets / all-ins so side pots actually form.
    const to = rng.next() < 0.4 ? l.maxTo : l.minTo + (l.maxTo - l.minTo > 0 ? rng.int(l.maxTo - l.minTo + 1) : 0);
    options.push({ type: l.aggressiveType, to });
  }
  if (options.length === 0) options.push({ type: l.canCheck ? "check" : "call" });
  return options[rng.int(options.length)]!;
}

function playOut(state: GameState, rng: Rng): GameState {
  let s = state;
  let guard = 0;
  while (s.street !== "complete") {
    if (s.toAct === null) throw new Error("no actor but hand not complete");
    s = applyAction(s, randomAction(getLegalActions(s), rng));
    if (++guard > 500) throw new Error("hand did not terminate");
  }
  return s;
}

const sumStacks = (s: GameState) => s.players.reduce((a, p) => a + p.stack, 0);

describe("multiway chip conservation (fuzz, 2–6 players)", () => {
  it("conserves chips across random all-in-heavy hands for every table size", () => {
    const rng = createRng("multiway-fuzz");
    let sawSidePots = false;
    let sawShowdown = false;

    for (let n = 2; n <= 6; n++) {
      for (let i = 0; i < 250; i++) {
        // Uneven stacks (some short) so all-ins create side pots.
        const stacks = Array.from({ length: n }, () => 10 + rng.int(190));
        const startTotal = stacks.reduce((a, b) => a + b, 0);

        const s = playOut(
          createHand({
            handId: i,
            seed: `mw-${n}`,
            button: (i % n) as Seat,
            smallBlind: 1,
            bigBlind: 2,
            ante: 2,
            players: players(stacks),
          }),
          rng,
        );

        // Context string so any future regression prints the exact repro.
        const ctx = `seed=mw-${n} hand=${i} button=${i % n} stacks=[${stacks}]`;

        // 1) Ground truth: no chips created or destroyed.
        expect(sumStacks(s), ctx).toBe(startTotal);

        const r = s.result!;
        expect(r, ctx).not.toBeNull();

        // The POT is only the chips that were actually committed — that is
        // ≤ startTotal, because folded / uncommitted chips stay in stacks. Awards
        // (winnings + uncalled refunds) return EXACTLY the pot, never startTotal.
        // (startTotal is only reached when everyone is all-in.)
        const committed = s.players.reduce((a, p) => a + p.committedTotal, 0);
        let awardedTotal = 0;
        let netTotal = 0;
        for (let seat = 0; seat < n; seat++) {
          expect(r.net[seat], ctx).toBe(r.awarded[seat]! - s.players[seat]!.committedTotal);
          awardedTotal += r.awarded[seat]!;
          netTotal += r.net[seat]!;
        }
        // Awards reconcile to the pot; the hand is zero-sum.
        expect(awardedTotal, `${ctx} pot=${committed}`).toBe(committed);
        expect(netTotal, ctx).toBe(0);
        // Pot breakdown: side pots sum to the pot minus any single uncalled
        // refund, so never more than the pot.
        if (r.pots) {
          const potTotal = r.pots.reduce((a, p) => a + p.amount, 0);
          expect(potTotal, ctx).toBeLessThanOrEqual(committed);
          if (r.pots.length > 1) sawSidePots = true;
        }
        if (r.showdown) sawShowdown = true;
      }
    }

    // The fuzzer actually exercised multiway side pots and showdowns.
    expect(sawSidePots).toBe(true);
    expect(sawShowdown).toBe(true);
  });
});

describe("deterministic side pots (6-max, $1/$2 ante $2)", () => {
  it("splits a multiway all-in into main + 3 side pots with correct winners", () => {
    // Stacks [20,40,60,100,100,100]; everyone jams. With everyone all-in for
    // their whole stack, contributions = the stacks themselves. Pot layers:
    //   main   (level 20, ×6) = 120
    //   side_1 (level 40, ×5) = 100
    //   side_2 (level 60, ×4) =  80
    //   side_3 (level 100,×3) = 120     total = 420
    //
    // Button = 5 ⇒ SB = 0, BB = 1, so hole cards are dealt seat 0,1,2,3,4,5 in
    // order — letting us script the deck straightforwardly.
    //
    // Cards (board Ac Ad 7h 2s 9c — paired aces):
    //   seat0 As Ah → QUADS  (best overall → wins MAIN only; only contributed 20)
    //   seat3 Ks Kh → aces & kings two pair (best among the deeper stacks)
    //   others      → a single pair of aces (worse), so seat3 sweeps the sides.
    const fixedDeck: Card[] = [
      "As", "Ah", // seat 0
      "3c", "4s", // seat 1
      "5c", "6s", // seat 2
      "Ks", "Kh", // seat 3
      "8d", "Tc", // seat 4
      "Jd", "Qc", // seat 5
      "Ac", "Ad", "7h", "2s", "9c", // board
    ];
    const used = new Set<string>(fixedDeck);
    const deck = [...fixedDeck, ...freshDeck().filter((c) => !used.has(c))];

    const config: HandConfig = {
      handId: 1,
      seed: "sidepots",
      button: 5,
      smallBlind: 1,
      bigBlind: 2,
      ante: 2,
      players: players([20, 40, 60, 100, 100, 100]),
      fixedDeck: deck,
    };

    // Drive everyone all-in: raise to the cap if possible, else call.
    let s = createHand(config);
    let guard = 0;
    while (s.street !== "complete") {
      const l = getLegalActions(s);
      if (l.canRaise) s = applyAction(s, { type: "raise", to: l.maxTo });
      else if (l.canCall) s = applyAction(s, { type: "call" });
      else if (l.canCheck) s = applyAction(s, { type: "check" });
      else s = applyAction(s, { type: "fold" });
      if (++guard > 200) throw new Error("did not terminate");
    }

    const r = s.result!;
    expect(r.showdown).toBe(true);
    expect(r.pots).toBeDefined();

    // Pot sizes, in order: main, side_1, side_2, side_3.
    expect(r.pots!.map((p) => p.amount)).toEqual([120, 100, 80, 120]);
    // Winners per pot: short stack (seat0) wins the main; seat3 sweeps the sides.
    expect(r.pots!.map((p) => p.winners)).toEqual([[0], [3], [3], [3]]);

    // Eligibility tracks the all-in levels.
    expect(r.pots![0]!.eligible).toEqual([0, 1, 2, 3, 4, 5]);
    expect(r.pots![1]!.eligible).toEqual([1, 2, 3, 4, 5]);
    expect(r.pots![2]!.eligible).toEqual([2, 3, 4, 5]);
    expect(r.pots![3]!.eligible).toEqual([3, 4, 5]);

    // Awards and overall winners.
    expect(r.awarded[0]).toBe(120);
    expect(r.awarded[3]).toBe(300); // 100 + 80 + 120
    expect(r.winners).toEqual([0, 3]);

    // Chip conservation.
    expect(sumStacks(s)).toBe(420);
    expect(s.players[0]!.stack).toBe(120);
    expect(s.players[3]!.stack).toBe(300);
  });

  it("returns an uncalled overbet (single largest contribution) to its owner", () => {
    // seat0 covers everyone; it shoves and only the short stacks call.
    // Stacks: [200, 30, 30]. seat0's chips above 30 are uncalled → refunded.
    const fixedDeck: Card[] = [
      "As", "Ah", // seat0 (SB, button=2 ⇒ sb=0)
      "Ks", "Kh", // seat1
      "Qs", "Qh", // seat2
      "2c", "7d", "9s", "Tc", "Jh", // board (no help to anyone; seat0 wins)
    ];
    const used = new Set<string>(fixedDeck);
    const deck = [...fixedDeck, ...freshDeck().filter((c) => !used.has(c))];

    let s = createHand({
      handId: 2,
      seed: "uncalled",
      button: 2,
      smallBlind: 1,
      bigBlind: 2,
      ante: 0,
      players: players([200, 30, 30]),
      fixedDeck: deck,
    });
    let guard = 0;
    while (s.street !== "complete") {
      const l = getLegalActions(s);
      if (l.canRaise) s = applyAction(s, { type: "raise", to: l.maxTo });
      else if (l.canCall) s = applyAction(s, { type: "call" });
      else if (l.canCheck) s = applyAction(s, { type: "check" });
      else s = applyAction(s, { type: "fold" });
      if (++guard > 200) throw new Error("did not terminate");
    }

    const r = s.result!;
    // seat0 contests 30 from each of three players = 90, plus its own uncalled
    // 170 refunded ⇒ final stack 200 + 60 won.
    expect(r.winners).toEqual([0]);
    expect(s.players[0]!.stack).toBe(260); // 200 start + 30 + 30 won
    expect(s.players[1]!.stack).toBe(0);
    expect(s.players[2]!.stack).toBe(0);
    expect(sumStacks(s)).toBe(260);
  });
});

describe("button / blind / ante rotation (6-max)", () => {
  it("rotates positions and posts antes + blinds every hand", () => {
    const n = 6;
    const ante = 2;
    const sb = 1;
    const bb = 2;

    for (let button = 0 as Seat; button < n; button++) {
      const s = createHand({
        handId: button,
        seed: "rotate",
        button,
        smallBlind: sb,
        bigBlind: bb,
        ante,
        players: players(Array.from({ length: n }, () => 200)),
      });

      const sbSeat = (button + 1) % n;
      const bbSeat = (button + 2) % n;
      const utg = (button + 3) % n;

      // Positions follow the button.
      expect(s.positions[button]).toBe("BTN");
      expect(s.positions[sbSeat]).toBe("SB");
      expect(s.positions[bbSeat]).toBe("BB");
      expect(s.positions[utg]).toBe("UTG");

      // Everyone anted; the blinds are posted by the right seats.
      const antes = s.actionHistory.filter((a) => a.type === "post-ante");
      expect(antes).toHaveLength(n);
      expect(s.actionHistory.find((a) => a.type === "post-sb")!.seat).toBe(sbSeat);
      expect(s.actionHistory.find((a) => a.type === "post-bb")!.seat).toBe(bbSeat);
      expect(s.players[sbSeat]!.committedThisStreet).toBe(sb);
      expect(s.players[bbSeat]!.committedThisStreet).toBe(bb);

      // Preflop accounting: N×ante + SB + BB, before any voluntary action.
      expect(pot(s)).toBe(n * ante + sb + bb); // 6×2 + 1 + 2 = 15
      // Action starts at UTG (left of the big blind).
      expect(s.toAct).toBe(utg);
    }
  });
});

describe("multiway showdown conservation (regression)", () => {
  // Freezes the class of hand the fuzz tripped on: NOT everyone is all-in, so the
  // pot is smaller than the starting stacks. The bug was a test assertion that
  // expected Σawarded === startTotal; the correct invariant is Σawarded === pot
  // (= Σ committedTotal). Conservation is the stack total, which is unchanged.
  it("awards equal the POT (< startTotal) when a player folds, and a folded ante is still in the pot", () => {
    // 3-handed, $1/$2 ante $2, stacks [100,100,100]. Button=2 ⇒ SB=0, BB=1,
    // UTG=2; hole cards dealt seat 0,1,2 in order. UTG folds (keeping its stack
    // but having posted the ante), SB limps, BB checks, then checked down.
    const fixedDeck: Card[] = [
      "As", "Ad", // seat0 (SB) — wins with aces
      "Ks", "Kd", // seat1 (BB)
      "2c", "3d", // seat2 (UTG) — folds
      "7h", "9s", "Tc", "Jd", "4c", // board (no straight/flush; AA holds)
    ];
    const used = new Set<string>(fixedDeck);
    const deck = [...fixedDeck, ...freshDeck().filter((c) => !used.has(c))];

    let s = createHand({
      handId: 1,
      seed: "regr-fold",
      button: 2,
      smallBlind: 1,
      bigBlind: 2,
      ante: 2,
      players: players([100, 100, 100]),
      fixedDeck: deck,
    });

    // UTG folds; SB limps; BB checks; then both check every street.
    const line: ActionInput[] = [
      { type: "fold" }, // seat2 UTG
      { type: "call" }, // seat0 SB limps
      { type: "check" }, // seat1 BB
      { type: "check" }, { type: "check" }, // flop  (seat0, seat1)
      { type: "check" }, { type: "check" }, // turn
      { type: "check" }, { type: "check" }, // river
    ];
    for (const a of line) s = applyAction(s, a);
    expect(s.street).toBe("complete");

    const r = s.result!;
    const startTotal = 300;
    const committed = s.players.reduce((a, p) => a + p.committedTotal, 0);
    const awardedTotal = (r.awarded as number[]).reduce((a, b) => a + b, 0);

    // Pot = antes (3×2) + SB's 2 + BB's 2 = 10. seat0 (aces) wins it all.
    expect(committed).toBe(10);
    expect(r.showdown).toBe(true);
    expect(r.winners).toEqual([0]);

    // The corrected invariant: awards equal the POT, which is < startTotal here.
    expect(awardedTotal).toBe(committed);
    expect(awardedTotal).not.toBe(startTotal);

    // Conservation is on the STACKS, not the awards.
    expect(sumStacks(s)).toBe(startTotal);
    expect(s.players[0]!.stack).toBe(106); // 100 − 4 committed + 10 won
    expect(s.players[1]!.stack).toBe(96); //  100 − 4
    // The folded player's ante is in the pot it lost — it is down exactly 2.
    expect(s.players[2]!.stack).toBe(98); // 100 − 2 ante

    // The two equal-eligibility layers (ante level + blind level) merge into one
    // pot, and the folded player's dead ante is part of it.
    expect(r.pots).toHaveLength(1);
    expect(r.pots![0]).toEqual({ amount: 10, eligible: [0, 1], winners: [0] });
  });

  it("splits a multiway all-in pot on a tie, odd chip to the lowest seat", () => {
    // 3-handed, no ante, stacks [11,11,11]; everyone jams. seat0 & seat1 share
    // an identical pair of aces (tie); seat2 has kings. Pot 33 splits 17/16 with
    // the odd chip going to the lowest seat index (seat0).
    const fixedDeck: Card[] = [
      "As", "Ad", // seat0
      "Ac", "Ah", // seat1 — identical aces ⇒ ties seat0
      "Ks", "Kd", // seat2
      "2c", "7d", "9s", "Tc", "Jh", // board
    ];
    const used = new Set<string>(fixedDeck);
    const deck = [...fixedDeck, ...freshDeck().filter((c) => !used.has(c))];

    let s = createHand({
      handId: 2,
      seed: "regr-split",
      button: 2,
      smallBlind: 1,
      bigBlind: 2,
      ante: 0,
      players: players([11, 11, 11]),
      fixedDeck: deck,
    });
    let guard = 0;
    while (s.street !== "complete") {
      const l = getLegalActions(s);
      if (l.canRaise) s = applyAction(s, { type: "raise", to: l.maxTo });
      else if (l.canCall) s = applyAction(s, { type: "call" });
      else if (l.canCheck) s = applyAction(s, { type: "check" });
      else s = applyAction(s, { type: "fold" });
      if (++guard > 200) throw new Error("did not terminate");
    }

    const r = s.result!;
    expect(r.showdown).toBe(true);
    expect(r.winners).toEqual([0, 1]);

    // Single pot of 33, split with the odd chip to the lowest seat.
    expect(r.pots).toHaveLength(1);
    expect(r.pots![0]!.amount).toBe(33);
    expect(r.pots![0]!.winners).toEqual([0, 1]);
    expect(r.awarded[0]).toBe(17); // 16 + odd chip
    expect(r.awarded[1]).toBe(16);
    expect(r.awarded[2]).toBe(0);

    // The full pot is awarded (no half-pot lost on the split); chips conserved.
    const awardedTotal = (r.awarded as number[]).reduce((a, b) => a + b, 0);
    expect(awardedTotal).toBe(33);
    expect(sumStacks(s)).toBe(33);
  });
});
