"use client";

/**
 * HandReplayer — drives a list of Frames (from replayMultiway) over a poker
 * table. Modern dark control bar: skip-back / play-pause / skip-forward icon
 * buttons, a teal speed slider, a switch toggle to reveal all cards (opponents
 * hidden until showdown by default), and a teal "Main suivante" primary button.
 * A styled action-history panel sits beside the table.
 */

import React, { useEffect, useState } from "react";
import PokerTableView from "@/components/PokerTableView.js";
import { THEME as C } from "@/lib/theme.js";
import { FRAME_MS, type Frame } from "@/lib/client/replayMultiway.js";

// Action-tag colours for the log (from the shared theme).
const ACTION_COLOR = C.action as Record<string, string | undefined>;

function IconButton({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button className="wr-icon" aria-label={label} onClick={onClick} disabled={disabled} style={{ opacity: disabled ? 0.4 : 1 }}>
      {children}
    </button>
  );
}

function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: C.text2, cursor: "pointer", userSelect: "none" }}>
      <span
        role="switch"
        aria-checked={checked}
        tabIndex={0}
        onClick={() => onChange(!checked)}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onChange(!checked))}
        style={{
          width: 38,
          height: 22,
          borderRadius: 999,
          background: checked ? C.teal : "rgba(255,255,255,0.14)",
          border: `1px solid ${checked ? C.teal : C.border}`,
          position: "relative",
          transition: "background .18s ease",
          flex: "0 0 auto",
        }}
      >
        <span
          style={{
            position: "absolute",
            top: 2,
            left: checked ? 18 : 2,
            width: 16,
            height: 16,
            borderRadius: "50%",
            background: "#0E1117",
            transition: "left .18s ease",
          }}
        />
      </span>
      {label}
    </label>
  );
}

export default function HandReplayer({ frames, onNextHand }: { frames: Frame[]; onNextHand?: () => void }) {
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [revealAll, setRevealAll] = useState(false);

  useEffect(() => {
    setIndex(0);
    setPlaying(true);
  }, [frames]);

  const atEnd = index >= frames.length - 1;

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
  const togglePlay = () => (atEnd ? (setIndex(0), setPlaying(true)) : setPlaying((p) => !p));

  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 252px", gap: 18, alignItems: "start" }}>
      <style>{`
        .wr-icon { appearance:none; width:42px; height:42px; border-radius:11px; border:1px solid ${C.border};
          background:#0E1117; color:${C.text}; font-size:16px; cursor:pointer; display:grid; place-items:center;
          transition: background .15s ease, border-color .15s ease, transform .08s ease; }
        .wr-icon:hover:not(:disabled){ background:#1F2530; border-color:rgba(255,255,255,0.18); }
        .wr-icon:active:not(:disabled){ transform:scale(0.94); }
        .wr-primary { appearance:none; border:none; border-radius:11px; background:${C.teal}; color:#08130F;
          font-weight:800; font-size:14px; padding:0 18px; height:42px; cursor:pointer;
          transition: filter .15s ease, transform .08s ease; }
        .wr-primary:hover{ filter:brightness(1.08); }
        .wr-primary:active{ transform:scale(0.97); }
        .wr-range { accent-color:${C.teal}; cursor:pointer; }
        .wr-scrub { accent-color:#38bdf8; cursor:pointer; }
      `}</style>

      <div>
        <PokerTableView state={frame} revealAll={revealAll} />

        {/* Caption */}
        <div style={{ textAlign: "center", marginTop: 12, minHeight: 22, fontSize: 15, fontWeight: 700, color: frame.kind === "award" ? C.teal : C.text }}>
          {frame.caption}
        </div>

        {/* Control bar */}
        <div
          style={{
            marginTop: 12,
            padding: "12px 14px",
            background: C.surface,
            border: `1px solid ${C.border}`,
            borderRadius: 14,
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            gap: 14,
          }}
        >
          <div style={{ display: "flex", gap: 8 }}>
            <IconButton label="Étape précédente" onClick={() => step(-1)} disabled={index === 0}>
              ⏮
            </IconButton>
            <IconButton label={playing ? "Pause" : "Lecture"} onClick={togglePlay}>
              {playing ? "⏸" : atEnd ? "↻" : "▶"}
            </IconButton>
            <IconButton label="Étape suivante" onClick={() => step(1)} disabled={atEnd}>
              ⏭
            </IconButton>
          </div>

          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: C.text2 }}>
            Vitesse
            <input className="wr-range" type="range" min={0.5} max={4} step={0.5} value={speed} onChange={(e) => setSpeed(Number(e.target.value))} aria-label="Vitesse" />
            <span style={{ width: 26, textAlign: "right", fontVariantNumeric: "tabular-nums", color: C.text }}>{speed}×</span>
          </label>

          <Switch checked={revealAll} onChange={setRevealAll} label="Révéler les cartes" />

          {onNextHand && (
            <button className="wr-primary" style={{ marginLeft: "auto" }} onClick={onNextHand}>
              Main suivante →
            </button>
          )}
        </div>

        {/* Scrubber */}
        <input
          className="wr-scrub"
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
          style={{ width: "100%", marginTop: 12 }}
        />
        <div style={{ textAlign: "center", fontSize: 12, color: C.text3, marginTop: 4, fontVariantNumeric: "tabular-nums" }}>
          {index + 1} / {frames.length}
        </div>
      </div>

      {/* Action log */}
      <aside style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14, padding: 14, maxHeight: 540, overflowY: "auto" }}>
        <div style={{ fontSize: 11, letterSpacing: 0.8, textTransform: "uppercase", color: C.text3, marginBottom: 10, fontWeight: 700 }}>
          Historique de la main
        </div>
        <ol style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {frames.slice(0, index + 1).map((f, i) => {
            const isCurrent = i === index;
            const isAward = f.kind === "award";
            const tagColor = f.actionType ? ACTION_COLOR[f.actionType] : undefined;
            return (
              <li
                key={i}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  fontSize: 12.5,
                  lineHeight: 1.4,
                  padding: "6px 8px",
                  borderRadius: 8,
                  borderTop: i === 0 ? "none" : `1px solid rgba(255,255,255,0.04)`,
                  background: isAward ? "rgba(224,169,59,0.10)" : isCurrent ? "rgba(45,212,167,0.08)" : "transparent",
                  color: isAward ? "#E0A93B" : isCurrent ? C.text : C.text2,
                  fontWeight: isCurrent || isAward ? 700 : 500,
                }}
              >
                <span style={{ width: 3, alignSelf: "stretch", borderRadius: 2, background: isAward ? "#E0A93B" : tagColor ?? "transparent", flex: "0 0 auto" }} />
                <span>{f.caption}</span>
              </li>
            );
          })}
        </ol>
      </aside>
    </div>
  );
}
