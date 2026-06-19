"use client";

import { motion } from "framer-motion";
import { THEME } from "@/lib/theme.js";
import type { Card as CardType } from "@/engine/cards.js";

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
  const suit = card ? THEME.suits[card[1]!] : undefined;
  const color = suit?.color ?? "#1A1A1A";
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
          className="h-full w-full rounded-[9px] border"
          style={{
            borderColor: "rgba(255,255,255,0.10)",
            background: "linear-gradient(135deg, #243044 0%, #1b2433 100%)",
            boxShadow: "0 4px 12px rgba(0,0,0,0.45)",
          }}
        >
          <div
            className="m-[5px] h-[calc(100%-10px)] w-[calc(100%-10px)] rounded-[5px]"
            style={{ background: "repeating-linear-gradient(45deg, rgba(45,212,167,0.12) 0 7px, transparent 7px 14px)" }}
          />
        </div>
      ) : (
        <div
          className="relative h-full w-full overflow-hidden rounded-[9px]"
          style={{
            background: "#FFFFFF",
            boxShadow: "0 2px 6px rgba(0,0,0,0.35), inset 0 0 0 1px rgba(0,0,0,0.06)",
            color,
            fontWeight: 800,
          }}
        >
          <div className="absolute left-[6px] top-[4px] flex flex-col items-center leading-none">
            <span style={{ fontSize: s.rank, fontWeight: 800 }}>{display}</span>
            <span style={{ fontSize: s.rank - 5, marginTop: -1 }}>{suit?.glyph}</span>
          </div>
          <div className="absolute inset-0 flex items-center justify-center" style={{ fontSize: s.pip, opacity: 0.94 }}>
            {suit?.glyph}
          </div>
        </div>
      )}
    </motion.div>
  );
}
