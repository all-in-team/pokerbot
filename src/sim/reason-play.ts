/**
 * Reasoning agents + learning loop (Phases 4–5), headless.
 *
 * Two reasoning bots play several sessions; after each session the coach reflects
 * on the hands and diffs each bot's playbook. Playbook versions and per-session
 * stats are stored so the learning timeline can chart strategy evolution.
 *
 *   tsx src/sim/reason-play.ts --sessions 4 --hands 60 --p0 TAG --p1 maniac
 *
 * Uses the live Anthropic client when ANTHROPIC_API_KEY is set, otherwise the
 * offline mock. Flags: --sessions N --hands M --p0 <pers> --p1 <pers> --seed S
 *        --stacks N --mock (force offline) --no-db
 */

import { playHand } from "./match.js";
import { computeHudStats, handLogToStats, formatHud, type HandForStats, type HudStats } from "./hud.js";
import { createReasoningBot } from "../bots/reasoning.js";
import { defaultPlaybook, type Playbook } from "../learning/playbook.js";
import { reflectOnSession } from "../learning/coach.js";
import { getLlmClient } from "../llm/index.js";
import { PERSONALITIES, type PersonalityName } from "../bots/heuristic.js";
import {
  openDb,
  insertMatch,
  insertHands,
  insertPlaybookVersion,
  insertSessionStats,
} from "../db/db.js";
import type { Seat } from "../engine/state.js";
import type { HandLog } from "./match.js";

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : fallback;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

async function main() {
  const sessions = parseInt(arg("sessions", "4"), 10);
  const handsPerSession = parseInt(arg("hands", "50"), 10);
  const seed = arg("seed", "reason");
  const p0 = arg("p0", "TAG") as PersonalityName;
  const p1 = arg("p1", "LAG") as PersonalityName;
  const startingStack = parseInt(arg("stacks", "200"), 10);
  const sb = 1;
  const bb = 2;
  const useDb = !flag("no-db");

  const client = getLlmClient({ forceMock: flag("mock") });
  console.log(`\n♠ Reasoning agents · ${client.live ? "LIVE Anthropic API" : "offline MOCK client"}`);
  console.log(`  ${sessions} sessions × ${handsPerSession} hands · ${p0} vs ${p1}\n`);

  // Per-bot mutable strategy + live opponent-HUD references.
  const playbooks: [Playbook, Playbook] = [defaultPlaybook(p0), defaultPlaybook(p1)];
  const hudRef: [HudStats, HudStats] = [computeHudStats([], 0), computeHudStats([], 1)];
  const names: [string, string] = [`${p0}-0`, `${p1}-1`];

  const bots = [0, 1].map((seat) =>
    createReasoningBot({
      name: names[seat]!,
      style: seat === 0 ? PERSONALITIES[p0].style : PERSONALITIES[p1].style,
      client,
      getPlaybook: () => playbooks[seat as Seat],
      getOpponentHud: () => hudRef[(seat === 0 ? 1 : 0) as Seat],
    }),
  ) as [ReturnType<typeof createReasoningBot>, ReturnType<typeof createReasoningBot>];

  const db = useDb ? openDb() : null;
  const matchId = db
    ? insertMatch(db, {
        seed,
        smallBlind: sb,
        bigBlind: bb,
        startingStack,
        bot0Name: names[0],
        bot1Name: names[1],
        bot0Style: p0,
        bot1Style: p1,
        mode: client.live ? "reasoning" : "reasoning-mock",
        config: { sessions, handsPerSession },
      })
    : 0;

  // Record the starting playbooks (version 1).
  if (db) {
    for (const seat of [0, 1] as Seat[]) {
      insertPlaybookVersion(db, {
        matchId,
        botSeat: seat,
        botName: names[seat],
        version: playbooks[seat].version,
        sessionIndex: -1,
        playbook: playbooks[seat],
        diffText: "initial playbook",
      });
    }
  }

  let handIdGlobal = 0;
  for (let s = 0; s < sessions; s++) {
    let button: Seat = (s % 2) as Seat;
    const logs: HandLog[] = [];
    const stats: HandForStats[] = [];

    for (let h = 0; h < handsPerSession; h++) {
      hudRef[0] = computeHudStats(stats, 0);
      hudRef[1] = computeHudStats(stats, 1);
      const log = await playHand(
        {
          handId: handIdGlobal++,
          seed,
          button,
          smallBlind: sb,
          bigBlind: bb,
          players: [
            { name: names[0], stack: startingStack },
            { name: names[1], stack: startingStack },
          ],
        },
        bots,
      );
      logs.push(log);
      stats.push(handLogToStats(log));
      button = (button === 0 ? 1 : 0) as Seat;
    }

    if (db) insertHands(db, matchId, logs, s);

    // Coach reflection for both bots.
    const summaries: string[] = [];
    for (const seat of [0, 1] as Seat[]) {
      const res = await reflectOnSession(client, playbooks[seat], seat, logs);
      playbooks[seat] = res.newPlaybook;
      if (db) {
        insertPlaybookVersion(db, {
          matchId,
          botSeat: seat,
          botName: names[seat],
          version: res.newPlaybook.version,
          sessionIndex: s,
          playbook: res.newPlaybook,
          diffText: JSON.stringify(res.diff),
        });
        insertSessionStats(db, {
          matchId,
          sessionIndex: s,
          botSeat: seat,
          botName: names[seat],
          hands: res.selfHud.hands,
          netChips: res.net,
          bbPer100: res.selfHud.winRateBb100,
          stats: res.selfHud,
        });
      }
      summaries.push(`${names[seat]} (${res.net >= 0 ? "+" : ""}${(res.net / bb).toFixed(0)}bb): ${res.diff.summary}`);
    }

    const s0 = computeHudStats(stats, 0);
    const s1 = computeHudStats(stats, 1);
    console.log(`── Session ${s + 1}/${sessions} ──`);
    console.log(`   ${formatHud(names[0], s0)}`);
    console.log(`   ${formatHud(names[1], s1)}`);
    for (const sum of summaries) console.log(`   coach → ${sum}`);
    console.log("");
  }

  console.log(`Final playbook versions: ${names[0]} v${playbooks[0].version}, ${names[1]} v${playbooks[1].version}`);
  console.log(`${names[0]} now: c-bet ${(playbooks[0].postflop.cbet * 100) | 0}%, double-barrel ${(playbooks[0].postflop.doubleBarrel * 100) | 0}%, bluff-raise ${(playbooks[0].postflop.bluffRaise * 100) | 0}%`);
  if (db) {
    console.log(`\nLogged match #${matchId} (hands + ${sessions + 1} playbook versions/bot) → ${process.env.DATABASE_PATH ?? "./data/poker.db"}`);
    db.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
