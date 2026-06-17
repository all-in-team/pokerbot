"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Seat } from "./Seat.js";
import { Board } from "./Board.js";
import { PotDisplay, ChipStack } from "./Chips.js";
import { EquityBar } from "./EquityBar.js";
import type { ArenaView } from "@/lib/client/director.js";
import type { BotMeta } from "@/lib/client/bots.js";

export function PokerTable({ view, meta }: { view: ArenaView; meta: [BotMeta, BotMeta] }) {
  const winners = view.result?.winners ?? [];
  const dealKey = view.handId;

  return (
    <div className="relative mx-auto w-full max-w-[820px]">
      {/* Wooden rail */}
      <div
        className="relative rounded-[48%/40%] p-3"
        style={{
          background: "linear-gradient(180deg, #241a10, #140d07)",
          boxShadow: "0 30px 80px rgba(0,0,0,0.6), inset 0 0 0 1px rgba(200,162,74,0.25)",
        }}
      >
        {/* Felt */}
        <div
          className="felt relative flex flex-col items-center justify-between rounded-[47%/39%] px-6"
          style={{ height: 520, border: "2px solid rgba(200,162,74,0.18)" }}
        >
          {/* Top seat (seat 1) */}
          <div className="z-10 mt-6">
            <Seat player={view.players[1]} meta={meta[1]} showCards isWinner={winners.includes(1)} dealKey={`${dealKey}-1`} />
          </div>

          {/* Top wager */}
          <Wager amount={view.players[1].committedThisStreet} keyId={`${dealKey}-${view.street}-1`} from="top" />

          {/* Center: pot + board + equity */}
          <div className="z-10 flex w-full max-w-[440px] flex-col items-center gap-3">
            <PotDisplay pot={view.pot} bigBlind={view.bigBlind} />
            <Board
              board={view.board}
              dealKey={dealKey}
              placeholder={view.isComplete ? "won before the flop" : "awaiting flop"}
            />
            <div className="mt-1 w-full">
              <EquityBar view={view} meta={meta} />
            </div>
          </div>

          {/* Bottom wager */}
          <Wager amount={view.players[0].committedThisStreet} keyId={`${dealKey}-${view.street}-0`} from="bottom" />

          {/* Bottom seat (seat 0) */}
          <div className="z-10 mb-6">
            <Seat player={view.players[0]} meta={meta[0]} showCards isWinner={winners.includes(0)} dealKey={`${dealKey}-0`} />
          </div>

          {/* Streak label */}
          <div className="pointer-events-none absolute left-1/2 top-3 -translate-x-1/2">
            <span className="eyebrow" style={{ opacity: 0.5 }}>
              {view.street === "complete" ? "hand complete" : view.street}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function Wager({ amount, keyId, from }: { amount: number; keyId: string; from: "top" | "bottom" }) {
  return (
    <div className="z-10 flex h-8 items-center justify-center">
      <AnimatePresence mode="popLayout">
        {amount > 0 && (
          <motion.div
            key={keyId}
            initial={{ opacity: 0, y: from === "top" ? -10 : 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: from === "top" ? 60 : -60, scale: 0.6, transition: { duration: 0.4 } }}
            className="flex items-center gap-2"
          >
            <ChipStack amount={amount} size={16} />
            <span className="data text-[0.7rem]" style={{ color: "var(--color-brass-bright)" }}>
              {amount}
            </span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
