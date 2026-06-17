/**
 * Real Anthropic-backed LLM client. SERVER ONLY — needs ANTHROPIC_API_KEY and
 * imports the SDK, so never bundle this into client code.
 *
 *  - In-hand decisions: claude-sonnet-4-6 (fast), structured JSON output.
 *  - Coach reflection:   claude-opus-4-8 (stronger), adaptive thinking.
 */

import Anthropic from "@anthropic-ai/sdk";
import { TUNABLE_PATHS, type PlaybookDiff } from "../learning/playbook.js";
import type { DecideInput, DecisionJson, LlmClient, ReflectInput } from "./types.js";

const DECISION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    action: { type: "string", enum: ["fold", "check", "call", "bet", "raise"] },
    sizing: { type: "number", description: "For bet/raise: total 'to' amount this street. 0 otherwise." },
    confidence: { type: "number", description: "0..1 self-rated confidence." },
    reasoning: { type: "string", description: "1-2 sentence rationale." },
    perceivedEquity: { type: "number", description: "Your equity estimate, 0..1." },
  },
  required: ["action", "sizing", "confidence", "reasoning", "perceivedEquity"],
} as const;

const DIFF_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    summary: { type: "string" },
    changes: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          path: { type: "string", enum: [...TUNABLE_PATHS] },
          from: { type: "number" },
          to: { type: "number" },
          reason: { type: "string" },
        },
        required: ["path", "from", "to", "reason"],
      },
    },
    addedNotes: { type: "array", items: { type: "string" } },
  },
  required: ["summary", "changes", "addedNotes"],
} as const;

const DECISION_MODEL = process.env.DECISION_MODEL ?? "claude-sonnet-4-6";
const REFLECTION_MODEL = process.env.REFLECTION_MODEL ?? "claude-opus-4-8";

function firstJson<T>(content: Anthropic.Messages.ContentBlock[]): T {
  const text = content.find((b): b is Anthropic.Messages.TextBlock => b.type === "text");
  if (!text) throw new Error("anthropic: no text block in response");
  return JSON.parse(text.text) as T;
}

export class AnthropicLlmClient implements LlmClient {
  readonly live = true;
  private client: Anthropic;

  constructor(apiKey = process.env.ANTHROPIC_API_KEY) {
    if (!apiKey) throw new Error("AnthropicLlmClient requires ANTHROPIC_API_KEY");
    this.client = new Anthropic({ apiKey });
  }

  async decide(input: DecideInput): Promise<DecisionJson> {
    // Cast through `any`: output_config/thinking are current API params that may
    // outrun the installed SDK's static types.
    const params = {
      model: DECISION_MODEL,
      max_tokens: 1024,
      system: input.system,
      messages: [{ role: "user", content: input.user }],
      output_config: { format: { type: "json_schema", name: "decision", schema: DECISION_SCHEMA } },
    };
    const res = (await this.client.messages.create(params as never)) as Anthropic.Messages.Message;
    return firstJson<DecisionJson>(res.content);
  }

  async reflect(input: ReflectInput): Promise<PlaybookDiff> {
    const params = {
      model: REFLECTION_MODEL,
      max_tokens: 4096,
      thinking: { type: "adaptive" },
      system: input.system,
      messages: [{ role: "user", content: input.user }],
      output_config: { format: { type: "json_schema", name: "playbook_diff", schema: DIFF_SCHEMA } },
    };
    const res = (await this.client.messages.create(params as never)) as Anthropic.Messages.Message;
    return firstJson<PlaybookDiff>(res.content);
  }
}
