import { NextResponse } from "next/server";
import { openDb } from "@/db/db.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Readiness probe: 200 means app + DB are healthy, 503 means the DB ping failed.
 * A light `SELECT 1` confirms SQLite is reachable.
 */
export function GET() {
  const ts = new Date().toISOString();
  try {
    const db = openDb();
    db.prepare("SELECT 1").get();
    db.close();
    return NextResponse.json({ status: "ok", ts });
  } catch (err) {
    return NextResponse.json(
      { status: "error", ts, error: err instanceof Error ? err.message : String(err) },
      { status: 503 },
    );
  }
}
