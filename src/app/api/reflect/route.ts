import { NextResponse } from "next/server";
import { getLlmClient } from "@/llm/index.js";
import { reflectOnSession } from "@/learning/coach.js";
import type { Playbook } from "@/learning/playbook.js";
import type { HandLog } from "@/sim/match.js";
import type { Seat } from "@/engine/state.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Coach reflection — STATELESS. The client sends the session's hands + the
 * current (client-held) playbook; the coach LLM (live Anthropic when
 * ANTHROPIC_API_KEY is set, deterministic mock otherwise) returns a diff, and we
 * return the updated playbook. Nothing is stored server-side (Vercel-friendly).
 * Every number fed to the coach comes from the engine-produced hand logs.
 */
interface ReflectBody {
  playbook: Playbook;
  seat: Seat;
  hands: HandLog[];
}

// One client per server process (mock offline, live when ANTHROPIC_API_KEY set).
const client = getLlmClient();

export async function POST(req: Request) {
  try {
    const { playbook, seat, hands } = (await req.json()) as ReflectBody;
    if (!playbook || !Array.isArray(hands)) {
      return NextResponse.json({ error: "playbook and hands[] required" }, { status: 400 });
    }
    const res = await reflectOnSession(client, playbook, (seat ?? 0) as Seat, hands);
    return NextResponse.json({ playbook: res.newPlaybook, diff: res.diff, net: res.net });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
