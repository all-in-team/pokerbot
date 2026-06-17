import { NextResponse } from "next/server";
import { getDb } from "@/db/server.js";
import { getMatches } from "@/db/db.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  try {
    const matches = getMatches(getDb());
    return NextResponse.json({ matches });
  } catch (err) {
    return NextResponse.json({ matches: [], error: (err as Error).message }, { status: 200 });
  }
}
