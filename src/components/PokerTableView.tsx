/**
 * PokerTableView — PURE 6-max table renderer for the /watch visualiser.
 *
 * Display-only: it draws a Frame (see replayMultiway.ts) — seats placed by table
 * position, 4-colour deck, board, pot (+ side pots), bet chips, dealer button,
 * ante chips, active-seat highlight, winner glow, folded seats greyed. There is
 * NO action panel and NO solver/notation here. The look is lifted from
 * SpotTrainerTable.jsx so the two tables feel identical.
 */

import React from "react";
import type { Position } from "@/engine/state.js";
import type { Frame, SeatFrame } from "@/lib/client/replayMultiway.js";

// ── 4-colour deck ──
const SUITS: Record<string, { glyph: string; color: string; label: string }> = {
  s: { glyph: "♠", color: "#0f0f14", label: "pique" }, // black
  h: { glyph: "♥", color: "#e02544", label: "cœur" }, // red
  d: { glyph: "♦", color: "#1f78ff", label: "carreau" }, // blue
  c: { glyph: "♣", color: "#15a05a", label: "trèfle" }, // green
};

const POS_COLOR: Record<string, string> = {
  BTN: "#f59e0b", SB: "#3b82f6", BB: "#22c55e", UTG: "#a78bfa", HJ: "#f472b6", CO: "#2dd4bf",
};
const posColor = (p: string) => POS_COLOR[p] ?? "#64748b";

// Seat placement around the oval (in % of the container), clockwise.
const SEAT_XY: Record<Position, { x: number; y: number }> = {
  BB: { x: 50, y: 89 },
  UTG: { x: 11, y: 62 },
  HJ: { x: 15, y: 22 },
  CO: { x: 50, y: 11 },
  BTN: { x: 85, y: 22 },
  SB: { x: 89, y: 62 },
};

const parseCard = (str: string) => ({ r: str.slice(0, -1), s: str.slice(-1) });

type CardVariant = "board" | "seat" | "mini";

function Card({
  card,
  variant = "board",
  faceDown = false,
  ghost = false,
}: {
  card?: { r: string; s: string };
  variant?: CardVariant;
  faceDown?: boolean;
  ghost?: boolean;
}) {
  const dims = {
    board: { w: "clamp(34px, 9vw, 52px)", r: "clamp(16px,4.4vw,24px)", c: "clamp(22px,6vw,32px)" },
    seat: { w: "clamp(26px, 7vw, 40px)", r: "clamp(13px,3.6vw,18px)", c: "clamp(17px,4.6vw,25px)" },
    mini: { w: "clamp(22px, 6vw, 32px)", r: "0", c: "0" },
  }[variant];

  const base: React.CSSProperties = {
    width: dims.w,
    aspectRatio: "5 / 7",
    borderRadius: "clamp(4px,1.2vw,8px)",
    flex: "0 0 auto",
    boxSizing: "border-box",
  };

  if (ghost) {
    return <div aria-hidden style={{ ...base, border: "2px dashed rgba(255,255,255,0.18)", background: "rgba(255,255,255,0.03)" }} />;
  }
  if (faceDown || !card) {
    return (
      <div
        aria-hidden
        style={{
          ...base,
          border: "1px solid rgba(255,255,255,0.18)",
          background: "repeating-linear-gradient(45deg, #1e3a8a 0 6px, #1d4ed8 6px 12px)",
          boxShadow: "0 2px 6px rgba(0,0,0,0.5)",
        }}
      />
    );
  }

  const suit = SUITS[card.s]!;
  return (
    <div
      role="img"
      aria-label={`${card.r} de ${suit.label}`}
      style={{
        ...base,
        position: "relative",
        background: "#fff",
        border: "1px solid rgba(0,0,0,0.25)",
        boxShadow: "0 3px 9px rgba(0,0,0,0.55)",
        color: suit.color,
        fontWeight: 800,
        lineHeight: 1,
        userSelect: "none",
      }}
    >
      <div style={{ position: "absolute", top: "6%", left: "8%", display: "flex", flexDirection: "column", alignItems: "center", fontSize: dims.r }}>
        <span>{card.r}</span>
        <span style={{ fontSize: "0.78em", marginTop: "-0.06em" }}>{suit.glyph}</span>
      </div>
      <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", fontSize: dims.c, opacity: 0.96 }}>{suit.glyph}</div>
    </div>
  );
}

function Chip({ amount, tone = "#334155", label }: { amount: number; tone?: string; label?: string }) {
  return (
    <div
      title={label}
      style={{
        minWidth: "clamp(18px,5vw,24px)",
        height: "clamp(18px,5vw,24px)",
        padding: "0 6px",
        borderRadius: 999,
        background: tone,
        border: "2px dashed rgba(255,255,255,0.55)",
        color: "#fff",
        fontSize: "clamp(9px,2.8vw,11px)",
        fontWeight: 800,
        display: "grid",
        placeItems: "center",
        boxShadow: "0 2px 5px rgba(0,0,0,0.5)",
      }}
    >
      {amount}
    </div>
  );
}

function TowardCenter({ pos, factor = 0.26, children }: { pos: Position; factor?: number; children: React.ReactNode }) {
  const { x, y } = SEAT_XY[pos];
  const cx = x + (50 - x) * factor;
  const cy = y + (50 - y) * factor;
  return (
    <div style={{ position: "absolute", left: `${cx}%`, top: `${cy}%`, transform: "translate(-50%, -50%)", zIndex: 4 }}>{children}</div>
  );
}

function SeatBox({ seat, ante, reveal }: { seat: SeatFrame; ante: number; reveal: boolean }) {
  const { x, y } = SEAT_XY[seat.position];
  const showCards = (seat.revealed || reveal) && !seat.folded && seat.cards.length === 2;
  const active = seat.isActor;
  const winner = seat.isWinner;

  const ringColor = winner ? "#22c55e" : active ? "#f59e0b" : null;

  return (
    <div
      style={{
        position: "absolute",
        left: `${x}%`,
        top: `${y}%`,
        transform: "translate(-50%, -50%)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 3,
        opacity: seat.folded ? 0.4 : 1,
        filter: seat.folded ? "grayscale(1)" : "none",
        transition: "opacity .2s ease, filter .2s ease",
        zIndex: active || winner ? 6 : 3,
        width: "max-content",
      }}
    >
      {!seat.folded && (
        <div style={{ display: "flex", gap: 3, marginBottom: 2 }}>
          {showCards ? (
            <>
              <Card card={parseCard(seat.cards[0]!)} variant="seat" />
              <Card card={parseCard(seat.cards[1]!)} variant="seat" />
            </>
          ) : (
            <>
              <Card variant="mini" faceDown />
              <Card variant="mini" faceDown />
            </>
          )}
        </div>
      )}

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 7,
          padding: "4px 9px 4px 4px",
          borderRadius: 999,
          background: ringColor ? `${ringColor}22` : "rgba(10,12,18,0.82)",
          border: ringColor ? `2px solid ${ringColor}` : "1px solid rgba(255,255,255,0.12)",
          boxShadow: ringColor ? `0 0 0 4px ${ringColor}33, 0 4px 12px rgba(0,0,0,0.5)` : "0 4px 12px rgba(0,0,0,0.45)",
          transition: "box-shadow .2s ease, border-color .2s ease, background .2s ease",
        }}
      >
        <div
          style={{
            width: "clamp(24px,6.4vw,32px)",
            height: "clamp(24px,6.4vw,32px)",
            borderRadius: "50%",
            background: `linear-gradient(135deg, ${posColor(seat.position)}, #0b0d12)`,
            color: "#fff",
            display: "grid",
            placeItems: "center",
            fontWeight: 800,
            fontSize: "clamp(11px,3.2vw,14px)",
            flex: "0 0 auto",
          }}
        >
          {seat.name[0]}
        </div>
        <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.15 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: "clamp(10px,2.8vw,12px)", color: "#e5e7eb", fontWeight: 700 }}>
            <span>{seat.name}</span>
            <span
              style={{
                fontSize: "clamp(8px,2.2vw,9px)",
                fontWeight: 800,
                letterSpacing: 0.4,
                padding: "1px 5px",
                borderRadius: 5,
                color: "#0b0d12",
                background: posColor(seat.position),
              }}
            >
              {seat.position}
            </span>
            {seat.allIn && !seat.folded && (
              <span style={{ fontSize: "clamp(7px,2vw,9px)", fontWeight: 800, color: "#fca5a5" }}>ALL-IN</span>
            )}
          </div>
          <span style={{ fontSize: "clamp(9px,2.6vw,11px)", color: "#9ca3af" }}>
            {seat.folded ? "couché" : `${seat.stack} `}
            {!seat.folded && <span style={{ color: "#64748b" }}>$</span>}
          </span>
        </div>
      </div>

      {!seat.folded && ante > 0 && <Chip amount={ante} tone="#1e293b" label={`ante ${ante}`} />}
    </div>
  );
}

export default function PokerTableView({ state, revealAll = false }: { state: Frame; revealAll?: boolean }) {
  const board = state.board.map(parseCard);
  const buttonSeat = state.seats.find((s) => s.isButton);

  return (
    <div
      className="watch-table"
      style={{
        width: "100%",
        background: "radial-gradient(120% 120% at 50% 0%, #0b0d13 0%, #050608 70%)",
        color: "#e5e7eb",
        fontFamily: "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
        boxSizing: "border-box",
        padding: "clamp(8px,2.5vw,16px)",
        borderRadius: 16,
      }}
    >
      <style>{`@media (prefers-reduced-motion: reduce){ .watch-table *{ transition:none !important; } }`}</style>

      <div style={{ position: "relative", width: "100%", aspectRatio: "1.42 / 1", margin: "0 auto" }}>
        {/* rail + felt */}
        <div style={{ position: "absolute", inset: "8%", borderRadius: "50% / 50%", background: "linear-gradient(#1a1d24, #0c0e13)", padding: "clamp(8px,2.4vw,16px)", boxShadow: "0 18px 40px rgba(0,0,0,0.7)" }}>
          <div
            style={{
              position: "absolute",
              inset: "clamp(8px,2.4vw,16px)",
              borderRadius: "50% / 50%",
              background: "radial-gradient(120% 120% at 50% 38%, #1f7a6e 0%, #145e55 48%, #0c413b 100%)",
              border: "2px solid rgba(0,0,0,0.4)",
              boxShadow: "inset 0 8px 30px rgba(0,0,0,0.45)",
            }}
          />
        </div>

        {/* board */}
        <div style={{ position: "absolute", left: "50%", top: "40%", transform: "translate(-50%, -50%)", display: "flex", gap: "clamp(3px,1.4vw,7px)", zIndex: 2 }}>
          {[0, 1, 2, 3, 4].map((i) => (board[i] ? <Card key={i} card={board[i]} variant="board" /> : <Card key={i} variant="board" ghost />))}
        </div>

        {/* pot */}
        <div style={{ position: "absolute", left: "50%", top: "61%", transform: "translate(-50%, -50%)", textAlign: "center", zIndex: 2 }}>
          <div style={{ padding: "4px 15px", borderRadius: 999, background: "rgba(0,0,0,0.55)", border: "1px solid rgba(255,255,255,0.15)", fontWeight: 800, fontSize: "clamp(12px,3.4vw,15px)" }}>
            POT {state.pot}
          </div>
          {state.pots.length > 1 && (
            <div style={{ marginTop: 4, fontSize: "clamp(9px,2.4vw,11px)", color: "#94a3b8" }}>
              {state.pots.map((p) => `${p.label} ${p.amount}`).join(" · ")}
            </div>
          )}
        </div>

        {/* seats */}
        {state.seats.map((s) => (
          <SeatBox key={s.seat} seat={s} ante={state.ante} reveal={revealAll} />
        ))}

        {/* dealer button */}
        {buttonSeat && (
          <TowardCenter pos={buttonSeat.position} factor={0.16}>
            <div style={{ width: "clamp(18px,5vw,24px)", height: "clamp(18px,5vw,24px)", borderRadius: "50%", background: "#f8fafc", color: "#0b0d12", fontWeight: 900, fontSize: "clamp(10px,2.8vw,13px)", display: "grid", placeItems: "center", boxShadow: "0 2px 6px rgba(0,0,0,0.6)" }}>
              D
            </div>
          </TowardCenter>
        )}

        {/* bet chips in front of seats that have wagered this street */}
        {state.seats
          .filter((s) => s.bet > 0 && !s.folded)
          .map((s) => (
            <TowardCenter key={`bet-${s.seat}`} pos={s.position} factor={0.4}>
              <Chip amount={s.bet} tone="#b45309" label={`mise ${s.bet}`} />
            </TowardCenter>
          ))}
      </div>

      {/* caption (last action / event) */}
      <div style={{ textAlign: "center", marginTop: "clamp(6px,2vw,12px)", fontSize: "clamp(12px,3.2vw,15px)", fontWeight: 700, color: state.kind === "award" ? "#22c55e" : "#cbd5e1", minHeight: 20 }}>
        {state.caption}
      </div>
    </div>
  );
}
