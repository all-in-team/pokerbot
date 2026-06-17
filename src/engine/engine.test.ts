import { describe, it, expect } from "vitest";
import { createHand, applyAction, getLegalActions, type HandConfig } from "./engine.js";
import { pot, type GameState } from "./state.js";
import { freshDeck, type Card } from "./cards.js";

function cfg(overrides: Partial<HandConfig> = {}): HandConfig {
  return {
    handId: 1,
    seed: "test",
    button: 0,
    smallBlind: 1,
    bigBlind: 2,
    players: [
      { name: "A", stack: 200 },
      { name: "B", stack: 200 },
    ],
    ...overrides,
  };
}

/** Build a scripted deck: SB hole, BB hole, flop(3), turn, river, then filler. */
function deckFrom(
  sbHole: [string, string],
  bbHole: [string, string],
  board: [string, string, string, string, string],
): Card[] {
  const scripted = [...sbHole, ...bbHole, ...board] as Card[];
  const used = new Set(scripted);
  const filler = freshDeck().filter((x) => !used.has(x));
  return [...scripted, ...filler];
}

const totalChips = (s: GameState) => s.players[0].stack + s.players[1].stack;

describe("blind posting (heads-up)", () => {
  it("button posts the small blind and acts first preflop", () => {
    const s = createHand(cfg());
    expect(s.players[0].committedThisStreet).toBe(1); // button = SB
    expect(s.players[1].committedThisStreet).toBe(2); // other = BB
    expect(s.players[0].stack).toBe(199);
    expect(s.players[1].stack).toBe(198);
    expect(s.currentBet).toBe(2);
    expect(pot(s)).toBe(3);
    expect(s.toAct).toBe(0); // button/SB acts first preflop
    expect(s.street).toBe("preflop");
  });

  it("posting a blind does not consume the player's option to act", () => {
    const s = createHand(cfg());
    expect(s.players[0].actedThisStreet).toBe(false);
    expect(s.players[1].actedThisStreet).toBe(false);
  });
});

describe("legal actions preflop", () => {
  it("offers fold/call/raise to the small blind facing the big blind", () => {
    const l = getLegalActions(createHand(cfg()));
    expect(l.toCall).toBe(1);
    expect(l.canFold).toBe(true);
    expect(l.canCheck).toBe(false);
    expect(l.canCall).toBe(true);
    expect(l.callAmount).toBe(1);
    expect(l.canRaise).toBe(true);
    expect(l.canBet).toBe(false);
    expect(l.minTo).toBe(4); // currentBet(2) + lastRaise(2)
    expect(l.maxTo).toBe(200); // all-in shove
  });

  it("gives the big blind its option (check or raise) after a limp", () => {
    let s = createHand(cfg());
    s = applyAction(s, { type: "call" }); // SB limps
    expect(s.toAct).toBe(1); // BB still to act
    const l = getLegalActions(s);
    expect(l.toCall).toBe(0);
    expect(l.canCheck).toBe(true);
    expect(l.canFold).toBe(false);
    expect(l.canRaise).toBe(true);
    expect(l.minTo).toBe(4);
  });
});

describe("street progression", () => {
  it("limp + check advances to the flop with the big blind first to act", () => {
    let s = createHand(cfg());
    s = applyAction(s, { type: "call" }); // SB limp
    s = applyAction(s, { type: "check" }); // BB checks option
    expect(s.street).toBe("flop");
    expect(s.board).toHaveLength(3);
    expect(s.currentBet).toBe(0);
    expect(s.toAct).toBe(1); // BB (out of position) acts first postflop
    expect(pot(s)).toBe(4);
  });

  it("postflop offers check/bet when there is no bet to call", () => {
    let s = createHand(cfg());
    s = applyAction(s, { type: "call" });
    s = applyAction(s, { type: "check" });
    const l = getLegalActions(s);
    expect(l.canCheck).toBe(true);
    expect(l.canBet).toBe(true);
    expect(l.canRaise).toBe(false);
    expect(l.minTo).toBe(2); // min bet = one big blind
    expect(l.aggressiveType).toBe("bet");
  });

  it("plays through all four streets to showdown when both check it down", () => {
    let s = createHand(cfg());
    s = applyAction(s, { type: "call" }); // preflop
    s = applyAction(s, { type: "check" });
    // flop, turn, river: BB checks, SB checks
    for (const _ of ["flop", "turn", "river"]) {
      s = applyAction(s, { type: "check" });
      s = applyAction(s, { type: "check" });
    }
    expect(s.street).toBe("complete");
    expect(s.board).toHaveLength(5);
    expect(s.result?.showdown).toBe(true);
    expect(totalChips(s)).toBe(400);
  });
});

describe("min-raise rules", () => {
  it("enforces the minimum raise size and rejects undersized raises", () => {
    const s = createHand(cfg());
    expect(() => applyAction(s, { type: "raise", to: 3 })).toThrow();
    const s2 = applyAction(s, { type: "raise", to: 4 }); // legal min raise
    expect(s2.currentBet).toBe(4);
  });

  it("sets the next minimum re-raise to one full increment above the raise", () => {
    let s = createHand(cfg());
    s = applyAction(s, { type: "raise", to: 4 }); // raise increment = 2
    const l = getLegalActions(s); // BB to act
    expect(l.toAct).toBe(1);
    expect(l.minTo).toBe(6); // 4 + 2
    expect(() => applyAction(s, { type: "raise", to: 5 })).toThrow();
    const s2 = applyAction(s, { type: "raise", to: 6 });
    expect(s2.currentBet).toBe(6);
  });

  it("a 3-bet/4-bet war tracks increments correctly", () => {
    let s = createHand(cfg()); // cb 2, lr 2
    s = applyAction(s, { type: "raise", to: 6 }); // SB raise, increment 4 -> lr 4
    let l = getLegalActions(s);
    expect(l.minTo).toBe(10); // 6 + 4
    s = applyAction(s, { type: "raise", to: 14 }); // BB 3-bet, increment 8 -> lr 8
    l = getLegalActions(s);
    expect(l.minTo).toBe(22); // 14 + 8
  });
});

describe("fold resolution and uncalled bets", () => {
  it("awards the whole pot to the winner when the other folds", () => {
    let s = createHand(cfg());
    s = applyAction(s, { type: "raise", to: 6 }); // SB raises
    s = applyAction(s, { type: "fold" }); // BB folds
    expect(s.street).toBe("complete");
    expect(s.result?.showdown).toBe(false);
    expect(s.result?.winners).toEqual([0]);
    expect(s.result?.net).toEqual([2, -2]); // SB wins BB's 2 chips
    expect(s.players[0].stack).toBe(202);
    expect(s.players[1].stack).toBe(198);
    expect(totalChips(s)).toBe(400);
  });
});

describe("all-in, showdown and chip conservation", () => {
  it("runs the board out and resolves a shove/call showdown", () => {
    // SB = player 0 holds AA, BB = player 1 holds KK, dry board → SB wins.
    const fixedDeck = deckFrom(["As", "Ah"], ["Ks", "Kh"], ["2c", "7d", "9s", "Tc", "Jh"]);
    let s = createHand(cfg({ players: [{ name: "A", stack: 100 }, { name: "B", stack: 100 }], fixedDeck }));
    s = applyAction(s, { type: "raise", to: 100 }); // SB shoves
    s = applyAction(s, { type: "call" }); // BB calls all-in
    expect(s.street).toBe("complete");
    expect(s.board).toHaveLength(5);
    expect(s.result?.showdown).toBe(true);
    expect(s.result?.winners).toEqual([0]);
    expect(s.players[0].stack).toBe(200);
    expect(s.players[1].stack).toBe(0);
    expect(s.result?.net).toEqual([100, -100]);
    expect(totalChips(s)).toBe(200);
  });

  it("returns the uncalled portion when an all-in is called for less", () => {
    // SB has 100, BB has 50. SB shoves 100, BB calls all-in for 50.
    // 50 of SB's shove is uncalled and must be returned. SB (AA) wins.
    const fixedDeck = deckFrom(["As", "Ah"], ["Ks", "Kh"], ["2c", "7d", "9s", "Tc", "Jh"]);
    let s = createHand(cfg({ players: [{ name: "A", stack: 100 }, { name: "B", stack: 50 }], fixedDeck }));
    s = applyAction(s, { type: "raise", to: 100 }); // SB shoves 100
    s = applyAction(s, { type: "call" }); // BB calls all-in for 50
    expect(s.players[0].stack).toBe(150); // 50 refund + 100 contested
    expect(s.players[1].stack).toBe(0);
    expect(s.result?.net).toEqual([50, -50]);
    expect(totalChips(s)).toBe(150); // started 100 + 50
  });
});

describe("split pots", () => {
  it("splits the pot evenly when both players play the board", () => {
    // Both hold low cards; the board is broadway → both make A-K-Q-J-T.
    const fixedDeck = deckFrom(["2c", "3d"], ["2h", "3s"], ["As", "Ks", "Qd", "Jh", "Tc"]);
    let s = createHand(cfg({ players: [{ name: "A", stack: 100 }, { name: "B", stack: 100 }], fixedDeck }));
    s = applyAction(s, { type: "raise", to: 100 });
    s = applyAction(s, { type: "call" });
    expect(s.result?.showdown).toBe(true);
    expect(s.result?.winners).toEqual([0, 1]);
    expect(s.players[0].stack).toBe(100);
    expect(s.players[1].stack).toBe(100);
    expect(s.result?.net).toEqual([0, 0]);
    expect(totalChips(s)).toBe(200);
  });
});

describe("short all-in does not reopen betting", () => {
  it("prevents a re-raise after a sub-minimum all-in", () => {
    // Stacks chosen so a shove is less than a full re-raise over a prior raise.
    let s = createHand(
      cfg({ players: [{ name: "A", stack: 200 }, { name: "B", stack: 9 }] }),
    );
    // SB raises to 6 (increment 4 → next full raise would need +4 = to 10).
    s = applyAction(s, { type: "raise", to: 6 });
    // BB has only 9 chips total (2 already posted) → can shove to 9, an
    // increment of 3 over 6, which is LESS than the full raise increment (4).
    expect(s.toAct).toBe(1);
    s = applyAction(s, { type: "raise", to: 9 }); // short all-in
    expect(s.players[1].allIn).toBe(true);
    expect(s.bettingReopened).toBe(false);
    // SB faces the short shove: may call or fold, but NOT re-raise.
    expect(s.toAct).toBe(0);
    const l = getLegalActions(s);
    expect(l.canCall).toBe(true);
    expect(l.canRaise).toBe(false);
  });
});

describe("deterministic replay", () => {
  it("produces identical states from the same seed and actions", () => {
    const build = () => {
      let s = createHand(cfg({ seed: "replay-seed", handId: 7 }));
      s = applyAction(s, { type: "raise", to: 6 });
      s = applyAction(s, { type: "call" });
      s = applyAction(s, { type: "check" }); // flop, BB
      s = applyAction(s, { type: "bet", to: 8 }); // SB
      s = applyAction(s, { type: "call" });
      return s;
    };
    expect(JSON.stringify(build())).toEqual(JSON.stringify(build()));
  });
});
