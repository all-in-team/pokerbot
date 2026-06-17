"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { LineChart, type Series } from "@/components/LineChart.js";
import { solveKuhn, type SolveResult } from "@/solver/cfr.js";

const ITER_OPTIONS = [2000, 5000, 20000, 50000];

export default function SolverPage() {
  const [iterations, setIterations] = useState(5000);
  const [result, setResult] = useState<SolveResult | null>(null);
  const [running, setRunning] = useState(false);

  const run = (iters: number) => {
    setRunning(true);
    setResult(null);
    // defer so the "solving…" state paints before the (synchronous) solve
    setTimeout(() => {
      setResult(solveKuhn(iters));
      setRunning(false);
    }, 20);
  };

  useEffect(() => {
    run(5000);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const exploitSeries: Series[] = result
    ? [{ label: "exploitability", color: "#d8694c", points: result.history.map((h) => h.exploitability) }]
    : [];
  const entropySeries: Series[] = result
    ? [{ label: "strategy entropy (bits)", color: "#5fd1c4", points: result.history.map((h) => h.entropy) }]
    : [];

  return (
    <main className="mx-auto min-h-screen max-w-[1100px] px-5 py-6">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="eyebrow mb-1">counterfactual regret minimization · converging to Nash</div>
          <h1 className="brass text-4xl font-semibold leading-none" style={{ fontFamily: "var(--font-display)" }}>
            CFR Solver
          </h1>
        </div>
        <div className="flex items-center gap-3">
          <select
            value={iterations}
            onChange={(e) => {
              const v = Number(e.target.value);
              setIterations(v);
              run(v);
            }}
            disabled={running}
            className="data rounded px-3 py-2 text-sm outline-none"
            style={{ border: "1px solid var(--color-line)", background: "#0a1611", color: "var(--color-cream)" }}
          >
            {ITER_OPTIONS.map((n) => (
              <option key={n} value={n}>
                {n.toLocaleString()} iterations
              </option>
            ))}
          </select>
          <button
            onClick={() => run(iterations)}
            disabled={running}
            className="rounded-lg px-4 py-2 text-sm transition-all hover:brightness-125 disabled:opacity-40"
            style={{ background: "var(--color-brass-bright)", color: "#1a130a", fontWeight: 700 }}
          >
            {running ? "solving…" : "↻ Solve"}
          </button>
          <Link
            href="/"
            className="rounded-lg px-4 py-2 text-sm transition-all hover:brightness-125"
            style={{ border: "1px solid var(--color-line)", color: "var(--color-brass-bright)" }}
          >
            ← Table
          </Link>
        </div>
      </header>

      <p className="mb-5 max-w-2xl text-sm" style={{ color: "var(--color-muted)" }}>
        A self-play CFR engine on Kuhn Poker (a 3-card abstraction of NLHE). It genuinely converges toward a
        Nash equilibrium: <span style={{ color: "var(--color-rust)" }}>exploitability</span> — how much a perfect
        counterfactual opponent could win against the current strategy — falls toward zero, and{" "}
        <span style={{ color: "var(--color-teal)" }}>strategy entropy</span> settles as the bot stops second-guessing
        solved spots.
      </p>

      {result && (
        <>
          <div className="mb-5 grid grid-cols-2 gap-5 sm:grid-cols-4">
            <Metric label="iterations" value={result.iterations.toLocaleString()} />
            <Metric label="exploitability" value={result.finalExploitability.toFixed(4)} color="var(--color-rust)" />
            <Metric label="entropy (bits)" value={result.finalEntropy.toFixed(3)} color="var(--color-teal)" />
            <Metric label="≈ Nash" value={result.finalExploitability < 0.005 ? "converged" : "converging"} color="var(--color-jade)" />
          </div>

          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            <div className="panel rounded-xl p-5">
              <div className="eyebrow mb-3">exploitability → 0 (over checkpoints)</div>
              <LineChart series={exploitSeries} symmetric={false} format={(v) => v.toFixed(4)} />
            </div>
            <div className="panel rounded-xl p-5">
              <div className="eyebrow mb-3">strategy entropy settling</div>
              <LineChart series={entropySeries} symmetric={false} format={(v) => `${v.toFixed(2)}`} />
            </div>
          </div>

          <div className="panel mt-5 rounded-xl p-5">
            <div className="mb-4 flex items-center justify-between">
              <span className="eyebrow">converged strategy · P(bet/call) by spot</span>
              <span className="data text-[0.7rem]" style={{ color: "var(--color-muted)" }}>
                K opens ≈ 3× the J bluff rate — the textbook Kuhn equilibrium
              </span>
            </div>
            <div className="grid grid-cols-1 gap-x-8 gap-y-2.5 sm:grid-cols-2">
              {result.strategy.map((s) => (
                <StrategyRow key={s.infoSet} label={s.context} bet={s.bet} />
              ))}
            </div>
          </div>
        </>
      )}

      {running && !result && (
        <div className="panel rounded-xl p-10 text-center">
          <span className="data text-sm" style={{ color: "var(--color-muted)" }}>
            running CFR self-play…
          </span>
        </div>
      )}
    </main>
  );
}

function Metric({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="panel rounded-xl p-4">
      <div className="eyebrow mb-1">{label}</div>
      <div className="data text-xl" style={{ color: color ?? "var(--color-cream)" }}>
        {value}
      </div>
    </div>
  );
}

function StrategyRow({ label, bet }: { label: string; bet: number }) {
  return (
    <div className="flex items-center gap-3">
      <span className="data w-44 shrink-0 text-[0.74rem]" style={{ color: "var(--color-cream)" }}>
        {label}
      </span>
      <div className="relative h-2.5 flex-1 overflow-hidden rounded-full" style={{ background: "rgba(0,0,0,0.4)" }}>
        <div className="absolute inset-y-0 left-0" style={{ width: `${bet * 100}%`, background: "var(--color-brass)" }} />
      </div>
      <span className="data w-12 shrink-0 text-right text-[0.72rem]" style={{ color: "var(--color-brass-bright)" }}>
        {Math.round(bet * 100)}%
      </span>
    </div>
  );
}
