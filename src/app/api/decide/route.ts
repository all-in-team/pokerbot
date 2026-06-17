import { NextResponse } from "next/server";
import { getLlmClient } from "@/llm/index.js";
import { buildDecisionPrompt } from "@/llm/prompts.js";
import type { DecisionView } from "@/bots/types.js";
import type { Playbook } from "@/learning/playbook.js";
import type { HudStats } from "@/sim/hud.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface DecideBody {
  view: DecisionView;
  playbook: Playbook;
  opponentHud: HudStats;
}

// One client per server process (mock offline, live when ANTHROPIC_API_KEY set).
const client = getLlmClient();

export async function POST(req: Request) {
  try {
    const { view, playbook, opponentHud } = (await req.json()) as DecideBody;
    const { system, user } = buildDecisionPrompt(view, playbook, opponentHud);
    const decision = await client.decide({ view, playbook, opponentHud, system, user });
    return NextResponse.json({ decision });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
