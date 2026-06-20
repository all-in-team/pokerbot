/**
 * PokerTableView — PURE 6-max table renderer for the /watch visualiser.
 *
 * Display-only: it draws a Frame (see replayMultiway.ts) — seats placed by table
 * position, 4-colour deck, board, pot (+ side pots), bet chips on the bet line,
 * dealer button, ante chips, active-seat highlight, winner glow, folded seats
 * greyed. NO action panel, NO solver/notation. Modern dark "study tool" look.
 */

import React from "react";
import { THEME as C } from "@/lib/theme.js";
import type { Position } from "@/engine/state.js";
import type { Frame, SeatFrame } from "@/lib/client/replayMultiway.js";

// 4-colour deck + position chips come from the shared theme.
const SUITS = C.suits;
const posColor = (p: string) => C.pos[p] ?? "#6B7280";

// Seat placement around the oval (% of container), clockwise.
const SEAT_XY: Record<Position, { x: number; y: number }> = {
  BB: { x: 50, y: 90 },
  UTG: { x: 9, y: 64 },
  HJ: { x: 14, y: 22 },
  CO: { x: 50, y: 9 },
  BTN: { x: 86, y: 22 },
  SB: { x: 91, y: 64 },
};

// Screen slots clockwise from the BOTTOM — used when a hero seat is pinned at
// the bottom (e.g. /play). Slot 0 is the bottom (the human).
const SLOTS: { x: number; y: number }[] = [
  SEAT_XY.BB, SEAT_XY.UTG, SEAT_XY.HJ, SEAT_XY.CO, SEAT_XY.BTN, SEAT_XY.SB,
];

const parseCard = (str: string) => ({ r: str.slice(0, -1), s: str.slice(-1) });

const TAB: React.CSSProperties = { fontVariantNumeric: "tabular-nums" };

type CardVariant = "board" | "seat" | "back";

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
    board: { w: "clamp(36px, 9vw, 54px)", r: "clamp(15px,4vw,21px)", c: "clamp(20px,5.4vw,30px)" },
    seat: { w: "clamp(30px, 7.5vw, 44px)", r: "clamp(13px,3.4vw,18px)", c: "clamp(17px,4.4vw,25px)" },
    back: { w: "clamp(26px, 6.4vw, 36px)", r: "0", c: "0" },
  }[variant];

  const base: React.CSSProperties = {
    width: dims.w,
    aspectRatio: "5 / 7",
    borderRadius: 9,
    flex: "0 0 auto",
    boxSizing: "border-box",
  };

  if (ghost) {
    return <div aria-hidden style={{ ...base, border: "1px dashed rgba(255,255,255,0.12)", background: "rgba(255,255,255,0.02)" }} />;
  }
  if (faceDown || !card) {
    return (
      <div
        aria-hidden
        style={{
          ...base,
          border: "1px solid rgba(255,255,255,0.10)",
          background: "linear-gradient(135deg, #243044 0%, #1b2433 100%)",
          boxShadow: "0 2px 6px rgba(0,0,0,0.35)",
        }}
      >
        <div style={{ width: "100%", height: "100%", borderRadius: 9, background: "repeating-linear-gradient(45deg, rgba(45,212,167,0.10) 0 7px, transparent 7px 14px)" }} />
      </div>
    );
  }

  const suit = SUITS[card.s]!;
  // Force TEXT (not emoji) presentation so the 4-colour scheme is respected and no
  // suit renders as a coloured square / broken glyph.
  const glyph = `${suit.glyph}\uFE0E`;
  return (
    <div
      role="img"
      className="pt-card-in"
      aria-label={`${card.r} de ${suit.label}`}
      style={{
        ...base,
        position: "relative",
        background: "#FFFFFF",
        boxShadow: "0 2px 6px rgba(0,0,0,0.35)",
        color: suit.color,
        fontWeight: 800,
        lineHeight: 1,
        userSelect: "none",
      }}
    >
      {/* Corner index: rank only — the single suit pip lives in the centre (no duplicate). */}
      <span style={{ position: "absolute", top: "6%", left: "9%", fontSize: dims.r }}>{card.r}</span>
      {/* One clean, clearly-coloured suit pip. */}
      <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", fontSize: dims.c }}>{glyph}</div>
    </div>
  );
}

/** A bet chip on the bet line between a seat and the pot. */
function BetChip({ amount }: { amount: number }) {
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        padding: "2px 9px 2px 4px",
        borderRadius: 999,
        background: "rgba(14,17,23,0.9)",
        border: `1px solid ${C.gold}66`,
        boxShadow: "0 2px 6px rgba(0,0,0,0.5)",
      }}
    >
      <span style={{ width: 12, height: 12, borderRadius: "50%", background: C.gold, boxShadow: "inset 0 0 0 2px rgba(0,0,0,0.3)" }} />
      <span style={{ ...TAB, color: C.gold, fontWeight: 800, fontSize: "clamp(10px,2.8vw,12px)" }}>{amount}</span>
    </div>
  );
}

function Positioned({ xy, factor, z = 4, children }: { xy: { x: number; y: number }; factor: number; z?: number; children: React.ReactNode }) {
  const cx = xy.x + (50 - xy.x) * factor;
  const cy = xy.y + (50 - xy.y) * factor;
  return (
    <div style={{ position: "absolute", left: `${cx}%`, top: `${cy}%`, transform: "translate(-50%, -50%)", zIndex: z }}>{children}</div>
  );
}

function SeatPod({ seat, xy, ante, reveal }: { seat: SeatFrame; xy: { x: number; y: number }; ante: number; reveal: boolean }) {
  const { x, y } = xy;
  // Dealer button sits OUTSIDE the pod on its inner side (toward the table centre),
  // vertically centred → never over the cards / name / stack / position / bet.
  const dealerSide: React.CSSProperties = x <= 50 ? { left: "calc(100% + 8px)" } : { right: "calc(100% + 8px)" };
  const hasCards = seat.cards.length === 2;
  // Face up when this seat's cards are revealed (showdown) or a full reveal is on
  // (study mode) — this is what turns FOLDED hands face-up at hand end too.
  const faceUp = (seat.revealed || reveal) && hasCards;
  // Render a card block for live seats (backs) and for any seat we're revealing.
  const showCardBlock = !seat.folded || (reveal && hasCards);
  const ring = seat.isWinner ? C.teal : seat.isActor ? C.teal : null;
  const winnerGlow = seat.isWinner;

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
        gap: 5,
        // Folded seats dim; when revealing (study), keep them legible (no grayscale).
        opacity: seat.folded ? (reveal ? 0.72 : 0.4) : 1,
        filter: seat.folded && !reveal ? "grayscale(1)" : "none",
        transition: "opacity .2s ease, filter .2s ease",
        zIndex: seat.isActor || seat.isWinner ? 6 : 3,
        width: "max-content",
      }}
    >
      {showCardBlock && (
        <div style={{ display: "flex", gap: 4 }}>
          {faceUp ? (
            <>
              <Card card={parseCard(seat.cards[0]!)} variant="seat" />
              <Card card={parseCard(seat.cards[1]!)} variant="seat" />
            </>
          ) : (
            <>
              <Card variant="back" faceDown />
              <Card variant="back" faceDown />
            </>
          )}
        </div>
      )}

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "6px 11px 6px 7px",
          borderRadius: 12,
          background: C.surface,
          border: ring ? `2px solid ${ring}` : `1px solid ${C.border}`,
          boxShadow: winnerGlow
            ? `0 0 0 4px ${C.teal}2e, 0 8px 22px rgba(0,0,0,0.5)`
            : seat.isActor
              ? `0 0 0 4px ${C.teal}1f, 0 6px 16px rgba(0,0,0,0.45)`
              : "0 6px 16px rgba(0,0,0,0.4)",
          transition: "box-shadow .18s ease, border-color .18s ease",
        }}
      >
        <div
          style={{
            width: "clamp(24px,6.2vw,32px)",
            height: "clamp(24px,6.2vw,32px)",
            borderRadius: 9,
            background: "#0E1117",
            border: `1px solid ${C.border}`,
            color: C.text,
            display: "grid",
            placeItems: "center",
            fontWeight: 800,
            fontSize: "clamp(11px,3vw,13px)",
            flex: "0 0 auto",
          }}
        >
          {seat.name.replace(/[^0-9]/g, "") || seat.name[0]}
        </div>
        <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.2, gap: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "clamp(10px,2.8vw,12px)", color: C.text, fontWeight: 700 }}>
            <span>{seat.name}</span>
            <span
              style={{
                fontSize: "clamp(7px,2vw,9px)",
                fontWeight: 800,
                letterSpacing: 0.5,
                padding: "1px 5px",
                borderRadius: 5,
                color: "#0E1117",
                background: posColor(seat.position),
              }}
            >
              {seat.position}
            </span>
            {seat.allIn && !seat.folded && (
              <span style={{ fontSize: "clamp(7px,2vw,9px)", fontWeight: 800, color: "#F08A8A" }}>ALL-IN</span>
            )}
          </div>
          <span style={{ ...TAB, fontSize: "clamp(10px,2.6vw,12px)", color: seat.isWinner ? C.gold : C.text2, fontWeight: 600 }}>
            {seat.folded ? "couché" : seat.stack}
          </span>
        </div>
      </div>

      {!seat.folded && ante > 0 && (
        <span style={{ ...TAB, fontSize: "clamp(8px,2.2vw,10px)", color: C.text3 }}>ante {ante}</span>
      )}

      {seat.isButton && (
        <div
          aria-label="bouton du donneur"
          style={{
            position: "absolute",
            top: "50%",
            transform: "translateY(-50%)",
            ...dealerSide,
            width: "clamp(22px,5.4vw,28px)",
            height: "clamp(22px,5.4vw,28px)",
            borderRadius: "50%",
            background: "#F4F1E8",
            color: "#0E1117",
            fontWeight: 900,
            fontSize: "clamp(11px,3vw,14px)",
            display: "grid",
            placeItems: "center",
            boxShadow: "0 3px 8px rgba(0,0,0,0.55)",
            border: "1px solid rgba(0,0,0,0.25)",
            zIndex: 7,
          }}
        >
          D
        </div>
      )}
    </div>
  );
}

export default function PokerTableView({
  state,
  revealAll = false,
  heroSeat,
}: {
  state: Frame;
  revealAll?: boolean;
  /** When set, this seat is pinned at the bottom and others fill clockwise. */
  heroSeat?: number;
}) {
  const board = state.board.map(parseCard);
  const climax = state.kind === "award";
  const n = state.seats.length;
  // Screen coords for a seat: pinned-to-hero layout if heroSeat is set, else
  // the position-label layout used by /watch.
  const xyOf = (seat: SeatFrame): { x: number; y: number } =>
    heroSeat != null ? SLOTS[(((seat.seat - heroSeat) % n) + n) % n] ?? SEAT_XY[seat.position] : SEAT_XY[seat.position];

  return (
    <div
      className="watch-table"
      style={{
        width: "100%",
        background: C.surface,
        color: C.text,
        fontFamily: "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
        boxSizing: "border-box",
        padding: "clamp(10px,3vw,22px)",
        borderRadius: 16,
        border: `1px solid ${C.border}`,
      }}
    >
      <style>{`@media (prefers-reduced-motion: reduce){ .watch-table *{ transition:none !important; } }`}</style>

      <div style={{ position: "relative", width: "100%", aspectRatio: "1.5 / 1", margin: "0 auto" }}>
        {/* rail + refined felt */}
        <div style={{ position: "absolute", inset: "6%", borderRadius: "50% / 50%", background: "#0E1117", padding: "clamp(7px,2vw,13px)", boxShadow: "0 24px 50px rgba(0,0,0,0.6)" }}>
          <div
            style={{
              position: "absolute",
              inset: "clamp(7px,2vw,13px)",
              borderRadius: "50% / 50%",
              background: "radial-gradient(120% 120% at 50% 36%, #1E4A3C 0%, #163A2F 100%)",
              border: "1px solid #2A5446",
              boxShadow: "inset 0 6px 26px rgba(0,0,0,0.4)",
            }}
          />
        </div>

        {/* board */}
        <div style={{ position: "absolute", left: "50%", top: "39%", transform: "translate(-50%, -50%)", display: "flex", gap: "clamp(4px,1.4vw,8px)", zIndex: 2 }}>
          {[0, 1, 2, 3, 4].map((i) => (board[i] ? <Card key={i} card={board[i]} variant="board" /> : <Card key={i} variant="board" ghost />))}
        </div>

        {/* pot */}
        <div style={{ position: "absolute", left: "50%", top: "62%", transform: "translate(-50%, -50%)", textAlign: "center", zIndex: 2 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
            <span style={{ width: 14, height: 14, borderRadius: "50%", background: C.gold, boxShadow: "inset 0 0 0 2px rgba(0,0,0,0.3)" }} />
            <div style={{ textAlign: "left", lineHeight: 1 }}>
              <div style={{ fontSize: 10, letterSpacing: 1.5, color: C.text3, fontWeight: 700 }}>{climax ? "GAGNÉ" : "POT"}</div>
              <div style={{ ...TAB, fontSize: 26, fontWeight: 800, color: climax ? C.gold : "#FFFFFF", marginTop: 2 }}>{state.pot}</div>
            </div>
          </div>
          {state.pots.length > 1 && (
            <div style={{ ...TAB, marginTop: 6, fontSize: "clamp(9px,2.4vw,11px)", color: C.text2 }}>
              {state.pots.map((p) => `${p.label} ${p.amount}`).join(" · ")}
            </div>
          )}
        </div>

        {/* seats */}
        {state.seats.map((s) => (
          <SeatPod key={s.seat} seat={s} xy={xyOf(s)} ante={state.ante} reveal={revealAll} />
        ))}

        {/* bet chips on the bet line (never on the cards) */}
        {state.seats
          .filter((s) => s.bet > 0 && !s.folded)
          .map((s) => (
            <Positioned key={`bet-${s.seat}`} xy={xyOf(s)} factor={0.42}>
              <BetChip amount={s.bet} />
            </Positioned>
          ))}
      </div>
    </div>
  );
}
