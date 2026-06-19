import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Records a Spot Trainer attempt.
 *
 * STUB: logs for now. The body is { spotId, action, sizing?, verdict, evLoss }
 * where `verdict`/`evLoss` were graded on the client against the STORED solution
 * (scoreAttempt over spot.solution) — never invented here. Both are null when the
 * spot's solution is still a placeholder (attempt still recorded).
 *
 * TODO: persist to Supabase — table `attempts` (spot_id, action, sizing,
 * verdict, ev_loss, created_at). Swap the console.log below for the insert.
 */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { spotId, action, sizing, verdict, evLoss } = body ?? {};
    console.log("[attempts]", { spotId, action, sizing, verdict, evLoss });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 400 },
    );
  }
}
