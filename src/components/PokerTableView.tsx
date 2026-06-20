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

// Screen slots when a hero seat is pinned at the bottom (e.g. /play). Slot 0 is
// the hero; slots 1..5 are the opponents clockwise. TWO layouts:
//  - MOBILE: a compact arc with the 5 opponents clustered at the top, so the
//    hero's big cards own the bottom of a narrow, near-portrait table.
//  - DESKTOP: a classic WIDE oval with the 6 players spread evenly around the
//    whole perimeter, using the horizontal space.
const SLOTS_MOBILE: { x: number; y: number }[] = [
  { x: 50, y: 86 }, // 0 hero (bottom-centre)
  { x: 13, y: 31 }, // 1 lower-left  (second row, side)
  { x: 25, y: 9 }, //  2 upper-left  (top row)
  { x: 50, y: 9 }, //  3 top-centre  (top row)
  { x: 75, y: 9 }, //  4 upper-right (top row)
  { x: 87, y: 31 }, // 5 lower-right (second row, side)
];
const SLOTS_DESKTOP: { x: number; y: number }[] = [
  { x: 50, y: 87 }, // 0 hero (bottom-centre)
  { x: 13, y: 70 }, // 1 lower-left
  { x: 10, y: 32 }, // 2 upper-left
  { x: 50, y: 13 }, // 3 top-centre
  { x: 90, y: 32 }, // 4 upper-right
  { x: 87, y: 70 }, // 5 lower-right
];

const parseCard = (str: string) => ({ r: str.slice(0, -1), s: str.slice(-1) });

const TAB: React.CSSProperties = { fontVariantNumeric: "tabular-nums" };

/** True on wide (lg+) screens — switches /play between desktop oval and mobile arc. */
function useIsWide(minPx = 1024): boolean {
  const read = () =>
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia(`(min-width:${minPx}px)`).matches
      : true; // default to desktop (SSR / no matchMedia)
  const [wide, setWide] = React.useState<boolean>(read);
  React.useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia(`(min-width:${minPx}px)`);
    const on = () => setWide(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [minPx]);
  return wide;
}

/**
 * Absolute placement for a seat. The hero is pinned bottom-centre (both layouts).
 * On desktop, opponents are CENTRED on their oval point (room to spare); on mobile
 * they're ANCHORED toward the centre so a compact table never overflows an edge.
 */
function seatPlacement(x: number, y: number, isWide: boolean, isHero: boolean): React.CSSProperties {
  if (isHero) return { left: "50%", bottom: isWide ? "4%" : "2%", transform: "translateX(-50%)" };
  if (isWide) return { left: `${x}%`, top: `${y}%`, transform: "translate(-50%, -50%)" };
  const cxC = x > 49 && x < 51;
  const cyC = y > 49 && y < 51;
  return {
    ...(cxC ? { left: "50%" } : x < 50 ? { left: `${x}%` } : { right: `${100 - x}%` }),
    ...(cyC ? { top: "50%" } : y < 50 ? { top: `${y}%` } : { bottom: `${100 - y}%` }),
    transform: `translate(${cxC ? "-50%" : "0"}, ${cyC ? "-50%" : "0"})`,
  };
}

type CardVariant = "board" | "seat" | "back" | "hero";

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
  // Sizes scale with the TABLE container width (cqw) and cap on large screens, so
  // the table fits any container (mobile full-width or desktop column) without
  // overflowing or overlapping.
  const dims = {
    board: { w: "min(52px, 11cqw)", r: "min(20px, 4.3cqw)", c: "min(29px, 6.2cqw)" },
    seat: { w: "min(34px, 7cqw)", r: "min(15px, 3cqw)", c: "min(21px, 4.3cqw)" },
    back: { w: "min(26px, 5.4cqw)", r: "0", c: "0" },
    hero: { w: "min(66px, 15cqw)", r: "min(25px, 5.6cqw)", c: "min(36px, 8cqw)" },
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
      <span style={{ ...TAB, color: C.gold, fontWeight: 800, fontSize: "min(12px, 2.2cqw)" }}>{amount}</span>
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

function SeatPod({ seat, seatX, posStyle, reveal, isHero = false }: { seat: SeatFrame; seatX: number; posStyle: React.CSSProperties; reveal: boolean; isHero?: boolean }) {
  const hasCards = seat.cards.length === 2;
  // Face up when this seat's cards are revealed (showdown / study full-reveal), or
  // always for the hero. Folded hands stay face-up only when revealing.
  const faceUp = (seat.revealed || reveal) && hasCards;
  const showCardBlock = !seat.folded || (reveal && hasCards);
  const ring = seat.isWinner ? C.teal : seat.isActor ? C.teal : null;
  const winnerGlow = seat.isWinner;
  const cardVariant: CardVariant = isHero ? "hero" : "seat";

  // The hand: big for the hero, compact backs/faces for opponents.
  const cardBlock = showCardBlock ? (
    <div style={{ display: "flex", gap: isHero ? 6 : 3 }}>
      {faceUp ? (
        <>
          <Card card={parseCard(seat.cards[0]!)} variant={cardVariant} />
          <Card card={parseCard(seat.cards[1]!)} variant={cardVariant} />
        </>
      ) : (
        <>
          <Card variant="back" faceDown />
          <Card variant="back" faceDown />
        </>
      )}
    </div>
  ) : null;

  // Compact info plate (avatar + name/stack/position). Same for everyone.
  const podBox = (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "min(8px, 1.4cqw)",
        padding: "min(6px,1.1cqw) min(11px,1.9cqw)",
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
          width: "min(30px, 5cqw)",
          height: "min(30px, 5cqw)",
          borderRadius: 9,
          background: "#0E1117",
          border: `1px solid ${C.border}`,
          color: C.text,
          display: "grid",
          placeItems: "center",
          fontWeight: 800,
          fontSize: "min(13px, 2.3cqw)",
          flex: "0 0 auto",
        }}
      >
        {seat.name.replace(/[^0-9]/g, "") || seat.name[0]}
      </div>
      <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.2, gap: 1 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "min(12px, 2.1cqw)", color: C.text, fontWeight: 700 }}>
          <span>{seat.name}</span>
          <span
            style={{
              fontSize: "min(9px, 1.6cqw)",
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
            <span style={{ fontSize: "min(9px, 1.6cqw)", fontWeight: 800, color: "#F08A8A" }}>ALL-IN</span>
          )}
        </div>
        <span style={{ ...TAB, fontSize: "min(12px, 2cqw)", color: seat.isWinner ? C.gold : C.text2, fontWeight: 600 }}>
          {seat.folded ? "couché" : seat.stack}
        </span>
      </div>
    </div>
  );

  const dealerSide: React.CSSProperties = seatX <= 50 ? { left: "calc(100% + 8px)" } : { right: "calc(100% + 8px)" };
  const dealerBtn = seat.isButton ? (
    <div
      aria-label="bouton du donneur"
      style={{
        position: "absolute",
        top: "50%",
        transform: "translateY(-50%)",
        ...dealerSide,
        width: "min(28px, 4.4cqw)",
        height: "min(28px, 4.4cqw)",
        borderRadius: "50%",
        background: "#F4F1E8",
        color: "#0E1117",
        fontWeight: 900,
        fontSize: "min(14px, 2.3cqw)",
        display: "grid",
        placeItems: "center",
        boxShadow: "0 3px 8px rgba(0,0,0,0.55)",
        border: "1px solid rgba(0,0,0,0.25)",
        zIndex: 7,
      }}
    >
      D
    </div>
  ) : null;

  return (
    <div
      style={{
        position: "absolute",
        ...posStyle,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: isHero ? "min(6px, 1.4cqw)" : 4,
        opacity: seat.folded ? (reveal ? 0.72 : 0.4) : 1,
        filter: seat.folded && !reveal ? "grayscale(1)" : "none",
        transition: "opacity .2s ease, filter .2s ease",
        zIndex: isHero ? 8 : seat.isActor || seat.isWinner ? 6 : 3,
        width: "max-content",
      }}
    >
      {cardBlock}
      {podBox}
      {dealerBtn}
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
  const heroPinned = heroSeat != null;
  const isWide = useIsWide();
  // Hero-pinned uses two distinct layouts; /watch keeps its position-label oval.
  const SLOTS = isWide ? SLOTS_DESKTOP : SLOTS_MOBILE;
  const xyOf = (seat: SeatFrame): { x: number; y: number } =>
    heroPinned ? SLOTS[(((seat.seat - heroSeat!) % n) + n) % n] ?? SEAT_XY[seat.position] : SEAT_XY[seat.position];
  // Pot sits just ABOVE the centred board; bottom reserved for the hero's cards.
  const boardTop = heroPinned ? (isWide ? "50%" : "57%") : "39%";
  const potTop = heroPinned ? (isWide ? "34%" : "42%") : "62%";
  const betFactor = heroPinned ? (isWide ? 0.42 : 0.62) : 0.42;
  // Wide oval on desktop, near-portrait on mobile (room for the hero's big cards).
  const aspectStyle: React.CSSProperties = heroPinned ? { aspectRatio: isWide ? "1.6 / 1" : "0.85 / 1" } : {};

  return (
    <div
      className="watch-table"
      style={{
        width: "100%",
        // Establish a container so all inner sizes scale with the TABLE width
        // (cqw units) — fits any column / phone width without overflow.
        containerType: "inline-size",
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

      {/* Wide oval on desktop, near-portrait on mobile (hero-pinned); /watch keeps
          its container-query aspect via the class. */}
      <div className="pt-table-aspect" style={{ position: "relative", width: "100%", margin: "0 auto", ...aspectStyle }}>
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

        {/* board (centred) */}
        <div style={{ position: "absolute", left: "50%", top: boardTop, transform: "translate(-50%, -50%)", display: "flex", gap: "min(8px, 1.3cqw)", zIndex: 2 }}>
          {[0, 1, 2, 3, 4].map((i) => (board[i] ? <Card key={i} card={board[i]} variant="board" /> : <Card key={i} variant="board" ghost />))}
        </div>

        {/* pot (above the board) */}
        <div style={{ position: "absolute", left: "50%", top: potTop, transform: "translate(-50%, -50%)", textAlign: "center", zIndex: 2 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "min(8px, 1.5cqw)" }}>
            <span style={{ width: "min(14px, 2.6cqw)", height: "min(14px, 2.6cqw)", borderRadius: "50%", background: C.gold, boxShadow: "inset 0 0 0 2px rgba(0,0,0,0.3)" }} />
            <div style={{ textAlign: "left", lineHeight: 1 }}>
              <div style={{ fontSize: "min(10px, 1.9cqw)", letterSpacing: 1.5, color: C.text3, fontWeight: 700 }}>{climax ? "GAGNÉ" : "POT"}</div>
              <div style={{ ...TAB, fontSize: "min(26px, 5.2cqw)", fontWeight: 800, color: climax ? C.gold : "#FFFFFF", marginTop: 2 }}>{state.pot}</div>
            </div>
          </div>
          {state.pots.length > 1 && (
            <div style={{ ...TAB, marginTop: 6, fontSize: "min(11px, 2cqw)", color: C.text2 }}>
              {state.pots.map((p) => `${p.label} ${p.amount}`).join(" · ")}
            </div>
          )}
        </div>

        {/* seats */}
        {state.seats.map((s) => {
          const hero = heroPinned && s.seat === heroSeat;
          const xy = xyOf(s);
          return (
            <SeatPod key={s.seat} seat={s} seatX={xy.x} posStyle={seatPlacement(xy.x, xy.y, isWide, hero)} reveal={revealAll} isHero={hero} />
          );
        })}

        {/* bet chips on the bet line (never on the cards / pods) */}
        {state.seats
          .filter((s) => s.bet > 0 && !s.folded)
          .map((s) => {
            const hero = heroPinned && s.seat === heroSeat;
            // Hero chip sits just above the hero's big cards; others ride their line.
            const chipXy = hero ? { x: 50, y: isWide ? 62 : 60 } : xyOf(s);
            return (
              <Positioned key={`bet-${s.seat}`} xy={chipXy} factor={hero ? 0 : betFactor}>
                <BetChip amount={s.bet} />
              </Positioned>
            );
          })}
      </div>
    </div>
  );
}
