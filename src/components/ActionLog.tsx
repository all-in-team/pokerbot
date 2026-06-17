"use client";

import { useEffect, useRef } from "react";
import { motion } from "framer-motion";
import type { ArenaView } from "@/lib/client/director.js";
import type { BotMeta } from "@/lib/client/bots.js";

const VERB: Record<string, string> = {
  fold: "folds",
  check: "checks",
  call: "calls",
  bet: "bets",
  raise: "raises to",
};

export function ActionLog({ view, meta }: { view: ArenaView; meta: [BotMeta, BotMeta] }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [view.decisions.length, view.handId]);

  return (
    <div className="panel flex h-full flex-col rounded-xl">
      <div className="flex items-center justify-between border-b px-4 py-2.5 hairline">
        <span className="eyebrow">Action · hand #{view.handIndex + 1}</span>
        <span className="eyebrow">{view.street}</span>
      </div>
      <div ref={ref} className="flex-1 space-y-1 overflow-y-auto px-4 py-3" style={{ maxHeight: 220 }}>
        {view.decisions.length === 0 && (
          <p className="data text-[0.72rem]" style={{ color: "var(--color-muted)" }}>
            blinds posted · waiting for first action…
          </p>
        )}
        {view.decisions.map((d, i) => {
          const m = meta[d.seat];
          const amount = "to" in d.action ? d.action.to : 0;
          const isNewStreet = i === 0 || view.decisions[i - 1]!.street !== d.street;
          return (
            <div key={i}>
              {isNewStreet && (
                <div className="eyebrow mt-2 mb-1" style={{ color: "var(--color-brass)" }}>
                  {d.street}
                </div>
              )}
              <motion.div
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                className="data flex items-baseline gap-2 text-[0.78rem]"
              >
                <span style={{ color: m.accent }}>{m.name}</span>
                <span style={{ color: "var(--color-muted)" }}>
                  {VERB[d.action.type] ?? d.action.type}
                  {amount > 0 ? ` ${amount}` : ""}
                </span>
              </motion.div>
            </div>
          );
        })}
        {view.result && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="data mt-2 text-[0.78rem]"
            style={{ color: "var(--color-jade)" }}
          >
            ▸ {view.result.showdown ? "showdown" : "won uncontested"} ·{" "}
            {view.result.winners.length === 2
              ? "split pot"
              : `${meta[view.result.winners[0]!].name} wins ${Math.max(view.result.net[0], view.result.net[1])}`}
            {view.result.handDescr && view.result.showdown && (
              <span style={{ color: "var(--color-muted)" }}>
                {" "}
                ({view.result.handDescr[view.result.winners[0]!] ?? ""})
              </span>
            )}
          </motion.div>
        )}
      </div>
    </div>
  );
}
