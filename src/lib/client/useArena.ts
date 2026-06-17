"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArenaDirector, type ArenaView } from "./director.js";
import { buildBots, botMeta, type BotMeta, type MatchSetup } from "./bots.js";
import { buildReasoningBots, type DirectorCtx } from "./reasoningBots.js";
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
}

const STACK = 200;

function createDirector(setup: MatchSetup, mode: ArenaMode): ArenaDirector {
  const ctx: DirectorCtx = { director: null };
  const bots = mode === "reasoning" ? buildReasoningBots(setup, ctx) : buildBots(setup);
  const director = new ArenaDirector(
    { seed: setup.seed, smallBlind: 1, bigBlind: 2, startingStack: STACK },
    bots,
  );
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
  const directorRef = useRef<ArenaDirector | null>(null);
  const meta = useMemo(() => botMeta(setup), [setup]);

  if (directorRef.current === null) {
    directorRef.current = createDirector(setup, initialMode);
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
      directorRef.current = createDirector(next, m);
      setSetup(next);
      setMode(m);
      setView(directorRef.current.getView());
    },
    [mode],
  );

  const getHistory = useCallback(() => directorRef.current?.getHistory() ?? [], []);

  return { view, meta, mode, playing, speed, play, pause, toggle, stepOnce, setSpeed, newMatch, getHistory };
}
