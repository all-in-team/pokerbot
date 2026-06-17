/**
 * LLM client factory. Returns the live Anthropic client when ANTHROPIC_API_KEY
 * is set, otherwise the deterministic offline mock. SERVER ONLY.
 */

import { MockLlmClient } from "./mock.js";
import { AnthropicLlmClient } from "./anthropic.js";
import type { LlmClient } from "./types.js";

export function getLlmClient(opts: { forceMock?: boolean } = {}): LlmClient {
  if (!opts.forceMock && process.env.ANTHROPIC_API_KEY) {
    return new AnthropicLlmClient();
  }
  return new MockLlmClient();
}

export * from "./types.js";
export { MockLlmClient } from "./mock.js";
