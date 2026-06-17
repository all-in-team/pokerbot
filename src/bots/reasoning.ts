/**
 * Reasoning-agent bot. Wraps an LlmClient: builds the decision prompt from what
 * the player legitimately knows (cards, board, stacks, position, history, its
 * playbook, and a HUD of the opponent), asks the model for a JSON decision, and
 * normalizes it to a legal action. Works with the live Anthropic client or the
 * offline mock — same interface as the heuristic bots.
 */

import { clampToLegal } from "./util.js";
import { buildDecisionPrompt } from "../llm/prompts.js";
import type { ActionInput } from "../engine/actions.js";
import type { Bot, Decision, DecisionView } from "./types.js";
import type { LlmClient, DecisionJson } from "../llm/types.js";
import type { Playbook } from "../learning/playbook.js";
import type { HudStats } from "../sim/hud.js";

export interface ReasoningBotConfig {
  name: string;
  style?: string;
  client: LlmClient;
  /** Current playbook (read fresh each decision so learning updates take effect). */
  getPlaybook: () => Playbook;
  /** Live HUD of the opponent (updated by the harness as the session plays). */
  getOpponentHud: () => HudStats;
}

function toActionInput(d: DecisionJson): ActionInput {
  switch (d.action) {
    case "fold":
      return { type: "fold" };
    case "check":
      return { type: "check" };
    case "call":
      return { type: "call" };
    case "bet":
      return { type: "bet", to: Math.round(d.sizing) };
    case "raise":
      return { type: "raise", to: Math.round(d.sizing) };
  }
}

export function createReasoningBot(config: ReasoningBotConfig): Bot {
  async function decide(view: DecisionView): Promise<Decision> {
    const playbook = config.getPlaybook();
    const opponentHud = config.getOpponentHud();
    const { system, user } = buildDecisionPrompt(view, playbook, opponentHud);

    let json: DecisionJson;
    try {
      json = await config.client.decide({ view, playbook, opponentHud, system, user });
    } catch (err) {
      // Never let a model hiccup stall the table — fall back to a safe action.
      const fallback: ActionInput = view.legal.canCheck ? { type: "check" } : { type: "fold" };
      return {
        action: fallback,
        confidence: 0,
        reasoning: `(decision error: ${(err as Error).message}) defaulting to ${fallback.type}.`,
        perceivedEquity: undefined,
      };
    }

    return {
      action: clampToLegal(toActionInput(json), view.legal),
      confidence: clamp01(json.confidence),
      reasoning: json.reasoning,
      perceivedEquity: clamp01(json.perceivedEquity),
    };
  }

  return { name: config.name, style: config.style, decide };
}

const clamp01 = (x: number) => (Number.isFinite(x) ? Math.max(0, Math.min(1, x)) : 0);
