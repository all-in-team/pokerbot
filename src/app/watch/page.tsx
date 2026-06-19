"use client";

/**
 * /watch — bot-vs-bot 6-max visualiser. Everything runs CLIENT-SIDE: the pure
 * engine + heuristic bots play a hand (watchSim), it is turned into frames
 * (replayMultiway), and HandReplayer animates it on the table. "Main suivante"
 * deals the next hand carrying stacks. No backend, no DB.
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import HandReplayer from "@/components/HandReplayer.js";
import { replayMultiway, type Frame } from "@/lib/client/replayMultiway.js";
import { createWatchTable, initialWatchState, playNextHand } from "@/lib/client/watchSim.js";

export default function WatchPage() {
  const tableRef = useRef(createWatchTable({ seats: 6, seed: "watch" }));
  const stateRef = useRef(initialWatchState(tableRef.current));
  const started = useRef(false);

  const [frames, setFrames] = useState<Frame[] | null>(null);
  const [handNo, setHandNo] = useState(0);
  const table = tableRef.current;

  const next = useCallback(async () => {
    const { log, next } = await playNextHand(tableRef.current, stateRef.current);
    stateRef.current = next;
    setFrames(replayMultiway(log));
    setHandNo((h) => h + 1);
  }, []);

  useEffect(() => {
    if (started.current) return; // guard React StrictMode double-invoke
    started.current = true;
    void next();
  }, [next]);

  return (
    <main
      style={{
        maxWidth: 920,
        margin: "0 auto",
        padding: "clamp(12px,3vw,24px)",
        color: "#e5e7eb",
        fontFamily: "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
      }}
    >
      <header style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", flexWrap: "wrap", gap: 8, marginBottom: 14 }}>
        <h1 style={{ fontSize: "clamp(18px,4vw,24px)", fontWeight: 800, margin: 0 }}>
          ♠ Watch — bots {table.seats}-max
        </h1>
        <div style={{ fontSize: 13, color: "#94a3b8" }}>
          {`$${table.smallBlind}/$${table.bigBlind} · ante $${table.ante} · main #${handNo}`}
        </div>
      </header>

      <p style={{ fontSize: 13, color: "#94a3b8", marginTop: 0, marginBottom: 16 }}>
        Mode étude : on regarde des bots heuristiques jouer. Cartes adverses cachées jusqu&apos;à l&apos;abattage —
        coche « Révéler toutes les cartes » pour étudier les ranges.
      </p>

      {frames ? (
        <HandReplayer frames={frames} onNextHand={() => void next()} />
      ) : (
        <div style={{ padding: 40, textAlign: "center", color: "#64748b" }}>Distribution…</div>
      )}
    </main>
  );
}
