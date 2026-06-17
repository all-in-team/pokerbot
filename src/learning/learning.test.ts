import { describe, it, expect } from "vitest";
import { applyDiff, defaultPlaybook, type PlaybookDiff } from "./playbook.js";
import { reflectOnSession } from "./coach.js";
import { MockLlmClient } from "../llm/mock.js";
import { computeHudStats, type HudStats } from "../sim/hud.js";
import { createReasoningBot } from "../bots/reasoning.js";
import { playSession } from "../sim/match.js";
import type { Bot } from "../bots/types.js";

function hudWith(overrides: Partial<HudStats>): HudStats {
  return { ...computeHudStats([], 0), ...overrides };
}

describe("playbook diff application", () => {
  it("bumps the version, applies changes, clamps, and appends notes", () => {
    const pb = defaultPlaybook("TAG");
    const diff: PlaybookDiff = {
      summary: "test",
      changes: [
        { path: "postflop.cbet", from: pb.postflop.cbet, to: 1.5, reason: "over-fold" }, // clamps to 1
        { path: "preflop.openSizeBb", from: 2.5, to: 3, reason: "bigger opens" },
      ],
      addedNotes: ["Villain folds too much."],
    };
    const next = applyDiff(pb, diff);
    expect(next.version).toBe(pb.version + 1);
    expect(next.postflop.cbet).toBe(1); // frequency clamped to [0,1]
    expect(next.preflop.openSizeBb).toBe(3);
    expect(next.notes.at(-1)).toBe("Villain folds too much.");
    expect(pb.postflop.cbet).not.toBe(1); // original untouched
  });
});

describe("mock coach reflection", () => {
  it("raises barreling frequencies against an over-folding opponent", async () => {
    const client = new MockLlmClient();
    const pb = defaultPlaybook("TAG");
    const diff = await client.reflect({
      playbook: pb,
      selfHud: hudWith({ hands: 30 }),
      opponentHud: hudWith({ hands: 30, foldToCbet: 0.62 }),
      net: 120,
      handsSummary: "",
      system: "",
      user: "",
    });
    const paths = diff.changes.map((c) => c.path);
    expect(paths).toContain("postflop.cbet");
    expect(paths).toContain("postflop.doubleBarrel");
    for (const c of diff.changes) expect(c.to).toBeGreaterThan(c.from);
    expect(diff.addedNotes.length).toBeGreaterThan(0);
  });

  it("cuts bluffs against a calling station", async () => {
    const client = new MockLlmClient();
    const diff = await client.reflect({
      playbook: defaultPlaybook("LAG"),
      selfHud: hudWith({ hands: 30 }),
      opponentHud: hudWith({ hands: 30, foldToCbet: 0.15 }),
      net: -40,
      handsSummary: "",
      system: "",
      user: "",
    });
    const bluffRaise = diff.changes.find((c) => c.path === "postflop.bluffRaise");
    expect(bluffRaise).toBeDefined();
    expect(bluffRaise!.to).toBeLessThan(bluffRaise!.from);
  });
});

describe("end-to-end learning loop (mock)", () => {
  it("produces a new playbook version from a played session", async () => {
    const client = new MockLlmClient();
    const pb0 = defaultPlaybook("TAG");
    const pb1 = defaultPlaybook("nit");
    const bots: [Bot, Bot] = [
      createReasoningBot({ name: "TAG", client, getPlaybook: () => pb0, getOpponentHud: () => computeHudStats([], 1) }),
      createReasoningBot({ name: "nit", client, getPlaybook: () => pb1, getOpponentHud: () => computeHudStats([], 0) }),
    ];
    const session = await playSession(
      { seed: "learn", smallBlind: 1, bigBlind: 2, startingStacks: [200, 200], hands: 60, rebuy: true },
      bots,
    );

    const res = await reflectOnSession(client, pb0, 0, session.hands);
    expect(res.newPlaybook.version).toBe(2);
    expect(res.selfHud.hands).toBe(60);
    expect(typeof res.diff.summary).toBe("string");
    // net is consistent with the session result for seat 0.
    expect(res.net).toBe(session.net[0]);
  });
});
