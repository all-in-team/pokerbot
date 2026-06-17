import { describe, it, expect } from "vitest";
import { playHand, playSession } from "./match.js";
import { heuristicFromPersonality } from "../bots/heuristic.js";
import type { Bot } from "../bots/types.js";

const bots = (): [Bot, Bot] => [
  heuristicFromPersonality("TAG", "TAG", "s0"),
  heuristicFromPersonality("LAG", "LAG", "s1"),
];

describe("match runner with heuristic bots", () => {
  it("plays a single hand to completion with captured decisions", async () => {
    const log = await playHand(
      {
        handId: 0,
        seed: "m",
        button: 0,
        smallBlind: 1,
        bigBlind: 2,
        players: [
          { name: "TAG", stack: 200 },
          { name: "LAG", stack: 200 },
        ],
      },
      bots(),
    );
    expect(log.state.street).toBe("complete");
    expect(log.state.result).not.toBeNull();
    expect(log.decisions.length).toBeGreaterThan(0);
    // Each decision carries reasoning + a perceived-equity read for the UI.
    expect(log.decisions[0]!.reasoning).toBeTruthy();
    expect(typeof log.decisions[0]!.perceivedEquity).toBe("number");
  });

  it("plays a 300-hand session that stays zero-sum and chip-conserving", async () => {
    const result = await playSession(
      {
        seed: "session",
        smallBlind: 1,
        bigBlind: 2,
        startingStacks: [200, 200],
        hands: 300,
        rebuy: true,
      },
      bots(),
    );
    expect(result.handsPlayed).toBe(300);
    expect(result.net[0] + result.net[1]).toBe(0);
    for (const log of result.hands) {
      const start = log.config.players[0].stack + log.config.players[1].stack;
      const end = log.state.players[0].stack + log.state.players[1].stack;
      expect(end).toBe(start);
    }
  });

  it("is deterministic for the same seed", async () => {
    const run = () =>
      playSession(
        { seed: "det", smallBlind: 1, bigBlind: 2, startingStacks: [200, 200], hands: 50, rebuy: true },
        bots(),
      );
    const a = await run();
    const b = await run();
    expect(a.net).toEqual(b.net);
  });
});
