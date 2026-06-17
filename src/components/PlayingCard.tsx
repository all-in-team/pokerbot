"use client";

import { motion } from "framer-motion";
import type { Card as CardType } from "@/engine/cards.js";

const SUIT: Record<string, { glyph: string; red: boolean }> = {
  s: { glyph: "♠", red: false },
  h: { glyph: "♥", red: true },
  d: { glyph: "♦", red: true },
  c: { glyph: "♣", red: false },
};

const SIZES = {
  sm: { w: 44, h: 62, rank: 15, pip: 26 },
  md: { w: 60, h: 84, rank: 19, pip: 34 },
  lg: { w: 72, h: 100, rank: 22, pip: 42 },
} as const;

export type CardSize = keyof typeof SIZES;

export function PlayingCard({
  card,
  faceDown = false,
  size = "md",
  delay = 0,
  dim = false,
}: {
  card?: CardType;
  faceDown?: boolean;
  size?: CardSize;
  delay?: number;
  dim?: boolean;
}) {
  const s = SIZES[size];
  const rank = card ? card[0] : "";
  const suit = card ? SUIT[card[1]!] : undefined;
  const color = suit?.red ? "var(--color-crimson)" : "var(--color-jet)";
  const display = rank === "T" ? "10" : rank;

  return (
    <motion.div
      initial={{ opacity: 0, y: -52, rotateY: 90, scale: 0.7 }}
      animate={{ opacity: dim ? 0.32 : 1, y: 0, rotateY: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.8, transition: { duration: 0.18 } }}
      transition={{ type: "spring", stiffness: 320, damping: 26, delay }}
      style={{ width: s.w, height: s.h, perspective: 600 }}
      className="relative select-none"
    >
      {faceDown ? (
        <div
          className="h-full w-full rounded-[7px] border"
          style={{
            borderColor: "rgba(200,162,74,0.4)",
            background:
              "repeating-linear-gradient(45deg, #143a52 0, #143a52 4px, #0f2c40 4px, #0f2c40 8px)",
            boxShadow: "0 4px 12px rgba(0,0,0,0.45), inset 0 0 0 3px rgba(200,162,74,0.12)",
          }}
        >
          <div
            className="m-[5px] h-[calc(100%-10px)] w-[calc(100%-10px)] rounded-[4px]"
            style={{ border: "1px solid rgba(240,214,153,0.35)" }}
          />
        </div>
      ) : (
        <div
          className="relative h-full w-full overflow-hidden rounded-[7px]"
          style={{
            background: "linear-gradient(160deg, #fdf8ee 0%, #f1e8d6 100%)",
            boxShadow:
              "0 5px 14px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.8), inset 0 0 0 1px rgba(0,0,0,0.08)",
          }}
        >
          {/* gloss */}
          <div
            className="pointer-events-none absolute inset-0"
            style={{ background: "linear-gradient(135deg, rgba(255,255,255,0.45), transparent 40%)" }}
          />
          <div
            className="absolute left-[5px] top-[3px] flex flex-col items-center leading-none"
            style={{ color }}
          >
            <span style={{ fontSize: s.rank, fontWeight: 700, fontFamily: "var(--font-display)" }}>
              {display}
            </span>
            <span style={{ fontSize: s.rank - 4, marginTop: -1 }}>{suit?.glyph}</span>
          </div>
          <div
            className="absolute inset-0 flex items-center justify-center"
            style={{ color, fontSize: s.pip, opacity: 0.92 }}
          >
            {suit?.glyph}
          </div>
        </div>
      )}
    </motion.div>
  );
}
