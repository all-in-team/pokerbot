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

const C = {
  appBg: "#0E1117",
  surface: "#171B23",
  border: "rgba(255,255,255,0.07)",
  text: "#E6E8EC",
  text2: "#9BA1AD",
  text3: "#6B7280",
  teal: "#2DD4A7",
};

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
        minHeight: "100dvh",
        background: C.appBg,
        color: C.text,
        fontFamily: "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
      }}
    >
      <div style={{ maxWidth: 980, margin: "0 auto", padding: "clamp(16px,4vw,32px)" }}>
        <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10, marginBottom: 8 }}>
          <h1 style={{ fontSize: "clamp(19px,4vw,26px)", fontWeight: 800, margin: 0, letterSpacing: -0.3 }}>
            <span style={{ color: C.teal }}>♠</span> Watch · bots {table.seats}-max
          </h1>
          <div
            style={{
              fontSize: 12.5,
              color: C.text2,
              fontVariantNumeric: "tabular-nums",
              padding: "6px 12px",
              borderRadius: 999,
              background: C.surface,
              border: `1px solid ${C.border}`,
            }}
          >
            {`$${table.smallBlind}/$${table.bigBlind} · ante $${table.ante} · main #${handNo}`}
          </div>
        </header>

        <p style={{ fontSize: 13.5, color: C.text2, marginTop: 0, marginBottom: 22, lineHeight: 1.5, maxWidth: 680 }}>
          Mode étude : on regarde des bots EV-seeking jouer en 6-max. Cartes adverses cachées jusqu&apos;à
          l&apos;abattage — active « Révéler les cartes » pour étudier les ranges.
        </p>

        {frames ? (
          <HandReplayer frames={frames} onNextHand={() => void next()} />
        ) : (
          <div style={{ padding: 60, textAlign: "center", color: C.text3 }}>Distribution…</div>
        )}
      </div>
    </main>
  );
}
