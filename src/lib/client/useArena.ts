"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArenaDirector, type ArenaView } from "./director.js";
import { buildBots, botMeta, type BotMeta, type MatchSetup } from "./bots.js";

export interface ArenaControls {
  view: ArenaView;
  meta: [BotMeta, BotMeta];
  playing: boolean;
  /** 0..100 slider value (higher = faster). */
  speed: number;
  play: () => void;
  pause: () => void;
  toggle: () => void;
  stepOnce: () => void;
  setSpeed: (v: number) => void;
  newMatch: (setup: MatchSetup) => void;
}

const STACK = 200;

/** Map the 0..100 speed slider to a per-step delay in ms (higher = faster). */
function delayForSpeed(speed: number): number {
  const t = Math.max(0, Math.min(100, speed)) / 100;
  return Math.round(1500 - t * 1380); // 1500ms (slow) … 120ms (fast)
}

export function useArena(initial: MatchSetup): ArenaControls {
  const [setup, setSetup] = useState<MatchSetup>(initial);
  const directorRef = useRef<ArenaDirector | null>(null);
  const meta = useMemo(() => botMeta(setup), [setup]);

  if (directorRef.current === null) {
    directorRef.current = new ArenaDirector(
      { seed: setup.seed, smallBlind: 1, bigBlind: 2, startingStack: STACK },
      buildBots(setup),
    );
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

  const newMatch = useCallback((next: MatchSetup) => {
    setPlaying(false);
    directorRef.current = new ArenaDirector(
      { seed: next.seed, smallBlind: 1, bigBlind: 2, startingStack: STACK },
      buildBots(next),
    );
    setSetup(next);
    setView(directorRef.current.getView());
  }, []);

  return { view, meta, playing, speed, play, pause, toggle, stepOnce, setSpeed, newMatch };
}
