/**
 * Headless self-play driver (Phase 2).
 *
 * Two heuristic bots play a session of hands through the engine; every hand is
 * logged to SQLite, and chip conservation is verified across the whole run.
 *
 *   tsx src/sim/selfplay.ts --hands 1000 --p0 TAG --p1 LAG --seed demo
 *
 * Flags: --hands N  --seed S  --p0 <TAG|LAG|nit|maniac>  --p1 <...>
 *        --stacks N  --sb N  --bb N  --carry (carry stacks; default re-buys)  --no-db
 */

import { playSession } from "./match.js";
import { heuristicFromPersonality, type PersonalityName } from "../bots/heuristic.js";
import { openDb, insertMatch, insertHands, countHands } from "../db/db.js";
import { computeHudStats, handLogToStats, formatHud } from "./hud.js";
import { annotateHandTruth } from "./truth.js";

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : fallback;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

async function main() {
  const hands = parseInt(arg("hands", "1000"), 10);
  const seed = arg("seed", "selfplay");
  const p0 = arg("p0", "TAG") as PersonalityName;
  const p1 = arg("p1", "LAG") as PersonalityName;
  const startingStack = parseInt(arg("stacks", "200"), 10);
  const sb = parseInt(arg("sb", "1"), 10);
  const bb = parseInt(arg("bb", "2"), 10);
  const carry = flag("carry");
  const useDb = !flag("no-db");

  const bots: [ReturnType<typeof heuristicFromPersonality>, ReturnType<typeof heuristicFromPersonality>] = [
    heuristicFromPersonality(`${p0}-0`, p0, `${seed}:bot0`),
    heuristicFromPersonality(`${p1}-1`, p1, `${seed}:bot1`),
  ];

  console.log(`\n♠ Self-play: ${bots[0].name} vs ${bots[1].name}`);
  console.log(`  ${hands} hands · blinds ${sb}/${bb} · stacks ${startingStack} · ${carry ? "carried stacks" : "re-buy each hand"}\n`);

  const t0 = Date.now();
  const result = await playSession(
    { seed, smallBlind: sb, bigBlind: bb, startingStacks: [startingStack, startingStack], hands, rebuy: !carry },
    bots,
  );
  const ms = Date.now() - t0;

  // --- Verify chip conservation across the whole session ---
  let conservedHands = 0;
  let zeroSum = true;
  let showdowns = 0;
  for (const log of result.hands) {
    const startTotal = log.config.players[0].stack + log.config.players[1].stack;
    const endTotal = log.state.players[0].stack + log.state.players[1].stack;
    if (startTotal === endTotal) conservedHands++;
    if (log.state.result!.net[0] + log.state.result!.net[1] !== 0) zeroSum = false;
    if (log.state.result!.showdown) showdowns++;
  }
  const allConserved = conservedHands === result.handsPlayed && zeroSum;

  const bbWon = (net: number) => (net / bb).toFixed(1);
  const bb100 = (net: number) => ((net / bb) / result.handsPlayed * 100).toFixed(2);

  console.log(`Played ${result.handsPlayed} hands in ${ms}ms (${(result.handsPlayed / (ms / 1000)).toFixed(0)} hands/s)`);
  console.log(`Showdowns: ${showdowns} (${((showdowns / result.handsPlayed) * 100).toFixed(1)}%)`);
  console.log(`Net: ${bots[0].name} ${result.net[0] >= 0 ? "+" : ""}${result.net[0]} chips (${bbWon(result.net[0])} bb, ${bb100(result.net[0])} bb/100)`);
  console.log(`     ${bots[1].name} ${result.net[1] >= 0 ? "+" : ""}${result.net[1]} chips (${bbWon(result.net[1])} bb, ${bb100(result.net[1])} bb/100)`);
  console.log(`\nChip conservation: ${allConserved ? "✓ PASS" : "✗ FAIL"} (${conservedHands}/${result.handsPlayed} hands balanced, zero-sum=${zeroSum})`);

  // --- HUD stats (Phase 3) ---
  const stats = result.hands.map(handLogToStats);
  console.log(`\nHUD:`);
  console.log(`  ${formatHud(bots[0].name, computeHudStats(stats, 0))}`);
  console.log(`  ${formatHud(bots[1].name, computeHudStats(stats, 1))}`);

  // --- Truth layer demo: perceived vs. true equity on one showdown hand ---
  const sample = result.hands.find((h) => h.state.result!.showdown && h.decisions.length >= 3);
  if (sample) {
    const truth = annotateHandTruth(sample, { iterations: 3000 });
    console.log(`\nPerceived vs. true equity (hand #${sample.config.handId}, board ${sample.state.board.join(" ")}):`);
    for (const t of truth) {
      const d = sample.decisions[t.decisionIndex]!;
      const perceived = t.perceivedEquity !== undefined ? `${(t.perceivedEquity * 100).toFixed(0)}%` : "—";
      const delta = t.misreadDelta !== undefined ? `${t.misreadDelta >= 0 ? "+" : ""}${(t.misreadDelta * 100).toFixed(0)}%` : "";
      console.log(
        `  ${t.street.padEnd(7)} seat${t.seat} ${d.action.type.padEnd(5)} | perceived ${perceived.padStart(4)} · true ${(t.trueEquity * 100).toFixed(0).padStart(3)}%${t.exact ? "" : "~"} | misread ${delta}`,
      );
    }
  }

  if (useDb) {
    const db = openDb();
    const matchId = insertMatch(db, {
      seed,
      smallBlind: sb,
      bigBlind: bb,
      startingStack,
      bot0Name: bots[0].name,
      bot1Name: bots[1].name,
      bot0Style: p0,
      bot1Style: p1,
      mode: "heuristic",
      config: { hands, carry },
    });
    insertHands(db, matchId, result.hands, 0);
    console.log(`\nLogged match #${matchId} with ${countHands(db, matchId)} hands → ${process.env.DATABASE_PATH ?? "./data/poker.db"}`);
    db.close();
  }

  if (!allConserved) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
