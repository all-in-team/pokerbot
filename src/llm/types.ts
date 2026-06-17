/**
 * LLM client contract for the reasoning agents and the coach.
 *
 * Two implementations exist: a real Anthropic-backed client (server-only,
 * needs ANTHROPIC_API_KEY) and a deterministic mock that works offline so the
 * whole reasoning + learning loop runs and tests without an API key.
 */

import type { DecisionView } from "../bots/types.js";
import type { HudStats } from "../sim/hud.js";
import type { Playbook, PlaybookDiff } from "../learning/playbook.js";

/** The in-hand decision contract returned by a reasoning agent. */
export interface DecisionJson {
  action: "fold" | "check" | "call" | "bet" | "raise";
  /** For bet/raise: the total "to" amount for this street. 0 otherwise. */
  sizing: number;
  /** 0..1 self-rated confidence. */
  confidence: number;
  /** 1–2 sentence rationale, shown in the UI. */
  reasoning: string;
  /** The bot's own estimate of its equity, 0..1. */
  perceivedEquity: number;
}

export interface DecideInput {
  view: DecisionView;
  playbook: Playbook;
  opponentHud: HudStats;
  /** True all-in equity at this point, if the harness wants to ground the bot. */
  trueEquity?: number;
  system: string;
  user: string;
}

export interface ReflectInput {
  playbook: Playbook;
  selfHud: HudStats;
  opponentHud: HudStats;
  /** Net chips this session for the reflecting bot. */
  net: number;
  handsSummary: string;
  system: string;
  user: string;
}

export interface LlmClient {
  /** Whether this is a live (billed) client. The mock returns false. */
  readonly live: boolean;
  decide(input: DecideInput): Promise<DecisionJson>;
  reflect(input: ReflectInput): Promise<PlaybookDiff>;
}
