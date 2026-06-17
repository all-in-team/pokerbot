import { NextResponse } from "next/server";
import { getDb } from "@/db/server.js";
import { getMatches, getSessionStats, getPlaybookVersions } from "@/db/db.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const matchId = Number(searchParams.get("matchId"));
  if (!matchId) return NextResponse.json({ error: "matchId required" }, { status: 400 });

  try {
    const db = getDb();
    const match = getMatches(db).find((m) => m.id === matchId) ?? null;
    if (!match) return NextResponse.json({ error: "match not found" }, { status: 404 });

    const sessionStats = getSessionStats(db, matchId);
    const playbooks = [getPlaybookVersions(db, matchId, 0), getPlaybookVersions(db, matchId, 1)];

    return NextResponse.json({ match, sessionStats, playbooks });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
