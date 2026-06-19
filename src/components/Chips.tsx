"use client";

import { motion } from "framer-motion";

/** A single casino chip disc. */
function Chip({ color, size = 22 }: { color: string; size?: number }) {
  return (
    <div
      className="relative rounded-full"
      style={{
        width: size,
        height: size,
        background: `radial-gradient(circle at 50% 38%, ${color}, ${color} 55%, rgba(0,0,0,0.35))`,
        boxShadow: "0 2px 4px rgba(0,0,0,0.5), inset 0 0 0 2px rgba(255,255,255,0.18)",
      }}
    >
      <div
        className="absolute inset-[3px] rounded-full"
        style={{ border: "2px dashed rgba(255,255,255,0.45)" }}
      />
    </div>
  );
}

const TIERS: { min: number; color: string }[] = [
  { min: 100, color: "#2d2b2e" },
  { min: 50, color: "#b8473f" },
  { min: 20, color: "#2f6f4f" },
  { min: 5, color: "#3a5a86" },
  { min: 0, color: "#E0A93B" },
];

function chipColor(amount: number): string {
  return TIERS.find((t) => amount >= t.min)!.color;
}

/** A small stack of chips representing a wager. Height grows (loosely) with size. */
export function ChipStack({ amount, size = 20 }: { amount: number; size?: number }) {
  if (amount <= 0) return null;
  const count = Math.min(6, 1 + Math.floor(Math.log2(amount + 1)));
  const color = chipColor(amount);
  return (
    <div className="flex flex-col items-center">
      <div className="relative" style={{ height: size + (count - 1) * 4, width: size }}>
        {Array.from({ length: count }).map((_, i) => (
          <div key={i} className="absolute left-0" style={{ bottom: i * 4 }}>
            <Chip color={color} size={size} />
          </div>
        ))}
      </div>
    </div>
  );
}

export function PotDisplay({ pot, bigBlind }: { pot: number; bigBlind: number }) {
  return (
    <div className="flex flex-col items-center gap-1">
      <motion.div
        key={pot}
        initial={{ scale: 0.9, opacity: 0.6 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: "spring", stiffness: 300, damping: 18 }}
        className="flex items-baseline gap-1.5"
      >
        <span className="eyebrow">pot</span>
        <span className="data brass text-2xl font-semibold">{pot}</span>
      </motion.div>
      <span className="data text-[0.62rem]" style={{ color: "var(--color-muted)" }}>
        {(pot / bigBlind).toFixed(1)} bb
      </span>
    </div>
  );
}
