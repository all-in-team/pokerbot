"use client";

import { AnimatePresence, motion } from "framer-motion";
import { PlayingCard } from "./PlayingCard.js";
import type { PlayerView } from "@/lib/client/director.js";
import type { BotMeta } from "@/lib/client/bots.js";

export function Seat({
  player,
  meta,
  showCards,
  isWinner,
  dealKey,
}: {
  player: PlayerView;
  meta: BotMeta;
  showCards: boolean;
  isWinner: boolean;
  dealKey: string | number;
}) {
  const dim = player.folded;
  return (
    <div className={`flex items-center gap-4 ${dim ? "opacity-50" : ""} transition-opacity`}>
      {/* Avatar */}
      <div className="relative">
        <motion.div
          className={`flex h-14 w-14 items-center justify-center rounded-full ${player.isToAct ? "to-act-ring" : ""}`}
          style={{
            background: `radial-gradient(circle at 50% 35%, ${meta.accent}33, #0a1611)`,
            border: `2px solid ${player.isToAct ? meta.accent : "rgba(200,162,74,0.35)"}`,
          }}
          animate={{ scale: player.isToAct ? 1.06 : 1 }}
          transition={{ type: "spring", stiffness: 260, damping: 18 }}
        >
          <span className="text-2xl" style={{ color: meta.accent }}>
            {meta.glyph}
          </span>
        </motion.div>
        {player.isButton && (
          <div
            className="absolute -bottom-1 -right-1 flex h-6 w-6 items-center justify-center rounded-full text-[0.6rem] font-bold"
            style={{ background: "linear-gradient(180deg,#f0d699,#b88a32)", color: "#2a1f0c", boxShadow: "0 1px 4px rgba(0,0,0,0.5)" }}
          >
            BTN
          </div>
        )}
      </div>

      {/* Identity + stack */}
      <div className="min-w-[120px]">
        <div className="flex items-center gap-2">
          <span className="text-lg leading-tight" style={{ fontFamily: "var(--font-display)", color: "var(--color-cream)" }}>
            {player.name}
          </span>
          <span
            className="data rounded px-1.5 py-px text-[0.58rem] uppercase"
            style={{ color: meta.accent, border: `1px solid ${meta.accent}55` }}
          >
            {meta.personality}
          </span>
        </div>
        <div className="mt-0.5 flex items-center gap-2">
          <span className="data brass text-lg leading-none">{player.stack}</span>
          {player.allIn && !player.folded && (
            <span className="data text-[0.6rem]" style={{ color: "var(--color-rust)" }}>
              ALL-IN
            </span>
          )}
          {isWinner && (
            <motion.span
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              className="data text-[0.6rem]"
              style={{ color: "var(--color-jade)" }}
            >
              ▲ WINS
            </motion.span>
          )}
        </div>
      </div>

      {/* Hole cards */}
      <div className="flex gap-1.5">
        <AnimatePresence>
          {player.holeCards.length === 2 &&
            player.holeCards.map((c, i) => (
              <PlayingCard
                key={`${dealKey}-${i}-${c}`}
                card={c}
                size="sm"
                faceDown={!showCards}
                dim={player.folded}
                delay={i * 0.08}
              />
            ))}
        </AnimatePresence>
      </div>
    </div>
  );
}
