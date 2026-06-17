"use client";

import { AnimatePresence } from "framer-motion";
import { PlayingCard } from "./PlayingCard.js";
import type { Card } from "@/engine/cards.js";

/** The community cards. New cards stagger in as streets are dealt. */
export function Board({
  board,
  dealKey,
  placeholder = "awaiting flop",
}: {
  board: Card[];
  dealKey: string | number;
  placeholder?: string;
}) {
  return (
    <div className="flex items-center justify-center gap-2" style={{ minHeight: 84 }}>
      <AnimatePresence mode="popLayout">
        {board.length === 0 ? (
          <div className="eyebrow" style={{ opacity: 0.4 }}>
            {placeholder}
          </div>
        ) : (
          board.map((c, i) => (
            <PlayingCard key={`${dealKey}-${i}-${c}`} card={c} size="md" delay={i >= 3 ? 0 : i * 0.07} />
          ))
        )}
      </AnimatePresence>
    </div>
  );
}
