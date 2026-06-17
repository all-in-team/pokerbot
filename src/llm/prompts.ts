/**
 * Prompt construction for the reasoning agents and the coach. Kept separate so
 * both the live and mock clients share the exact same context framing.
 */

import type { DecisionView } from "../bots/types.js";
import type { HudStats } from "../sim/hud.js";
import type { Playbook } from "../learning/playbook.js";

const pct = (x: number) => `${Math.round(x * 100)}%`;

function hudLine(h: HudStats): string {
  if (h.hands === 0) return "no reads yet (first hands)";
  return (
    `${h.hands} hands · VPIP ${pct(h.vpip)} · PFR ${pct(h.pfr)} · 3bet ${pct(h.threeBet)} · ` +
    `AF ${h.af.toFixed(1)} · fold-to-cbet ${pct(h.foldToCbet)} · WTSD ${pct(h.wtsd)}`
  );
}

function playbookSummary(pb: Playbook): string {
  const p = pb.preflop;
  const f = pb.postflop;
  return [
    `Playbook v${pb.version} (${pb.style}):`,
    `  preflop: open ${pct(p.openRaise)}, 3bet ${pct(p.threeBet)}, call-vs-open ${pct(p.callVsOpen)}, open ${p.openSizeBb}bb, 3bet ${p.threeBetX}x`,
    `  postflop: c-bet ${pct(f.cbet)}, double-barrel ${pct(f.doubleBarrel)}, bluff-raise ${pct(f.bluffRaise)}, value ${f.valueSizing}x pot, bluff ${f.bluffSizing}x pot`,
    pb.notes.length ? `  notes:\n${pb.notes.map((n) => `    - ${n}`).join("\n")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function legalMenu(view: DecisionView): string {
  const l = view.legal;
  const parts: string[] = [];
  if (l.canFold) parts.push("fold");
  if (l.canCheck) parts.push("check");
  if (l.canCall) parts.push(`call ${l.callAmount}`);
  if (l.canBet || l.canRaise) parts.push(`${l.aggressiveType} to [${l.minTo}..${l.maxTo}] (sizing = total this street)`);
  return parts.join(" · ");
}

function historyLine(view: DecisionView): string {
  const acts = view.actionHistory
    .filter((a) => a.type !== "post-sb" && a.type !== "post-bb")
    .map((a) => `${a.seat === view.seat ? "you" : "villain"} ${a.type}${a.amount ? ` ${a.amount}` : ""} (${a.street})`);
  return acts.length ? acts.join(", ") : "no voluntary action yet";
}

export function buildDecisionPrompt(
  view: DecisionView,
  playbook: Playbook,
  opponentHud: HudStats,
): { system: string; user: string } {
  const system =
    `You are a world-class heads-up No-Limit Texas Hold'em player with a ${playbook.style} style. ` +
    `You are playing one hand at a time against a single opponent. Decide your action and return it as JSON ` +
    `matching the required schema: { action, sizing, confidence (0-1), reasoning (1-2 sentences), perceivedEquity (0-1) }. ` +
    `For bet/raise, "sizing" is the TOTAL chips you will have committed on this street (the "to" amount) and must be within the legal range. ` +
    `Use your playbook as a baseline but exploit the opponent's tendencies. Be decisive; reasoning must be concrete.`;

  const user = [
    `Street: ${view.street}   Position: ${view.position === "button" ? "button (in position postflop)" : "big blind (out of position)"}`,
    `Your hole cards: ${view.holeCards.join(" ")}`,
    `Board: ${view.board.length ? view.board.join(" ") : "(preflop)"}`,
    `Pot: ${view.pot} (${(view.pot / view.bigBlind).toFixed(1)}bb)   To call: ${view.toCall}`,
    `Your stack: ${view.myStack}   Villain stack: ${view.oppStack}   Big blind: ${view.bigBlind}`,
    `Action this hand: ${historyLine(view)}`,
    `Legal actions: ${legalMenu(view)}`,
    ``,
    playbookSummary(playbook),
    ``,
    `Opponent read: ${hudLine(opponentHud)}`,
    ``,
    `Return your decision as JSON.`,
  ].join("\n");

  return { system, user };
}

export function buildReflectionPrompt(
  playbook: Playbook,
  selfHud: HudStats,
  opponentHud: HudStats,
  net: number,
  handsSummary: string,
): { system: string; user: string } {
  const system =
    `You are a poker coach reviewing a session of heads-up No-Limit Hold'em your student just played. ` +
    `Produce a concrete diff to their playbook that exploits the opponent's leaks and fixes the student's own mistakes. ` +
    `Return JSON: { summary, changes: [{ path, from, to, reason }], addedNotes: [string] }. ` +
    `"path" must be one of the tunable numeric playbook fields. Frequencies are 0-1; sizes are multipliers. ` +
    `Only propose changes you can justify from the data. Prefer a few high-confidence adjustments over many speculative ones.`;

  const user = [
    `Session result for your student: ${net >= 0 ? "+" : ""}${net} chips.`,
    ``,
    `Student stats: ${hudLine(selfHud)}`,
    `Opponent stats: ${hudLine(opponentHud)}`,
    ``,
    playbookSummary(playbook),
    ``,
    `Notable hands this session:`,
    handsSummary,
    ``,
    `Return the playbook diff as JSON.`,
  ].join("\n");

  return { system, user };
}
