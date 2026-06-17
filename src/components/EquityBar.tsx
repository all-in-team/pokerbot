"use client";

import { motion } from "framer-motion";
import type { ArenaView } from "@/lib/client/director.js";
import type { BotMeta } from "@/lib/client/bots.js";

/**
 * The truth layer, visualized. A horizontal track split by TRUE all-in equity,
 * with a marker per bot showing its PERCEIVED equity — the gap between marker
 * and split is exactly how badly each bot is misreading the spot.
 */
export function EquityBar({ view, meta }: { view: ArenaView; meta: [BotMeta, BotMeta] }) {
  const eq = view.equity.true;
  const left = eq ? eq[0] : 0.5;
  const hasEq = eq !== null;

  return (
    <div className="w-full">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="eyebrow">Equity</span>
        <span className="eyebrow">
          {hasEq ? (view.equity.exact ? "exact" : "monte-carlo") : "—"}
        </span>
      </div>

      <div className="flex items-center gap-3">
        <EquityReadout
          align="left"
          truth={eq ? eq[0] : null}
          perceived={view.equity.perceived[0]}
          accent={meta[0].accent}
        />

        <div className="relative h-3.5 flex-1 overflow-hidden rounded-full" style={{ background: "rgba(0,0,0,0.4)", border: "1px solid var(--color-line)" }}>
          <motion.div
            className="absolute inset-y-0 left-0"
            style={{ background: meta[0].accent, opacity: 0.85 }}
            animate={{ width: `${(hasEq ? left : 0.5) * 100}%` }}
            transition={{ type: "spring", stiffness: 120, damping: 22 }}
          />
          <motion.div
            className="absolute inset-y-0 right-0"
            style={{ background: meta[1].accent, opacity: 0.85 }}
            animate={{ width: `${(hasEq ? 1 - left : 0.5) * 100}%` }}
            transition={{ type: "spring", stiffness: 120, damping: 22 }}
          />
          {/* center seam */}
          <div className="absolute inset-y-0 left-1/2 w-px" style={{ background: "rgba(255,255,255,0.12)" }} />

          {/* perceived markers */}
          <PerceivedMarker value={view.equity.perceived[0]} />
          <PerceivedMarker value={view.equity.perceived[1]} fromRight />
        </div>

        <EquityReadout
          align="right"
          truth={eq ? eq[1] : null}
          perceived={view.equity.perceived[1]}
          accent={meta[1].accent}
        />
      </div>
    </div>
  );
}

function PerceivedMarker({ value, fromRight = false }: { value: number | null; fromRight?: boolean }) {
  if (value === null) return null;
  const pos = fromRight ? 1 - value : value;
  return (
    <motion.div
      className="absolute top-1/2 z-10"
      style={{ translateX: "-50%", translateY: "-50%" }}
      animate={{ left: `${pos * 100}%` }}
      transition={{ type: "spring", stiffness: 140, damping: 20 }}
    >
      <div
        className="h-4 w-1 rounded-full"
        style={{ background: "#fff", boxShadow: "0 0 6px rgba(255,255,255,0.8)" }}
        title="perceived equity"
      />
    </motion.div>
  );
}

function EquityReadout({
  align,
  truth,
  perceived,
  accent,
}: {
  align: "left" | "right";
  truth: number | null;
  perceived: number | null;
  accent: string;
}) {
  const pct = (x: number | null) => (x === null ? "––" : `${Math.round(x * 100)}`);
  const delta = truth !== null && perceived !== null ? perceived - truth : null;
  return (
    <div className={`w-[84px] shrink-0 ${align === "right" ? "text-right" : "text-left"}`}>
      <div className="data text-xl leading-none" style={{ color: accent }}>
        {pct(truth)}
        <span className="text-[0.6rem] opacity-60">%</span>
      </div>
      <div className="data mt-0.5 text-[0.62rem]" style={{ color: "var(--color-muted)" }}>
        felt {pct(perceived)}%
        {delta !== null && (
          <span style={{ color: Math.abs(delta) > 0.12 ? "var(--color-rust)" : "var(--color-muted)", marginLeft: 4 }}>
            {delta >= 0 ? "+" : ""}
            {Math.round(delta * 100)}
          </span>
        )}
      </div>
    </div>
  );
}
