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
  emptyHumanStats, observeHand, readOf, mergeHumanStats, FULL_CONFIDENCE_HANDS,
  type HumanStats, type HumanRead,
} from "@/lib/client/humanModel.js";
import { describeAdjustments } from "@/lib/client/exploitBot.js";
import {
  defaultProfileStore, createProfile, accumulateHand, lifetimeBb100,
  type PlayerProfile,
} from "@/lib/client/profileStore.js";

const HERO = 0;
const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const pct = (x: number) => `${Math.round(x * 100)}%`;

interface Stats { handsPlayed: number; handsWon: number; netChips: number; }

function btn(bg: string, fg = "#08130F"): React.CSSProperties {
  return { appearance: "none", border: "none", borderRadius: 11, background: bg, color: fg, fontWeight: 800, fontSize: 14, padding: "0 16px", height: 44, cursor: "pointer" };
}

export default function PlayPage() {
  const store = useRef(defaultProfileStore()).current;
  const profileBaseRef = useRef<HumanStats>(emptyHumanStats()); // lifetime model at session start
  const sessionStatsRef = useRef<HumanStats>(emptyHumanStats()); // this session's delta
  const profileRef = useRef<PlayerProfile | null>(null);
  // No seed → a fresh random shuffle every session (different boards each time).
  const tableRef = useRef<PlayTable>(createPlayTable({ heroSeat: HERO, getRead: () => readOf(mergeHumanStats(profileBaseRef.current, sessionStatsRef.current)) }));
  const stacksRef = useRef<number[]>(Array.from({ length: tableRef.current.seats }, () => tableRef.current.startingStack));
  const buttonRef = useRef(0);
  const handIdRef = useRef(0);
  const finalizedRef = useRef(-1);
  const busyRef = useRef(false);
  const speedRef = useRef(550);

  const table = tableRef.current;
  const [state, setState] = useState<GameState | null>(null);
  const [profile, setProfile] = useState<PlayerProfile | null>(null);
  const [profiles, setProfiles] = useState<PlayerProfile[]>([]);
  const [profilesLoading, setProfilesLoading] = useState(true);
  const [showPicker, setShowPicker] = useState(true);
  const [stats, setStats] = useState<Stats>({ handsPlayed: 0, handsWon: 0, netChips: 0 });
  const [read, setRead] = useState<HumanRead>(readOf(emptyHumanStats()));
  const [amount, setAmount] = useState(0);
  const [actionLabel, setActionLabel] = useState<string | null>(null);
  const [autoReveal, setAutoReveal] = useState(true);
  const [speed, setSpeed] = useState(550);
  const [nextLock, setNextLock] = useState(false);
  speedRef.current = speed;

  const completeHand = useCallback((s: GameState) => {
    // Accumulate exactly once per hand (the human model + session + profile).
    if (finalizedRef.current !== s.handId) {
      finalizedRef.current = s.handId;
      // Fold this hand into the session delta; the bots' read = lifetime base + session.
      sessionStatsRef.current = observeHand(sessionStatsRef.current, s, HERO);
      const merged = mergeHumanStats(profileBaseRef.current, sessionStatsRef.current);
      setRead(readOf(merged));

      const net = s.result?.net[HERO] ?? 0;
      setStats((p) => ({ handsPlayed: p.handsPlayed + 1, handsWon: p.handsWon + (net > 0 ? 1 : 0), netChips: p.netChips + net }));

      // Persist into the active profile: lifetime tally + the remembered read model.
      const cur = profileRef.current;
      if (cur) {
        const updated: PlayerProfile = {
          ...cur,
          stats: merged,
          lifetime: accumulateHand(cur.lifetime, { net, bigBlind: tableRef.current.bigBlind }),
          updatedAt: Date.now(),
        };
        profileRef.current = updated;
        // Persist in the background — never block the table on a network write.
        void store.saveProfile(updated).catch((e) => console.warn("[profiles] save failed:", e));
        setProfile(updated);
      }
    }
    // Reading delay so the reveal + result land before "Main suivante".
    setNextLock(true);
    setTimeout(() => setNextLock(false), 1200);
  }, [store]);

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

  // Switch to a profile: load its lifetime model as the session base, reset the
  // session, and start dealing. Called from the picker (create or choose).
  const selectProfile = useCallback((p: PlayerProfile) => {
    store.setActiveId(p.id);
    profileRef.current = p;
    profileBaseRef.current = p.stats; // bots "remember" this player from here
    sessionStatsRef.current = emptyHumanStats();
    stacksRef.current = Array.from({ length: tableRef.current.seats }, () => tableRef.current.startingStack);
    buttonRef.current = 0;
    handIdRef.current = 0;
    finalizedRef.current = -1;
    busyRef.current = false;
    setProfile(p);
    setStats({ handsPlayed: 0, handsWon: 0, netChips: 0 });
    setRead(readOf(p.stats));
    setShowPicker(false);
    setState(null);
    void deal();
  }, [deal, store]);

  // Reload the saved-profiles list (async: backend may be the network).
  const refreshProfiles = useCallback(async () => {
    setProfilesLoading(true);
    try {
      setProfiles(await store.listProfiles());
    } catch (e) {
      console.warn("[profiles] list failed:", e);
    } finally {
      setProfilesLoading(false);
    }
  }, [store]);

  const createAndSelect = useCallback((name: string) => {
    const p = createProfile(name);
    selectProfile(p); // start playing immediately (optimistic)
    void store.saveProfile(p).then(refreshProfiles).catch((e) => console.warn("[profiles] save failed:", e));
  }, [selectProfile, store, refreshProfiles]);

  const removeProfile = useCallback((id: string) => {
    if (profileRef.current?.id === id) {
      profileRef.current = null;
      setProfile(null);
      setShowPicker(true);
    }
    void store.deleteProfile(id).then(refreshProfiles).catch((e) => console.warn("[profiles] delete failed:", e));
  }, [store, refreshProfiles]);

  // Load the device's saved profiles on mount (no auto-deal: the player chooses first).
  useEffect(() => {
    let alive = true;
    setProfilesLoading(true);
    store
      .listProfiles()
      .then((list) => { if (alive) setProfiles(list); })
      .catch((e) => console.warn("[profiles] list failed:", e))
      .finally(() => { if (alive) setProfilesLoading(false); });
    return () => { alive = false; };
  }, [store]);

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

  // No profile yet → entry screen (create or choose).
  if (!profile) {
    return (
      <main style={{ minHeight: "100dvh", background: C.appBg, color: C.text }}>
        <TopNav />
        <ProfilePicker
          profiles={profiles}
          loading={profilesLoading}
          activeId={null}
          onSelect={selectProfile}
          onCreate={createAndSelect}
          onDelete={removeProfile}
          dismissable={false}
        />
      </main>
    );
  }

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
  const lifeHands = profile.lifetime.handsPlayed;
  const lifeBb100 = lifetimeBb100(profile.lifetime);
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
  const aggressive = !!legal && (legal.canBet || legal.canRaise);
  const customAmount = legal ? Math.min(Math.max(amount, legal.minTo), legal.maxTo) : amount;
  // One-click raise sizes: pot-fraction (applied AFTER calling), each clamped to a
  // LEGAL "to". Drop any that collapse to all-in or duplicate another (so we never
  // show an illegal or redundant amount); All-in is always offered last.
  const RAISE_PRESETS: { label: string; value: number }[] = [];
  if (legal && aggressive) {
    const seen = new Set<number>();
    for (const [label, frac] of [["⅓", 1 / 3], ["⅔", 2 / 3], ["POT", 1], ["2× POT", 2]] as [string, number][]) {
      const v = presetTo(frac);
      if (v >= legal.maxTo || seen.has(v)) continue;
      seen.add(v);
      RAISE_PRESETS.push({ label, value: v });
    }
    RAISE_PRESETS.push({ label: "All-in", value: legal.maxTo });
  }

  return (
    <main style={{ minHeight: "100dvh", background: C.appBg, color: C.text }}>
      <TopNav
        right={
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button
              onClick={() => { void refreshProfiles(); setShowPicker(true); }}
              style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, fontWeight: 700, color: C.text, cursor: "pointer", padding: "6px 12px", borderRadius: 999, background: C.surface, border: `1px solid ${C.teal}55` }}
              title="Changer de profil"
            >
              <span aria-hidden>👤</span>{profile.name}<span style={{ color: C.text3 }}>▾</span>
            </button>
            <span style={{ fontSize: 12.5, color: C.text2, fontVariantNumeric: "tabular-nums", padding: "6px 12px", borderRadius: 999, background: C.surface, border: `1px solid ${C.border}` }}>
              {`$${table.smallBlind}/$${table.bigBlind} · ante $${table.ante} · main #${stats.handsPlayed + (complete ? 0 : 1)}`}
            </span>
          </div>
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
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {/* Primary one-click actions */}
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
                  {legal.canFold && <button className="play-action-btn" style={btn("#E2533B", "#fff")} onClick={() => void onAct({ type: "fold" })}>Fold</button>}
                  {legal.canCheck ? (
                    <button className="play-action-btn" style={btn("#21B07A")} onClick={() => void onAct({ type: "check" })}>Check</button>
                  ) : (
                    legal.canCall && <button className="play-action-btn" style={btn("#21B07A")} onClick={() => void onAct({ type: "call" })}>{`Call ${legal.callAmount}`}</button>
                  )}
                </div>

                {aggressive && (
                  <>
                    {/* One-click bet sizes — a single tap fires the raise at this legal amount */}
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      {RAISE_PRESETS.map((p) => (
                        <button
                          key={p.label}
                          className="play-action-btn"
                          onClick={() => void onAct({ type: legal.aggressiveType, to: p.value })}
                          style={{ ...btn(C.action.bet), flex: "1 1 0", minWidth: 88, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "0 10px" }}
                        >
                          <span>{p.label}</span>
                          <span style={{ fontVariantNumeric: "tabular-nums", opacity: 0.82, fontWeight: 700 }}>{p.value}</span>
                        </button>
                      ))}
                    </div>

                    {/* Custom amount — slider with its own confirm button */}
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <input className="arena-range" type="range" min={legal.minTo} max={legal.maxTo} step={1} value={customAmount} onChange={(e) => setAmount(Number(e.target.value))} style={{ flex: 1 }} />
                      <button
                        className="play-action-btn"
                        onClick={() => void onAct({ type: legal.aggressiveType, to: customAmount })}
                        style={{ ...btn("transparent", C.text), border: `1px solid ${C.action.bet}`, minWidth: 124 }}
                      >
                        {legal.aggressiveType === "bet" ? `Bet → ${customAmount}` : `Raise → ${customAmount}`}
                      </button>
                    </div>
                  </>
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
            <Row label="Net" value={`${stats.netChips >= 0 ? "+" : ""}${stats.netChips}`} color={stats.netChips >= 0 ? C.teal : "#E2533B"} />
            <Row label="bb/100" value={`${bb100 >= 0 ? "+" : ""}${bb100.toFixed(1)}`} />
          </div>

          <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14, padding: 14 }}>
            <Eyebrow>À vie · {profile.name}</Eyebrow>
            {lifeHands > 0 ? (
              <>
                <Row label="Mains (total)" value={`${lifeHands}`} />
                <Row label="Winrate" value={pct(profile.lifetime.handsWon / lifeHands)} />
                <Row label="Net cumulé" value={`${profile.lifetime.netChips >= 0 ? "+" : ""}${profile.lifetime.netChips}`} color={profile.lifetime.netChips >= 0 ? C.teal : "#E2533B"} />
                <Row label="bb/100 (à vie)" value={`${lifeBb100 >= 0 ? "+" : ""}${lifeBb100.toFixed(1)}`} color={lifeBb100 >= 0 ? C.teal : "#E2533B"} />
              </>
            ) : (
              <p style={{ fontSize: 11.5, color: C.text3, margin: "6px 0 0", lineHeight: 1.5 }}>
                Pas encore de main enregistrée pour ce profil — joue pour construire ton winrate à vie.
              </p>
            )}
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

      {/* Switch / create profile at any time. */}
      {showPicker && (
        <ProfilePicker
          profiles={profiles}
          loading={profilesLoading}
          activeId={profile.id}
          onSelect={selectProfile}
          onCreate={createAndSelect}
          onDelete={removeProfile}
          dismissable
          onClose={() => setShowPicker(false)}
        />
      )}
    </main>
  );
}

function ProfilePicker({
  profiles, loading, activeId, onSelect, onCreate, onDelete, dismissable, onClose,
}: {
  profiles: PlayerProfile[];
  loading: boolean;
  activeId: string | null;
  onSelect: (p: PlayerProfile) => void;
  onCreate: (name: string) => void;
  onDelete: (id: string) => void;
  dismissable: boolean;
  onClose?: () => void;
}) {
  const [name, setName] = useState("");
  const submit = () => {
    const n = name.trim();
    if (n) { onCreate(n); setName(""); }
  };
  return (
    <div
      onClick={() => dismissable && onClose?.()}
      style={{ position: "fixed", inset: 0, zIndex: 50, background: "rgba(8,11,16,0.72)", display: "flex", alignItems: "center", justifyContent: "center", padding: 18, backdropFilter: "blur(2px)" }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ width: "100%", maxWidth: 460, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 18, padding: 22, boxShadow: "0 20px 60px rgba(0,0,0,0.5)" }}
      >
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 4 }}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: C.text }}>Profils joueur</h2>
          {dismissable && (
            <button onClick={() => onClose?.()} style={{ background: "none", border: "none", color: C.text3, fontSize: 20, cursor: "pointer", lineHeight: 1 }} aria-label="Fermer">×</button>
          )}
        </div>
        <p style={{ margin: "0 0 16px", fontSize: 12.5, color: C.text2, lineHeight: 1.5 }}>
          Tes stats à vie et la lecture des bots sont sauvegardées (cet appareil ou le cloud). Reprends un profil ou crée-en un nouveau.
        </p>

        {loading && (
          <div style={{ padding: "14px 0", textAlign: "center", fontSize: 13, color: C.text3 }}>Chargement des profils…</div>
        )}

        {!loading && profiles.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16, maxHeight: 280, overflowY: "auto" }}>
            {profiles.map((p) => {
              const life = lifetimeBb100(p.lifetime);
              const active = p.id === activeId;
              return (
                <div
                  key={p.id}
                  style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: 12, background: C.appBg, border: `1px solid ${active ? `${C.teal}77` : C.border}` }}
                >
                  <button
                    onClick={() => onSelect(p)}
                    style={{ flex: 1, textAlign: "left", background: "none", border: "none", cursor: "pointer", padding: 0 }}
                  >
                    <div style={{ fontSize: 14, fontWeight: 700, color: C.text }}>
                      {p.name}{active && <span style={{ color: C.teal, fontWeight: 600, fontSize: 11, marginLeft: 8 }}>actif</span>}
                    </div>
                    <div style={{ fontSize: 11.5, color: C.text3, fontVariantNumeric: "tabular-nums", marginTop: 2 }}>
                      {p.lifetime.handsPlayed} mains · net {p.lifetime.netChips >= 0 ? "+" : ""}{p.lifetime.netChips} · {life >= 0 ? "+" : ""}{life.toFixed(1)} bb/100
                    </div>
                  </button>
                  <button
                    onClick={() => onDelete(p.id)}
                    style={{ background: "none", border: `1px solid ${C.border}`, color: C.text3, borderRadius: 8, width: 30, height: 30, cursor: "pointer", fontSize: 15, flex: "0 0 auto" }}
                    aria-label={`Supprimer ${p.name}`}
                    title="Supprimer ce profil"
                  >×</button>
                </div>
              );
            })}
          </div>
        )}

        <div style={{ fontSize: 11, color: C.text3, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 8 }}>
          {profiles.length > 0 ? "Ou crée un nouveau profil" : "Crée ton premier profil"}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
            placeholder="Ton pseudo"
            maxLength={24}
            autoFocus
            style={{ flex: 1, background: C.appBg, border: `1px solid ${C.border}`, borderRadius: 11, color: C.text, fontSize: 14, padding: "0 14px", height: 44, outline: "none" }}
          />
          <button
            onClick={submit}
            disabled={!name.trim()}
            style={{ ...btn(C.teal), opacity: name.trim() ? 1 : 0.5, cursor: name.trim() ? "pointer" : "default" }}
          >
            Créer
          </button>
        </div>
      </div>
    </div>
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
