"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArenaDirector, type ArenaView } from "./director.js";
import { buildBots, botMeta, type BotMeta, type MatchSetup } from "./bots.js";
import { buildReasoningBots, type DirectorCtx } from "./reasoningBots.js";
import { defaultPlaybook, type Playbook, type PlaybookDiff, type TunablePath } from "@/learning/playbook.js";
import type { Seat } from "@/engine/state.js";
import type { HandLog } from "@/sim/match.js";

export type ArenaMode = "heuristic" | "reasoning";

export interface ArenaControls {
  view: ArenaView;
  meta: [BotMeta, BotMeta];
  mode: ArenaMode;
  playing: boolean;
  /** 0..100 slider value (higher = faster). */
  speed: number;
  play: () => void;
  pause: () => void;
  toggle: () => void;
  stepOnce: () => void;
  setSpeed: (v: number) => void;
  newMatch: (setup: MatchSetup, mode?: ArenaMode) => void;
  /** Full logs of completed hands this session (for replay scrubbing). */
  getHistory: () => HandLog[];

  // --- Coaching: client-held, session-scoped playbooks (Vercel-stateless) ---
  /** Current playbook per seat (mirrors what the reasoning bots read live). */
  playbooks: [Playbook, Playbook];
  /** Append a coach lesson — takes effect on the bot's NEXT decision. */
  addNote: (seat: Seat, note: string) => void;
  /** Tune a numeric playbook field (frequencies clamped to 0..1). */
  setTunable: (seat: Seat, path: TunablePath, value: number) => void;
  /** Run the coach over this session's hands; returns the applied diff (or null). */
  reflect: (seat: Seat) => Promise<PlaybookDiff | null>;
}

const STACK = 200;

function initPlaybooks(setup: MatchSetup): [Playbook, Playbook] {
  return [defaultPlaybook(setup.seats[0].personality), defaultPlaybook(setup.seats[1].personality)];
}

function createDirector(setup: MatchSetup, mode: ArenaMode, getPlaybook: (seat: Seat) => Playbook): ArenaDirector {
  const ctx: DirectorCtx = { director: null };
  const bots = mode === "reasoning" ? buildReasoningBots(setup, ctx, getPlaybook) : buildBots(setup);
  const director = new ArenaDirector({ seed: setup.seed, smallBlind: 1, bigBlind: 2, startingStack: STACK }, bots);
  ctx.director = director;
  return director;
}

/** Map the 0..100 speed slider to a per-step delay in ms (higher = faster). */
function delayForSpeed(speed: number): number {
  const t = Math.max(0, Math.min(100, speed)) / 100;
  return Math.round(1500 - t * 1380); // 1500ms (slow) … 120ms (fast)
}

export function useArena(initial: MatchSetup, initialMode: ArenaMode = "heuristic"): ArenaControls {
  const [setup, setSetup] = useState<MatchSetup>(initial);
  const [mode, setMode] = useState<ArenaMode>(initialMode);
  const meta = useMemo(() => botMeta(setup), [setup]);

  // Client-held playbooks: a ref the bots read live + a state mirror for the UI.
  const playbooksRef = useRef<[Playbook, Playbook]>(initPlaybooks(initial));
  const [playbooks, setPlaybooks] = useState<[Playbook, Playbook]>(playbooksRef.current);
  const getPlaybook = useCallback((seat: Seat) => playbooksRef.current[seat]!, []);
  const commitPlaybooks = useCallback((next: [Playbook, Playbook]) => {
    playbooksRef.current = next;
    setPlaybooks(next);
  }, []);

  const directorRef = useRef<ArenaDirector | null>(null);
  if (directorRef.current === null) {
    directorRef.current = createDirector(setup, initialMode, getPlaybook);
  }

  const [view, setView] = useState<ArenaView>(() => directorRef.current!.getView());
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(55);

  const playingRef = useRef(playing);
  const speedRef = useRef(speed);
  const busyRef = useRef(false);
  playingRef.current = playing;
  speedRef.current = speed;

  const doStep = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    const d = directorRef.current!;
    await d.step();
    setView(d.getView());
    busyRef.current = false;
  }, []);

  // Autoplay loop. Holds a beat longer on showdowns so results land.
  useEffect(() => {
    if (!playing) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    const tick = async () => {
      if (cancelled || !playingRef.current) return;
      const before = directorRef.current!.getView();
      await doStep();
      if (cancelled) return;
      const showdownHold = before.isComplete ? 0 : directorRef.current!.getView().isComplete ? 950 : 0;
      timer = setTimeout(tick, delayForSpeed(speedRef.current) + showdownHold);
    };
    timer = setTimeout(tick, delayForSpeed(speedRef.current));
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [playing, doStep]);

  const play = useCallback(() => setPlaying(true), []);
  const pause = useCallback(() => setPlaying(false), []);
  const toggle = useCallback(() => setPlaying((p) => !p), []);
  const stepOnce = useCallback(() => {
    setPlaying(false);
    void doStep();
  }, [doStep]);

  const newMatch = useCallback(
    (next: MatchSetup, nextMode?: ArenaMode) => {
      setPlaying(false);
      const m = nextMode ?? mode;
      // Fresh session ⇒ fresh playbooks (session-scoped coaching).
      const pbs = initPlaybooks(next);
      playbooksRef.current = pbs;
      setPlaybooks(pbs);
      directorRef.current = createDirector(next, m, getPlaybook);
      setSetup(next);
      setMode(m);
      setView(directorRef.current.getView());
    },
    [mode, getPlaybook],
  );

  const getHistory = useCallback(() => directorRef.current?.getHistory() ?? [], []);

  // --- Coaching actions ---
  const addNote = useCallback(
    (seat: Seat, note: string) => {
      const text = note.trim();
      if (!text) return;
      const cur = playbooksRef.current;
      const updated: Playbook = { ...cur[seat]!, notes: [...cur[seat]!.notes, text] };
      const next: [Playbook, Playbook] = seat === 0 ? [updated, cur[1]!] : [cur[0]!, updated];
      commitPlaybooks(next);
    },
    [commitPlaybooks],
  );

  const setTunable = useCallback(
    (seat: Seat, path: TunablePath, value: number) => {
      const cur = playbooksRef.current;
      const updated = structuredClone(cur[seat]!);
      const [group, field] = path.split(".") as [keyof Playbook, string];
      const isFreq = !path.includes("Size") && !path.includes("X");
      (updated[group] as Record<string, number>)[field] = isFreq ? Math.max(0, Math.min(1, value)) : Math.max(0.5, value);
      const next: [Playbook, Playbook] = seat === 0 ? [updated, cur[1]!] : [cur[0]!, updated];
      commitPlaybooks(next);
    },
    [commitPlaybooks],
  );

  const reflect = useCallback(
    async (seat: Seat): Promise<PlaybookDiff | null> => {
      const hands = directorRef.current?.getHistory() ?? [];
      if (hands.length === 0) return null;
      const res = await fetch("/api/reflect", {
        method: "POST",
        headers: { "content-type": "application/json" },
        // Cap payload: the last slice of the session is plenty for reflection.
        body: JSON.stringify({ playbook: playbooksRef.current[seat]!, seat, hands: hands.slice(-80) }),
      });
      const data = (await res.json()) as { playbook?: Playbook; diff?: PlaybookDiff; error?: string };
      if (!data.playbook || !data.diff) throw new Error(data.error ?? "reflect failed");
      const cur = playbooksRef.current;
      const next: [Playbook, Playbook] = seat === 0 ? [data.playbook, cur[1]!] : [cur[0]!, data.playbook];
      commitPlaybooks(next);
      return data.diff;
    },
    [commitPlaybooks],
  );

  return {
    view, meta, mode, playing, speed,
    play, pause, toggle, stepOnce, setSpeed, newMatch, getHistory,
    playbooks, addNote, setTunable, reflect,
  };
}
