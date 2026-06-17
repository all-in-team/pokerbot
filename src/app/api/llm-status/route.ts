import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Whether the reasoning agents will use the live Anthropic API or the offline mock. */
export function GET() {
  return NextResponse.json({ live: Boolean(process.env.ANTHROPIC_API_KEY) });
}
