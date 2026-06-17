"use client";

import type { HudStats } from "@/sim/hud.js";
import type { BotMeta } from "@/lib/client/bots.js";

const pct = (x: number) => `${Math.round(x * 100)}`;

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex flex-col" title={hint}>
      <span className="eyebrow" style={{ letterSpacing: "0.16em" }}>
        {label}
      </span>
      <span className="data text-[0.95rem]" style={{ color: "var(--color-cream)" }}>
        {value}
      </span>
    </div>
  );
}

export function HudPanel({
  hud,
  meta,
  net,
  align = "left",
}: {
  hud: HudStats;
  meta: BotMeta;
  net: number;
  align?: "left" | "right";
}) {
  return (
    <div className="panel rounded-xl p-3.5">
      <div className={`mb-3 flex items-center justify-between ${align === "right" ? "flex-row-reverse text-right" : ""}`}>
        <span className="eyebrow" style={{ color: meta.accent }}>
          HUD · {hud.hands} hands
        </span>
        <span
          className="data text-[0.8rem]"
          style={{ color: net >= 0 ? "var(--color-jade)" : "var(--color-rust)" }}
        >
          {net >= 0 ? "+" : ""}
          {hud.winRateBb100.toFixed(1)} bb/100
        </span>
      </div>
      <div className="grid grid-cols-4 gap-y-3">
        <Stat label="VPIP" value={`${pct(hud.vpip)}%`} hint="Voluntarily put $ in pot" />
        <Stat label="PFR" value={`${pct(hud.pfr)}%`} hint="Preflop raise" />
        <Stat label="3BET" value={`${pct(hud.threeBet)}%`} hint="Re-raised an open" />
        <Stat label="AF" value={hud.af.toFixed(1)} hint="Aggression factor (postflop)" />
        <Stat label="F2CB" value={`${pct(hud.foldToCbet)}%`} hint="Fold to flop c-bet" />
        <Stat label="WTSD" value={`${pct(hud.wtsd)}%`} hint="Went to showdown" />
        <Stat label="W$SD" value={`${pct(hud.wonAtShowdown)}%`} hint="Won at showdown" />
        <Stat label="NET" value={`${net >= 0 ? "+" : ""}${net}`} hint="Net chips this session" />
      </div>
    </div>
  );
}
