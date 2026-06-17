import { describe, it, expect } from "vitest";
import { buildHandFrames } from "./replay.js";
import { botMeta, DEFAULT_SETUP } from "./bots.js";
import { playHand } from "@/sim/match.js";
import { heuristicFromPersonality } from "@/bots/heuristic.js";
import type { Bot } from "@/bots/types.js";

const bots = (): [Bot, Bot] => [
  heuristicFromPersonality("Cassius", "TAG", "r0"),
  heuristicFromPersonality("Vesper", "LAG", "r1"),
];

async function aHand(seed: string, handId: number) {
  return playHand(
    {
      handId,
      seed,
      button: 0,
      smallBlind: 1,
      bigBlind: 2,
      players: [
        { name: "Cassius", stack: 200 },
        { name: "Vesper", stack: 200 },
      ],
    },
    bots(),
  );
}

describe("replay frame reconstruction", () => {
  it("produces one frame per step and reconstructs the exact result", async () => {
    const meta = botMeta(DEFAULT_SETUP);
    // Find a hand that actually saw some action (not an instant fold).
    let log = await aHand("replaytest", 0);
    for (let i = 1; log.decisions.length < 3 && i < 50; i++) log = await aHand("replaytest", i);

    const frames = buildHandFrames(log, meta);
    expect(frames.length).toBe(log.decisions.length + 1);

    // Frame 0 = the deal: blinds in, no board, not complete.
    expect(frames[0]!.view.pot).toBe(3); // SB 1 + BB 2
    expect(frames[0]!.view.board).toHaveLength(0);
    expect(frames[0]!.view.isComplete).toBe(false);

    // Pot only grows as the hand progresses.
    for (let i = 1; i < frames.length; i++) {
      expect(frames[i]!.view.pot).toBeGreaterThanOrEqual(frames[i - 1]!.view.pot);
    }

    // Last frame matches the real outcome exactly.
    const last = frames.at(-1)!.view;
    expect(last.isComplete).toBe(true);
    expect(last.board).toEqual(log.state.board);
    expect(last.result?.net).toEqual(log.state.result!.net);
    expect(last.players[0].stack).toBe(log.state.players[0].stack);
    expect(last.players[1].stack).toBe(log.state.players[1].stack);
  });

  it("surfaces true equity on each frame", async () => {
    const meta = botMeta(DEFAULT_SETUP);
    const log = await aHand("equityframes", 3);
    const frames = buildHandFrames(log, meta);
    for (const f of frames) {
      expect(f.view.equity.true).not.toBeNull();
      const [a, b] = f.view.equity.true!;
      expect(a + b).toBeCloseTo(1, 5);
    }
  });
});
