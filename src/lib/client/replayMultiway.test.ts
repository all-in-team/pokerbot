import { describe, it, expect } from "vitest";
import { runWatchSession } from "./watchSim.js";
import { replayMultiway } from "./replayMultiway.js";

describe("replayMultiway", () => {
  it("produces a coherent frame sequence whose award frame matches the result", async () => {
    const logs = await runWatchSession({ seats: 6, hands: 1, seed: "frames-test" });
    const log = logs[0]!;
    const frames = replayMultiway(log);
    const r = log.state.result!;

    // deal + one per action + (showdown beat?) + award.
    const expected = log.decisions.length + 1 + (r.showdown ? 2 : 1);
    expect(frames.length).toBe(expected);

    // First frame: the deal — all hole cards present but hidden.
    expect(frames[0]!.kind).toBe("deal");
    expect(frames[0]!.seats).toHaveLength(6);
    for (const s of frames[0]!.seats) {
      expect(s.cards).toHaveLength(2);
      expect(s.revealed).toBe(false);
    }

    // Last frame: award — winners highlighted, final stacks restored, and the
    // pot still shows the amount won (the climax displays the sum, never "0").
    const last = frames[frames.length - 1]!;
    expect(last.kind).toBe("award");
    const totalPot = log.state.players.reduce((a, p) => a + p.committedTotal, 0);
    expect(last.pot).toBe(totalPot);
    expect(last.pot).toBeGreaterThan(0);
    const winnerSeats = last.seats.filter((s) => s.isWinner).map((s) => s.seat).sort((a, b) => a - b);
    expect(winnerSeats).toEqual([...r.winners].sort((a, b) => a - b));
    for (const s of last.seats) {
      expect(s.stack).toBe(log.state.players[s.seat]!.stack);
    }
    // No ghost bet chips linger in front of anyone at the award (all collected).
    expect(last.seats.every((s) => s.bet === 0)).toBe(true);

    // If it went to showdown, the showdown beat reveals the live hands.
    if (r.showdown) {
      const sd = frames.find((f) => f.kind === "showdown")!;
      expect(sd).toBeDefined();
      const revealed = sd.seats.filter((s) => s.revealed);
      expect(revealed.length).toBeGreaterThanOrEqual(2);
      for (const s of revealed) expect(s.folded).toBe(false);
    }
  });

  it("stays coherent across hands and table sizes (2, 3, 6)", async () => {
    for (const seats of [2, 3, 6]) {
      const logs = await runWatchSession({ seats, hands: 3, seed: `frames-${seats}` });
      for (const log of logs) {
        const frames = replayMultiway(log);
        expect(frames.length).toBeGreaterThan(1);
        expect(frames[0]!.seats).toHaveLength(seats);

        const last = frames[frames.length - 1]!;
        expect(last.kind).toBe("award");
        // Award-frame stacks equal the engine's final stacks (chips reconcile).
        const frameTotal = last.seats.reduce((a, s) => a + s.stack, 0);
        const engineTotal = log.state.players.reduce((a, p) => a + p.stack, 0);
        expect(frameTotal).toBe(engineTotal);
      }
    }
  });
});
