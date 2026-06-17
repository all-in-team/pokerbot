/**
 * The learning loop. After a session, the coach reviews the hand histories and
 * opponent reads and produces a diff to the bot's playbook (e.g. "villain
 * over-folds to turn barrels → raise double-barrel frequency"). Applying the
 * diff bumps the playbook version; storing versions is what the learning
 * timeline charts over time.
 */

import { applyDiff, type Playbook, type PlaybookDiff } from "./playbook.js";
import { buildReflectionPrompt } from "../llm/prompts.js";
import { computeHudStats, handLogToStats, type HudStats } from "../sim/hud.js";
import { boardAtStreet } from "../sim/truth.js";
import type { LlmClient } from "../llm/types.js";
import type { HandLog } from "../sim/match.js";
import type { Seat } from "../engine/state.js";

/** Compact text of the most consequential hands for the reflecting seat. */
export function summarizeHands(logs: HandLog[], seat: Seat, limit = 8): string {
  const ranked = [...logs]
    .map((log) => ({ log, swing: Math.abs(log.state.result!.net[seat]) }))
    .sort((a, b) => b.swing - a.swing)
    .slice(0, limit);

  if (ranked.length === 0) return "(no hands played)";

  return ranked
    .map(({ log }) => {
      const r = log.state.result!;
      const net = r.net[seat];
      const hole = log.holeCards[seat].join(" ");
      const board = log.state.board.length ? log.state.board.join(" ") : "no flop";
      const acts = log.decisions
        .map((d) => `${d.seat === seat ? "me" : "opp"} ${d.action.type}${"to" in d.action ? ` ${d.action.to}` : ""}`)
        .join(", ");
      const outcome = r.showdown
        ? `showdown (${r.handDescr?.[seat] ?? "?"})`
        : net > 0
          ? "won uncontested"
          : "folded";
      return `- ${hole} on [${board}] → ${net >= 0 ? "+" : ""}${net}, ${outcome}. line: ${acts}`;
    })
    .join("\n");
}

export interface ReflectionResult {
  diff: PlaybookDiff;
  newPlaybook: Playbook;
  selfHud: HudStats;
  opponentHud: HudStats;
  net: number;
}

/** Run the coach reflection pass for one bot over a session's hands. */
export async function reflectOnSession(
  client: LlmClient,
  playbook: Playbook,
  seat: Seat,
  logs: HandLog[],
): Promise<ReflectionResult> {
  const stats = logs.map(handLogToStats);
  const selfHud = computeHudStats(stats, seat);
  const opponentHud = computeHudStats(stats, (seat === 0 ? 1 : 0) as Seat);
  const net = logs.reduce((sum, l) => sum + l.state.result!.net[seat], 0);
  const handsSummary = summarizeHands(logs, seat);

  const { system, user } = buildReflectionPrompt(playbook, selfHud, opponentHud, net, handsSummary);
  const diff = await client.reflect({ playbook, selfHud, opponentHud, net, handsSummary, system, user });
  const newPlaybook = applyDiff(playbook, diff);

  return { diff, newPlaybook, selfHud, opponentHud, net };
}

// boardAtStreet is re-exported for callers that want per-decision context.
export { boardAtStreet };
