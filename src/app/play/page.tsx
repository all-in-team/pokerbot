"use client";

/**
 * /play — a playable 6-max table: a human (bottom seat) vs 5 heuristic bots that
 * EXPLOIT the human's observed leaks. 100% client-side, in-memory (no DB), works
 * on Vercel with no backend. Reuses the engine via playDriver, the /watch look
 * via PokerTableView, and reads the human via humanModel (engine-observed only).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { TopNav } from "@/components/TopNav.js";
import PokerTableView from "@/components/PokerTableView.js";
import { THEME as C } from "@/lib/theme.js";
import { pot as potOf, type GameState } from "@/engine/state.js";
import { handCategoryFr } from "@/engine/evaluator.js";
import { sizeToFromPotFraction } from "@/bots/util.js";
import type { ActionInput } from "@/engine/actions.js";
import {
  createPlayTable, dealHand, rebuy, botStep, botToAct, applyHumanRaw, heroLegal,
  liveFrame, carryStacks, seatName, lastActionLabel, type PlayTable,
} from "@/lib/client/playDriver.js";
import {
  emptyHumanStats, observeHand, readOf, FULL_CONFIDENCE_HANDS,
  type HumanStats, type HumanRead,
} from "@/lib/client/humanModel.js";
import { describeAdjustments } from "@/lib/client/exploitBot.js";

const HERO = 0;
const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const pct = (x: number) => `${Math.round(x * 100)}%`;

interface Stats { handsPlayed: number; handsWon: number; netChips: number; }

function btn(bg: string, fg = "#08130F"): React.CSSProperties {
  return { appearance: "none", border: "none", borderRadius: 11, background: bg, color: fg, fontWeight: 800, fontSize: 14, padding: "0 16px", height: 44, cursor: "pointer" };
}

export default function PlayPage() {
  const statsHumanRef = useRef<HumanStats>(emptyHumanStats());
  const tableRef = useRef<PlayTable>(createPlayTable({ heroSeat: HERO, seed: "play", getRead: () => readOf(statsHumanRef.current) }));
  const stacksRef = useRef<number[]>(Array.from({ length: tableRef.current.seats }, () => tableRef.current.startingStack));
  const buttonRef = useRef(0);
  const handIdRef = useRef(0);
  const finalizedRef = useRef(-1);
  const started = useRef(false);
  const busyRef = useRef(false);
  const speedRef = useRef(550);

  const table = tableRef.current;
  const [state, setState] = useState<GameState | null>(null);
  const [stats, setStats] = useState<Stats>({ handsPlayed: 0, handsWon: 0, netChips: 0 });
  const [read, setRead] = useState<HumanRead>(readOf(emptyHumanStats()));
  const [amount, setAmount] = useState(0);
  const [actionLabel, setActionLabel] = useState<string | null>(null);
  const [autoReveal, setAutoReveal] = useState(true);
  const [speed, setSpeed] = useState(550);
  const [nextLock, setNextLock] = useState(false);
  speedRef.current = speed;

  const completeHand = useCallback((s: GameState) => {
    // Update the human read from this hand (drives future-hand exploitation).
    statsHumanRef.current = observeHand(statsHumanRef.current, s, HERO);
    setRead(readOf(statsHumanRef.current));
    // Session stats (once per hand).
    if (finalizedRef.current !== s.handId) {
      finalizedRef.current = s.handId;
      const net = s.result?.net[HERO] ?? 0;
      setStats((p) => ({ handsPlayed: p.handsPlayed + 1, handsWon: p.handsWon + (net > 0 ? 1 : 0), netChips: p.netChips + net }));
    }
    // Reading delay so the reveal + result land before "Main suivante".
    setNextLock(true);
    setTimeout(() => setNextLock(false), 1200);
  }, []);

  // Step bots one at a time (animated), pausing `speed` ms between actions.
  const runBots = useCallback(async (start: GameState) => {
    let s = start;
    while (botToAct(s, HERO)) {
      await delay(speedRef.current);
      const next = await botStep(s, tableRef.current);
      if (!next) break;
      s = next;
      setState(s);
      setActionLabel(lastActionLabel(s, tableRef.current));
      if (s.street === "complete") break;
    }
    if (s.street === "complete") completeHand(s);
  }, [completeHand]);

  const deal = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setActionLabel(null);
    const s = dealHand(tableRef.current, rebuy(tableRef.current, stacksRef.current), buttonRef.current, handIdRef.current);
    setState(s);
    await runBots(s);
    busyRef.current = false;
  }, [runBots]);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void deal();
  }, [deal]);

  // Reset the bet slider when it becomes the hero's turn.
  useEffect(() => {
    if (!state) return;
    const legal = heroLegal(state, HERO);
    if (legal && (legal.canBet || legal.canRaise)) {
      setAmount(sizeToFromPotFraction(0.5, potOf(state), state.players[HERO]!.committedThisStreet, state.currentBet, legal));
    }
  }, [state]);

  const onAct = useCallback(
    async (input: ActionInput) => {
      if (!state || busyRef.current) return;
      busyRef.current = true;
      const s = applyHumanRaw(state, input);
      setState(s);
      setActionLabel(lastActionLabel(s, tableRef.current));
      if (s.street === "complete") {
        completeHand(s);
        busyRef.current = false;
        return;
      }
      await runBots(s);
      busyRef.current = false;
    },
    [state, runBots, completeHand],
  );

  const nextHand = useCallback(() => {
    if (!state || nextLock || busyRef.current) return;
    stacksRef.current = carryStacks(state);
    buttonRef.current = (buttonRef.current + 1) % tableRef.current.seats;
    handIdRef.current += 1;
    void deal();
  }, [state, nextLock, deal]);

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
  const adjustments = describeAdjustments(read);

  let category = "";
  if (complete && state.result?.showdown) {
    const w = state.result.winners[0];
    if (w != null) category = handCategoryFr([...state.players[w]!.holeCards, ...state.board]);
  }

  let status: string;
  if (complete && state.result) {
    const names = state.result.winners.map((wn) => seatName(table, wn)).join(" & ");
    status = `${names} remporte le pot${category ? ` · ${category}` : ""}`;
  } else if (legal) {
    status = "À toi de jouer";
  } else {
    status = actionLabel ?? "…";
  }

  const pot = potOf(state);
  // Pot-fraction "raise to", standard convention: the fraction applies to the pot
  // AFTER calling the bet in front (pot + toCall), added on top of the current bet.
  // Clamped to the legal min-raise and to the stack (all-in).
  const presetTo = (frac: number): number => {
    if (!legal) return 0;
    const raw = state.currentBet + Math.round(frac * (pot + legal.toCall));
    return Math.max(legal.minTo, Math.min(legal.maxTo, raw));
  };
  const PRESETS = legal
    ? [
        { label: "⅓", value: presetTo(1 / 3) },
        { label: "⅔", value: presetTo(2 / 3) },
        { label: "POT", value: presetTo(1) },
        { label: "2× POT", value: presetTo(2) },
        { label: "AI", value: legal.maxTo },
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

      <div style={{ maxWidth: 1040, margin: "0 auto", padding: "clamp(16px,4vw,28px)" }}>
        <Scoreboard handsPlayed={stats.handsPlayed} heroNet={stats.netChips} heroBb100={bb100} />

        <div style={{ display: "grid", gap: 18, gridTemplateColumns: "minmax(0,1fr) 260px", alignItems: "start", marginTop: 16 }}>
        <div>
          <PokerTableView state={frame} heroSeat={HERO} revealAll={complete && autoReveal} />

          {/* Transient action callout */}
          <div style={{ height: 22, marginTop: 8, textAlign: "center", fontSize: 13.5, color: C.text2, transition: "opacity .15s ease" }}>
            {!complete && actionLabel ? actionLabel : ""}
          </div>

          {/* Status + action bar */}
          <div style={{ marginTop: 4, padding: 14, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14 }}>
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
                <button style={{ ...btn(C.teal), opacity: nextLock ? 0.5 : 1, cursor: nextLock ? "default" : "pointer" }} onClick={nextHand} disabled={nextLock}>
                  {nextLock ? "Lecture…" : "Main suivante →"}
                </button>
              </div>
            ) : legal ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
                  {legal.canFold && <button style={btn("#E2533B", "#fff")} onClick={() => void onAct({ type: "fold" })}>Fold</button>}
                  {legal.canCheck ? (
                    <button style={btn("#21B07A")} onClick={() => void onAct({ type: "check" })}>Check</button>
                  ) : (
                    legal.canCall && <button style={btn("#21B07A")} onClick={() => void onAct({ type: "call" })}>{`Call ${legal.callAmount}`}</button>
                  )}
                  {(legal.canBet || legal.canRaise) && (
                    <button style={btn("#E0913B")} onClick={() => void onAct({ type: legal.aggressiveType, to: amount })}>
                      {legal.aggressiveType === "bet" ? `Bet → ${amount}` : `Raise → ${amount}`}
                    </button>
                  )}
                </div>
                {(legal.canBet || legal.canRaise) && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {/* Quick-size presets — pot-fraction (after calling), clamped to min-raise & stack. */}
                    <div style={{ display: "flex", gap: 6 }}>
                      {PRESETS.map((p) => {
                        // Grey a preset that collapses onto a neighbour it can't beat
                        // (e.g. its size is below the legal min-raise → no distinct spot).
                        const redundant = p.label !== "AI" && p.value <= legal.minTo && legal.minTo < legal.maxTo && presetTo(1 / 3) >= p.value && p.value !== presetTo(1 / 3);
                        const active = amount === p.value;
                        const accent = C.action.bet;
                        return (
                          <button
                            key={p.label}
                            disabled={redundant}
                            onClick={() => setAmount(p.value)}
                            style={{
                              flex: 1,
                              appearance: "none",
                              border: `1px solid ${active ? accent : C.border}`,
                              borderRadius: 10,
                              background: active ? "rgba(224,145,59,0.16)" : "transparent",
                              color: redundant ? C.text3 : active ? accent : C.text,
                              fontSize: 13,
                              fontWeight: 600,
                              minHeight: 44,
                              padding: "8px 4px",
                              cursor: redundant ? "not-allowed" : "pointer",
                              opacity: redundant ? 0.4 : 1,
                              fontVariantNumeric: "tabular-nums",
                            }}
                          >
                            <div>{p.label}</div>
                            <div style={{ fontSize: 11, fontWeight: 500, color: redundant ? C.text3 : C.text2 }}>{p.value}</div>
                          </button>
                        );
                      })}
                    </div>
                    {/* Custom amount — slider + live value. */}
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <input className="arena-range" type="range" min={legal.minTo} max={legal.maxTo} step={1} value={Math.min(Math.max(amount, legal.minTo), legal.maxTo)} onChange={(e) => setAmount(Number(e.target.value))} style={{ flex: 1 }} />
                      <span style={{ width: 56, textAlign: "right", fontVariantNumeric: "tabular-nums", color: C.text }}>{amount}</span>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div style={{ textAlign: "center", color: C.text3 }}>…</div>
            )}

            {/* Settings: auto-reveal + bot speed */}
            <div style={{ display: "flex", alignItems: "center", gap: 16, marginTop: 14, paddingTop: 12, borderTop: `1px solid ${C.border}`, flexWrap: "wrap" }}>
              <Toggle checked={autoReveal} onChange={setAutoReveal} label="Révéler en fin de main" />
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: C.text2, marginLeft: "auto" }}>
                Vitesse bots
                <input className="arena-range" type="range" min={150} max={1100} step={50} value={1250 - speed} onChange={(e) => setSpeed(1250 - Number(e.target.value))} />
              </label>
            </div>
          </div>
        </div>

        {/* Right column: session + the bots' attack plan (adversarial, no advice) */}
        <aside style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14, padding: 14 }}>
            <Eyebrow>Session</Eyebrow>
            <Row label="Mains jouées" value={`${stats.handsPlayed}`} />
            <Row label="Mains gagnées" value={`${stats.handsWon}`} />
          </div>

          <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14, padding: 14 }}>
            <Eyebrow>Plan d&apos;attaque des bots</Eyebrow>
            <div style={{ fontSize: 11.5, color: read.hands >= FULL_CONFIDENCE_HANDS ? C.teal : "#E0913B", marginBottom: 10 }}>
              {read.hands >= FULL_CONFIDENCE_HANDS
                ? `lecture fiable · ${read.hands} mains observées`
                : `lecture faible · ${read.hands} main${read.hands > 1 ? "s" : ""} observée${read.hands > 1 ? "s" : ""}`}
            </div>

            <div style={{ fontSize: 11, color: C.text3, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 4 }}>
              Ton profil (vu par les bots)
            </div>
            <Row label="VPIP" value={pct(read.vpip)} small />
            <Row label="PFR" value={pct(read.pfr)} small />
            <Row label="Fold→c-bet" value={pct(read.foldToCbet)} small />
            <Row label="Fold→3bet" value={pct(read.foldTo3bet)} small />
            <Row label="Agressivité (AF)" value={read.af.toFixed(1)} small />
            <Row label="WTSD" value={pct(read.wtsd)} small />

            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: 11, color: C.text3, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 4 }}>
                Détecté chez toi → comment ils t&apos;attaquent
              </div>
              {adjustments.length === 0 ? (
                <p style={{ fontSize: 11.5, color: C.text3, marginTop: 6, lineHeight: 1.5 }}>
                  Aucun angle exploitable détecté pour l&apos;instant — les bots jouent leur baseline.
                </p>
              ) : (
                <ul style={{ listStyle: "none", margin: "6px 0 0", padding: 0, display: "flex", flexDirection: "column", gap: 7 }}>
                  {adjustments.map((a, i) => (
                    <li key={i} style={{ fontSize: 11.5, lineHeight: 1.45 }}>
                      <span style={{ color: "#E0913B" }}>Détecté : {a.leak}</span>
                      <br />
                      <span style={{ color: C.teal }}>↳ {a.adjust}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </aside>
        </div>
      </div>
    </main>
  );
}

function Scoreboard({ handsPlayed, heroNet, heroBb100 }: { handsPlayed: number; heroNet: number; heroBb100: number }) {
  const botsNet = -heroNet;
  const botsBb100 = -heroBb100;
  const teal = "#2DD4A7";
  const red = "#E2533B";
  let verdict: string;
  let vColor: string;
  if (handsPlayed === 0) {
    verdict = "Première main — qui va craquer ?";
    vColor = "#9BA1AD";
  } else if (heroNet > 0) {
    verdict = `Tu domines les bots de ${heroBb100.toFixed(1)} bb/100`;
    vColor = teal;
  } else if (heroNet < 0) {
    verdict = `Les bots te battent de ${Math.abs(heroBb100).toFixed(1)} bb/100`;
    vColor = red;
  } else {
    verdict = "À égalité";
    vColor = "#9BA1AD";
  }

  const Side = ({ label, net, bb, accent }: { label: string; net: number; bb: number; accent: string }) => (
    <div style={{ textAlign: "center", minWidth: 120 }}>
      <div style={{ fontSize: 11, letterSpacing: 1, textTransform: "uppercase", color: "#6B7280", fontWeight: 700 }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 800, fontVariantNumeric: "tabular-nums", color: accent, marginTop: 2 }}>
        {net >= 0 ? "+" : ""}{net}
      </div>
      <div style={{ fontSize: 12, color: "#9BA1AD", fontVariantNumeric: "tabular-nums" }}>{bb >= 0 ? "+" : ""}{bb.toFixed(1)} bb/100</div>
    </div>
  );

  return (
    <div style={{ background: "#171B23", border: `1px solid ${vColor}55`, borderRadius: 16, padding: "14px 18px", display: "flex", alignItems: "center", justifyContent: "center", gap: 22, flexWrap: "wrap" }}>
      <Side label="Toi" net={heroNet} bb={heroBb100} accent={heroNet >= 0 ? teal : red} />
      <div style={{ color: "#6B7280", fontWeight: 800, fontSize: 14 }}>VS</div>
      <Side label="Les bots" net={botsNet} bb={botsBb100} accent={botsNet >= 0 ? teal : red} />
      <div style={{ flexBasis: "100%", height: 0 }} />
      <div style={{ fontSize: 13.5, fontWeight: 700, color: vColor }}>{verdict}</div>
    </div>
  );
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 11, letterSpacing: 0.8, textTransform: "uppercase", color: "#6B7280", marginBottom: 8, fontWeight: 700 }}>{children}</div>;
}

function Row({ label, value, color, small }: { label: string; value: string; color?: string; small?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: small ? "4px 0" : "6px 0", borderTop: "1px solid rgba(255,255,255,0.04)" }}>
      <span style={{ fontSize: small ? 12 : 12.5, color: "#9BA1AD" }}>{label}</span>
      <span style={{ fontSize: small ? 13 : 15, fontWeight: 700, fontVariantNumeric: "tabular-nums", color: color ?? "#E6E8EC" }}>{value}</span>
    </div>
  );
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "#9BA1AD", cursor: "pointer", userSelect: "none" }}>
      <span
        role="switch"
        aria-checked={checked}
        tabIndex={0}
        onClick={() => onChange(!checked)}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onChange(!checked))}
        style={{ width: 36, height: 20, borderRadius: 999, background: checked ? "#2DD4A7" : "rgba(255,255,255,0.14)", border: `1px solid ${checked ? "#2DD4A7" : "rgba(255,255,255,0.08)"}`, position: "relative", transition: "background .15s ease", flex: "0 0 auto" }}
      >
        <span style={{ position: "absolute", top: 2, left: checked ? 17 : 2, width: 14, height: 14, borderRadius: "50%", background: "#0E1117", transition: "left .15s ease" }} />
      </span>
      {label}
    </label>
  );
}
