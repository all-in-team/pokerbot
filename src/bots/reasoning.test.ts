import { describe, it, expect } from "vitest";
import { createReasoningBot } from "./reasoning.js";
import { MockLlmClient } from "../llm/mock.js";
import { defaultPlaybook } from "../learning/playbook.js";
import { computeHudStats } from "../sim/hud.js";
import { playSession } from "../sim/match.js";
import type { Bot } from "./types.js";

function reasoningBots(): [Bot, Bot] {
  const client = new MockLlmClient();
  const pb0 = defaultPlaybook("TAG");
  const pb1 = defaultPlaybook("LAG");
  const emptyHud0 = computeHudStats([], 0);
  const emptyHud1 = computeHudStats([], 1);
  return [
    createReasoningBot({ name: "TAG", style: "TAG", client, getPlaybook: () => pb0, getOpponentHud: () => emptyHud1 }),
    createReasoningBot({ name: "LAG", style: "LAG", client, getPlaybook: () => pb1, getOpponentHud: () => emptyHud0 }),
  ];
}

describe("reasoning bot (offline mock)", () => {
  it("plays a full session legally with captured reasoning", async () => {
    const result = await playSession(
      { seed: "reason", smallBlind: 1, bigBlind: 2, startingStacks: [200, 200], hands: 120, rebuy: true },
      reasoningBots(),
    );
    expect(result.handsPlayed).toBe(120);
    expect(result.net[0] + result.net[1]).toBe(0); // zero-sum

    for (const log of result.hands) {
      const start = log.config.players[0].stack + log.config.players[1].stack;
      const end = log.state.players[0].stack + log.state.players[1].stack;
      expect(end).toBe(start); // chips conserved
    }
    // Every decision carries a reasoning string + perceived-equity read.
    const sample = result.hands.flatMap((h) => h.decisions);
    expect(sample.length).toBeGreaterThan(0);
    expect(sample.every((d) => typeof d.reasoning === "string" && d.reasoning.length > 0)).toBe(true);
  });

  it("is deterministic for the same seed (mock client)", async () => {
    const run = () =>
      playSession(
        { seed: "det", smallBlind: 1, bigBlind: 2, startingStacks: [200, 200], hands: 40, rebuy: true },
        reasoningBots(),
      );
    const a = await run();
    const b = await run();
    expect(a.net).toEqual(b.net);
  });
});
