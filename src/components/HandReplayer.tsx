"use client";

/**
 * HandReplayer — drives a list of Frames (from replayMultiway) over a poker
 * table. Controls: play / pause / step / speed slider + a "reveal all cards"
 * toggle (opponents are hidden until showdown by default). Shows an action log
 * beside the table. In play mode, each frame dwells for a kind-dependent time.
 */

import React, { useEffect, useState } from "react";
import PokerTableView from "@/components/PokerTableView.js";
import { FRAME_MS, type Frame } from "@/lib/client/replayMultiway.js";

function btn(bg: string): React.CSSProperties {
  return {
    appearance: "none",
    border: "1px solid rgba(255,255,255,0.12)",
    borderRadius: 10,
    background: bg,
    color: "#fff",
    cursor: "pointer",
    minHeight: 40,
    padding: "8px 14px",
    fontSize: 14,
    fontWeight: 700,
    WebkitTapHighlightColor: "transparent",
  };
}

export default function HandReplayer({ frames, onNextHand }: { frames: Frame[]; onNextHand?: () => void }) {
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [revealAll, setRevealAll] = useState(false);

  // New hand → restart from the deal and auto-play.
  useEffect(() => {
    setIndex(0);
    setPlaying(true);
  }, [frames]);

  const atEnd = index >= frames.length - 1;

  // Advance while playing, dwelling per frame kind / speed.
  useEffect(() => {
    if (!playing || atEnd) return;
    const kind = frames[index]?.kind ?? "action";
    const ms = FRAME_MS[kind] / speed;
    const t = setTimeout(() => setIndex((i) => Math.min(i + 1, frames.length - 1)), ms);
    return () => clearTimeout(t);
  }, [playing, index, frames, speed, atEnd]);

  useEffect(() => {
    if (atEnd) setPlaying(false);
  }, [atEnd]);

  const frame = frames[index];
  if (!frame) return null;

  const step = (d: number) => {
    setPlaying(false);
    setIndex((i) => Math.max(0, Math.min(frames.length - 1, i + d)));
  };

  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 240px", gap: 16, alignItems: "start" }}>
      <div>
        <PokerTableView state={frame} revealAll={revealAll} />

        {/* Controls */}
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, marginTop: 12 }}>
          <button style={btn("#1f2937")} onClick={() => step(-1)} disabled={index === 0} aria-label="Étape précédente">
            ⏮
          </button>
          <button style={btn(playing ? "#7f1d1d" : "#15803d")} onClick={() => (atEnd ? (setIndex(0), setPlaying(true)) : setPlaying((p) => !p))}>
            {playing ? "⏸ Pause" : atEnd ? "↻ Rejouer" : "▶ Play"}
          </button>
          <button style={btn("#1f2937")} onClick={() => step(1)} disabled={atEnd} aria-label="Étape suivante">
            ⏭
          </button>

          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "#cbd5e1" }}>
            Vitesse
            <input
              type="range"
              min={0.5}
              max={4}
              step={0.5}
              value={speed}
              onChange={(e) => setSpeed(Number(e.target.value))}
              aria-label="Vitesse"
              style={{ accentColor: "#f59e0b" }}
            />
            <span style={{ width: 28, textAlign: "right" }}>{speed}×</span>
          </label>

          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "#cbd5e1", marginLeft: "auto", cursor: "pointer" }}>
            <input type="checkbox" checked={revealAll} onChange={(e) => setRevealAll(e.target.checked)} style={{ accentColor: "#22c55e" }} />
            Révéler toutes les cartes
          </label>

          {onNextHand && (
            <button style={btn("#2563eb")} onClick={onNextHand}>
              Main suivante →
            </button>
          )}
        </div>

        {/* Scrubber */}
        <input
          type="range"
          min={0}
          max={frames.length - 1}
          step={1}
          value={index}
          onChange={(e) => {
            setPlaying(false);
            setIndex(Number(e.target.value));
          }}
          aria-label="Position dans la main"
          style={{ width: "100%", marginTop: 10, accentColor: "#38bdf8" }}
        />
        <div style={{ textAlign: "center", fontSize: 12, color: "#64748b", marginTop: 2 }}>
          frame {index + 1} / {frames.length}
        </div>
      </div>

      {/* Action log */}
      <aside
        style={{
          background: "rgba(255,255,255,0.04)",
          border: "1px solid rgba(255,255,255,0.1)",
          borderRadius: 12,
          padding: 12,
          maxHeight: 520,
          overflowY: "auto",
        }}
      >
        <div style={{ fontSize: 11, letterSpacing: 0.5, textTransform: "uppercase", color: "#94a3b8", marginBottom: 8 }}>
          Historique de la main
        </div>
        <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 4 }}>
          {frames.slice(0, index + 1).map((f, i) => (
            <li
              key={i}
              style={{
                fontSize: 12.5,
                lineHeight: 1.35,
                color: i === index ? "#fbbf24" : f.kind === "award" ? "#22c55e" : "#cbd5e1",
                fontWeight: i === index ? 800 : 500,
              }}
            >
              {f.caption}
            </li>
          ))}
        </ol>
      </aside>
    </div>
  );
}
