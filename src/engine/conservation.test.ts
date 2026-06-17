import { describe, it, expect } from "vitest";
import { createHand, applyAction, getLegalActions } from "./engine.js";
import type { LegalActions } from "./actions.js";
import type { ActionInput } from "./actions.js";
import { createRng, type Rng } from "./rng.js";
import { type GameState, type Seat } from "./state.js";

/** A random-but-legal policy: exercises every code path in the engine. */
function randomAction(l: LegalActions, rng: Rng): ActionInput {
  const options: ActionInput[] = [];
  if (l.canCheck) options.push({ type: "check" });
  if (l.canCall) options.push({ type: "call" });
  // Fold less often so plenty of hands reach later streets / showdown.
  if (l.canFold && rng.next() < 0.25) options.push({ type: "fold" });
  if (l.canBet || l.canRaise) {
    const span = l.maxTo - l.minTo;
    const to = l.minTo + (span > 0 ? rng.int(span + 1) : 0);
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
    if (++guard > 200) throw new Error("hand did not terminate");
  }
  return s;
}

describe("chip conservation (fuzz)", () => {
  it("conserves chips across 1000 independent random hands", () => {
    const rng = createRng("fuzz-master");
    let sawShowdown = false;
    let sawFold = false;
    for (let i = 0; i < 1000; i++) {
      const start = 100 + rng.int(400);
      const s = playOut(
        createHand({
          handId: i,
          seed: "fuzz",
          button: (i % 2) as Seat,
          smallBlind: 1,
          bigBlind: 2,
          players: [
            { name: "A", stack: start },
            { name: "B", stack: start },
          ],
        }),
        rng,
      );
      expect(s.players[0].stack + s.players[1].stack).toBe(start * 2);
      expect(s.result).not.toBeNull();
      // Each player's net must equal awarded minus what they put in.
      expect(s.result!.net[0]).toBe(s.result!.awarded[0] - s.players[0].committedTotal);
      if (s.result!.showdown) sawShowdown = true;
      else sawFold = true;
    }
    // Sanity: the fuzzer actually exercised both endings.
    expect(sawShowdown).toBe(true);
    expect(sawFold).toBe(true);
  });

  it("conserves chips across a full carried-stack match (button alternates)", () => {
    const rng = createRng("match-rng");
    const startTotal = 400;
    let stacks: [number, number] = [200, 200];
    let button: Seat = 0;
    let handsPlayed = 0;

    for (let h = 0; h < 500; h++) {
      // Stop if a player cannot post the big blind.
      if (Math.min(stacks[0], stacks[1]) < 2) break;
      const s = playOut(
        createHand({
          handId: h,
          seed: "match",
          button,
          smallBlind: 1,
          bigBlind: 2,
          players: [
            { name: "A", stack: stacks[0] },
            { name: "B", stack: stacks[1] },
          ],
        }),
        rng,
      );
      stacks = [s.players[0].stack, s.players[1].stack];
      expect(stacks[0] + stacks[1]).toBe(startTotal); // conserved every hand
      button = (button === 0 ? 1 : 0) as Seat;
      handsPlayed++;
    }
    expect(handsPlayed).toBeGreaterThan(0);
    expect(stacks[0] + stacks[1]).toBe(startTotal);
  });
});
