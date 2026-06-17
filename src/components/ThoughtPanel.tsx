"use client";

import { AnimatePresence, motion } from "framer-motion";
import type { ThoughtView } from "@/lib/client/director.js";
import type { BotMeta } from "@/lib/client/bots.js";

const ACTION_LABEL: Record<string, string> = {
  fold: "FOLDS",
  check: "CHECKS",
  call: "CALLS",
  bet: "BETS",
  raise: "RAISES",
};

export function ThoughtPanel({
  thought,
  meta,
  align = "left",
}: {
  thought: ThoughtView | null;
  meta: BotMeta;
  align?: "left" | "right";
}) {
  return (
    <div className="panel relative h-full overflow-hidden rounded-xl p-4">
      <div
        className="absolute inset-x-0 top-0 h-px"
        style={{ background: `linear-gradient(90deg, transparent, ${meta.accent}, transparent)` }}
      />
      <div className={`mb-2 flex items-center gap-2 ${align === "right" ? "flex-row-reverse" : ""}`}>
        <span className="eyebrow" style={{ color: meta.accent }}>
          {meta.name}
        </span>
        <span className="eyebrow opacity-60">inner monologue</span>
      </div>

      <div className="min-h-[68px]">
        <AnimatePresence mode="wait">
          <motion.div
            key={(thought?.reasoning ?? "") + (thought?.street ?? "")}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.25 }}
          >
            {thought ? (
              <>
                <p
                  className="text-[0.95rem] leading-snug"
                  style={{ fontFamily: "var(--font-body)", color: "var(--color-cream)" }}
                >
                  {thought.reasoning ?? "…"}
                </p>
                <div className="mt-3 flex items-center gap-3">
                  <span
                    className="data rounded px-2 py-0.5 text-[0.66rem]"
                    style={{ background: `${meta.accent}22`, color: meta.accent, border: `1px solid ${meta.accent}55` }}
                  >
                    {ACTION_LABEL[thought.actionType] ?? thought.actionType.toUpperCase()}
                    {thought.amount > 0 ? ` ${thought.amount}` : ""}
                  </span>
                  {thought.confidence !== undefined && (
                    <ConfidenceMeter value={thought.confidence} accent={meta.accent} />
                  )}
                </div>
              </>
            ) : (
              <p className="data text-[0.8rem]" style={{ color: "var(--color-muted)" }}>
                {meta.tagline}
              </p>
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}

function ConfidenceMeter({ value, accent }: { value: number; accent: string }) {
  const clamped = Math.max(0, Math.min(1, value));
  return (
    <div className="flex items-center gap-1.5">
      <span className="eyebrow" style={{ letterSpacing: "0.18em" }}>
        conf
      </span>
      <div className="h-1.5 w-14 overflow-hidden rounded-full" style={{ background: "rgba(0,0,0,0.4)" }}>
        <motion.div
          className="h-full"
          style={{ background: accent }}
          animate={{ width: `${clamped * 100}%` }}
          transition={{ type: "spring", stiffness: 160, damping: 20 }}
        />
      </div>
    </div>
  );
}
