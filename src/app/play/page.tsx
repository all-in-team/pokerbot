"use client";

/**
 * /play — a playable 6-max table: a human (bottom seat) vs 5 heuristic bots.
 * 100% client-side, in-memory (works on Vercel with no backend). Reuses the
 * engine via playDriver and the /watch table look via PokerTableView.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { TopNav } from "@/components/TopNav.js";
import PokerTableView from "@/components/PokerTableView.js";
import { THEME as C } from "@/lib/theme.js";
import { pot as potOf, type GameState } from "@/engine/state.js";
import { sizeToFromPotFraction } from "@/bots/util.js";
import type { ActionInput } from "@/engine/actions.js";
import {
  createPlayTable,
  startHand,
  applyHuman,
  heroLegal,
  liveFrame,
  carryStacks,
  seatName,
} from "@/lib/client/playDriver.js";

const HERO = 0;

interface Stats {
  handsPlayed: number;
  handsWon: number;
  netChips: number;
}

function btn(bg: string, fg = "#08130F"): React.CSSProperties {
  return {
    appearance: "none",
    border: "none",
    borderRadius: 11,
    background: bg,
    color: fg,
    fontWeight: 800,
    fontSize: 14,
    padding: "0 16px",
    height: 44,
    cursor: "pointer",
  };
}

export default function PlayPage() {
  const tableRef = useRef(createPlayTable({ heroSeat: HERO, seed: "play" }));
  const stacksRef = useRef<number[]>(Array.from({ length: tableRef.current.seats }, () => tableRef.current.startingStack));
  const buttonRef = useRef(0);
  const handIdRef = useRef(0);
  const finalizedRef = useRef(-1);
  const started = useRef(false);
  const busyRef = useRef(false);

  const table = tableRef.current;
  const [state, setState] = useState<GameState | null>(null);
  const [stats, setStats] = useState<Stats>({ handsPlayed: 0, handsWon: 0, netChips: 0 });
  const [amount, setAmount] = useState(0);

  // Record a finished hand into session stats exactly once.
  const finalize = useCallback((s: GameState) => {
    if (s.street !== "complete" || s.result === null) return;
    if (finalizedRef.current === s.handId) return;
    finalizedRef.current = s.handId;
    const net = s.result.net[HERO] ?? 0;
    setStats((prev) => ({
      handsPlayed: prev.handsPlayed + 1,
      handsWon: prev.handsWon + (net > 0 ? 1 : 0),
      netChips: prev.netChips + net,
    }));
  }, []);

  const deal = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    const s = await startHand(table, stacksRef.current, buttonRef.current, handIdRef.current);
    setState(s);
    if (s.street === "complete") finalize(s);
    busyRef.current = false;
  }, [table, finalize]);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void deal();
  }, [deal]);

  // Reset the bet slider whenever it becomes the hero's turn.
  useEffect(() => {
    if (!state) return;
    const legal = heroLegal(state, HERO);
    if (legal && (legal.canBet || legal.canRaise)) {
      const target = sizeToFromPotFraction(0.5, potOf(state), state.players[HERO]!.committedThisStreet, state.currentBet, legal);
      setAmount(target);
    }
  }, [state]);

  const act = useCallback(
    async (input: ActionInput) => {
      if (!state || busyRef.current) return;
      busyRef.current = true;
      const s = await applyHuman(state, input, table);
      setState(s);
      if (s.street === "complete") finalize(s);
      busyRef.current = false;
    },
    [state, table, finalize],
  );

  const nextHand = useCallback(() => {
    if (!state) return;
    stacksRef.current = carryStacks(state);
    buttonRef.current = (buttonRef.current + 1) % table.seats;
    handIdRef.current += 1;
    void deal();
  }, [state, table, deal]);

  if (!state) {
    return (
      <main style={{ minHeight: "100dvh", background: C.appBg, color: C.text }}>
        <TopNav />
        <div style={{ padding: 60, textAlign: "center", color: C.text3 }}>Distribution…</div>
      </main>
    );
  }

  const legal = heroLegal(state, HERO);
  const complete = state.street === "complete";
  const frame = liveFrame(state, HERO);
  const heroNet = complete && state.result ? state.result.net[HERO] ?? 0 : 0;
  const bb100 = stats.handsPlayed > 0 ? (stats.netChips / table.bigBlind / stats.handsPlayed) * 100 : 0;

  // Status line.
  let status = "";
  if (complete && state.result) {
    const names = state.result.winners.map((w) => seatName(table, w)).join(" & ");
    status = `${names} remporte le pot`;
  } else if (legal) {
    status = "À toi de jouer";
  } else {
    status = "…";
  }

  const callLabel = legal && legal.canCall ? `Call ${legal.callAmount}` : "Call";
  const pot = potOf(state);
  const heroCommitted = state.players[HERO]!.committedThisStreet;

  const SHORTCUTS: { label: string; to: () => number }[] = legal
    ? [
        { label: "½ pot", to: () => sizeToFromPotFraction(0.5, pot, heroCommitted, state.currentBet, legal) },
        { label: "pot", to: () => sizeToFromPotFraction(1, pot, heroCommitted, state.currentBet, legal) },
        { label: "all-in", to: () => legal.maxTo },
      ]
    : [];

  return (
    <main style={{ minHeight: "100dvh", background: C.appBg, color: C.text }}>
      <TopNav
        right={
          <span style={{ fontSize: 12.5, color: C.text2, fontVariantNumeric: "tabular-nums", padding: "6px 12px", borderRadius: 999, background: C.surface, border: `1px solid ${C.border}` }}>
            {`$${table.smallBlind}/$${table.bigBlind} · ante $${table.ante} · main #${stats.handsPlayed + (complete ? 0 : 1)}`}
          </span>
        }
      />

      <div style={{ maxWidth: 1000, margin: "0 auto", padding: "clamp(16px,4vw,28px)", display: "grid", gap: 18, gridTemplateColumns: "minmax(0,1fr) 240px", alignItems: "start" }}>
        <div>
          <PokerTableView state={frame} heroSeat={HERO} />

          {/* Status + action bar */}
          <div style={{ marginTop: 14, padding: 14, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14 }}>
            <div style={{ textAlign: "center", marginBottom: 12, fontWeight: 700, color: complete ? C.teal : C.text }}>
              {status}
              {complete && (
                <span style={{ marginLeft: 10, color: heroNet > 0 ? C.teal : heroNet < 0 ? "#E2533B" : C.text2, fontVariantNumeric: "tabular-nums" }}>
                  {heroNet >= 0 ? "+" : ""}{heroNet}
                </span>
              )}
            </div>

            {complete ? (
              <div style={{ display: "flex", justifyContent: "center" }}>
                <button style={btn(C.teal)} onClick={nextHand}>Main suivante →</button>
              </div>
            ) : legal ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
                  {legal.canFold && (
                    <button style={btn("#E2533B", "#fff")} onClick={() => void act({ type: "fold" })}>Fold</button>
                  )}
                  {legal.canCheck ? (
                    <button style={btn("#21B07A")} onClick={() => void act({ type: "check" })}>Check</button>
                  ) : (
                    legal.canCall && <button style={btn("#21B07A")} onClick={() => void act({ type: "call" })}>{callLabel}</button>
                  )}
                  {(legal.canBet || legal.canRaise) && (
                    <button style={btn("#E0913B")} onClick={() => void act({ type: legal.aggressiveType, to: amount })}>
                      {legal.aggressiveType === "bet" ? `Bet ${amount}` : `Raise to ${amount}`}
                    </button>
                  )}
                </div>

                {(legal.canBet || legal.canRaise) && (
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <input
                      className="arena-range"
                      type="range"
                      min={legal.minTo}
                      max={legal.maxTo}
                      step={1}
                      value={Math.min(Math.max(amount, legal.minTo), legal.maxTo)}
                      onChange={(e) => setAmount(Number(e.target.value))}
                      style={{ flex: 1 }}
                    />
                    <span style={{ width: 56, textAlign: "right", fontVariantNumeric: "tabular-nums", color: C.text }}>{amount}</span>
                    <div style={{ display: "flex", gap: 6 }}>
                      {SHORTCUTS.map((sc) => (
                        <button
                          key={sc.label}
                          onClick={() => setAmount(sc.to())}
                          style={{ appearance: "none", border: `1px solid ${C.border}`, borderRadius: 8, background: "transparent", color: C.text2, fontSize: 12, padding: "6px 8px", cursor: "pointer" }}
                        >
                          {sc.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div style={{ textAlign: "center", color: C.text3 }}>…</div>
            )}
          </div>
        </div>

        {/* Session stats */}
        <aside style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14, padding: 14 }}>
          <div style={{ fontSize: 11, letterSpacing: 0.8, textTransform: "uppercase", color: C.text3, marginBottom: 10, fontWeight: 700 }}>
            Stats de session
          </div>
          <Stat label="Mains jouées" value={`${stats.handsPlayed}`} />
          <Stat label="Mains gagnées" value={`${stats.handsWon}`} />
          <Stat label="Net (jetons)" value={`${stats.netChips >= 0 ? "+" : ""}${stats.netChips}`} color={stats.netChips > 0 ? C.teal : stats.netChips < 0 ? "#E2533B" : C.text} />
          <Stat label="bb/100" value={`${bb100 >= 0 ? "+" : ""}${bb100.toFixed(1)}`} color={bb100 > 0 ? C.teal : bb100 < 0 ? "#E2533B" : C.text} />
          <p style={{ fontSize: 11.5, color: C.text3, marginTop: 12, lineHeight: 1.5 }}>
            Tu es en bas. 5 bots EV-seeking. Tapis recavé à {table.startingStack} si à court. Tout en mémoire — rien n&apos;est enregistré.
          </p>
        </aside>
      </div>
    </main>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "6px 0", borderTop: "1px solid rgba(255,255,255,0.04)" }}>
      <span style={{ fontSize: 12.5, color: "#9BA1AD" }}>{label}</span>
      <span style={{ fontSize: 15, fontWeight: 700, fontVariantNumeric: "tabular-nums", color: color ?? "#E6E8EC" }}>{value}</span>
    </div>
  );
}
