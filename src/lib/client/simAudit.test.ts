import { describe, it, expect } from "vitest";
import { runAudit } from "./simAudit.js";

describe("simAudit — fast bot-vs-bot behaviour audit", () => {
  it("runs the requested number of hands and is deterministic for a fixed seed", async () => {
    const a = await runAudit({ hands: 24, seed: "audit-test", evSamples: 16, chunk: 100 });
    const b = await runAudit({ hands: 24, seed: "audit-test", evSamples: 16, chunk: 100 });
    expect(a.hands).toBe(24);
    expect(a).toEqual(b); // same seed → identical aggregate
  });

  it("street action percentages each sum to ~100 (when any action occurred)", async () => {
    const r = await runAudit({ hands: 30, seed: "sums", evSamples: 16, chunk: 100 });
    for (const street of ["preflop", "flop", "turn", "river"] as const) {
      const d = r.byStreet[street];
      if (d.total === 0) continue;
      const sum = (Object.values(d.pct) as number[]).reduce((x, y) => x + y, 0);
      expect(sum).toBeCloseTo(100, 5);
    }
    // Preflop always has actions.
    expect(r.byStreet.preflop.total).toBeGreaterThan(0);
  });

  it("is zero-sum across seats (bb/100 sums to ~0)", async () => {
    const r = await runAudit({ hands: 40, seed: "zs", evSamples: 16, chunk: 100 });
    const sum = r.bb100.reduce((a, b) => a + b, 0);
    expect(Math.abs(sum)).toBeLessThan(1e-6);
    expect(r.bb100.length).toBe(6);
  });

  it("reports stats within valid ranges", async () => {
    const r = await runAudit({ hands: 30, seed: "ranges", evSamples: 16, chunk: 100 });
    for (const v of [r.vpip, r.pfr, r.preflopAllInPct, r.showdownPct]) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(100);
    }
    expect(r.pfr).toBeLessThanOrEqual(r.vpip + 1e-9); // PFR ⊆ VPIP
    expect(r.avgPotBb).toBeGreaterThan(0);
  });
});
