import { describe, it, expect } from "vitest";
import { playRingSession } from "./match.js";
import { heuristicFromPersonality, type PersonalityName } from "../bots/heuristic.js";
import type { Bot } from "../bots/types.js";

const PERS: PersonalityName[] = ["TAG", "LAG", "nit", "maniac", "TAG", "LAG"];

function seatBots(n: number, seed: string): Bot[] {
  return Array.from({ length: n }, (_, i) => {
    const p = PERS[i % PERS.length]!;
    return heuristicFromPersonality(`${p}-${i}`, p, `${seed}:${i}`);
  });
}

describe("6-max heuristic session", () => {
  it("plays a full 6-max session, conserving chips with well-formed logs", async () => {
    const n = 6;
    const stack = 200;
    const res = await playRingSession(
      {
        seed: "ring6",
        smallBlind: 1,
        bigBlind: 2,
        ante: 2,
        startingStacks: Array.from({ length: n }, () => stack),
        hands: 60,
        rebuy: true,
      },
      seatBots(n, "ring6"),
    );

    expect(res.handsPlayed).toBe(60);
    expect(res.hands).toHaveLength(60);

    let sawShowdown = false;
    for (const log of res.hands) {
      // Well-formed 6-max log.
      expect(log.state.street).toBe("complete");
      expect(log.state.result).not.toBeNull();
      expect(log.holeCards).toHaveLength(n);
      for (const hc of log.holeCards) expect(hc).toHaveLength(2);
      const r = log.state.result!;
      expect(r.awarded).toHaveLength(n);
      expect(r.net).toHaveLength(n);

      // Conservation: chips in === chips out, and the hand is zero-sum.
      const startTotal = log.config.players.reduce((a, p) => a + p.stack, 0);
      const endTotal = log.state.players.reduce((a, p) => a + p.stack, 0);
      expect(endTotal).toBe(startTotal);
      expect(r.net.reduce((a, b) => a + b, 0)).toBe(0);

      if (r.showdown) sawShowdown = true;
    }

    // The session genuinely reached showdowns. (Multiway side-pot correctness is
    // covered deterministically in engine/multiway.test.ts.)
    expect(sawShowdown).toBe(true);
    // Whole session is zero-sum.
    expect(res.net.reduce((a, b) => a + b, 0)).toBe(0);
  });

  it("conserves chips for every table size 2..6", async () => {
    for (let n = 2; n <= 6; n++) {
      const res = await playRingSession(
        {
          seed: `ring-${n}`,
          smallBlind: 1,
          bigBlind: 2,
          ante: 2,
          startingStacks: Array.from({ length: n }, () => 150),
          hands: 30,
          rebuy: true,
        },
        seatBots(n, `ring-${n}`),
      );
      expect(res.handsPlayed).toBe(30);
      for (const log of res.hands) {
        const startTotal = log.config.players.reduce((a, p) => a + p.stack, 0);
        const endTotal = log.state.players.reduce((a, p) => a + p.stack, 0);
        expect(endTotal).toBe(startTotal);
        expect(log.holeCards).toHaveLength(n);
        expect(log.state.result!.net.reduce((a, b) => a + b, 0)).toBe(0);
      }
    }
  });
});
