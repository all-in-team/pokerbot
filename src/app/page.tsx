"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useArena, type ArenaMode } from "@/lib/client/useArena.js";
import { DEFAULT_SETUP, type MatchSetup } from "@/lib/client/bots.js";
import type { PersonalityName } from "@/bots/heuristic.js";
import { PokerTable } from "@/components/PokerTable.js";
import { ThoughtPanel } from "@/components/ThoughtPanel.js";
import { HudPanel } from "@/components/HudPanel.js";
import { ActionLog } from "@/components/ActionLog.js";
import { Controls } from "@/components/Controls.js";
import { ReplayBar } from "@/components/ReplayBar.js";
import { buildHandFrames, type ReplayFrame } from "@/lib/client/replay.js";

const PERSONALITIES: PersonalityName[] = ["TAG", "LAG", "nit", "maniac"];

export default function ArenaPage() {
  const arena = useArena(DEFAULT_SETUP);
  const { view, meta } = arena;
  const [draft, setDraft] = useState<MatchSetup>(DEFAULT_SETUP);
  const [draftMode, setDraftMode] = useState<ArenaMode>("heuristic");
  const [llmLive, setLlmLive] = useState<boolean | null>(null);

  useEffect(() => {
    fetch("/api/llm-status")
      .then((r) => r.json())
      .then((d) => setLlmLive(Boolean(d.live)))
      .catch(() => setLlmLive(false));
  }, []);

  const startNew = () => {
    const next = { ...draft, seed: `${draft.seed}-${Math.floor(performance.now())}` };
    arena.newMatch(next, draftMode);
    setReplay(null);
  };

  // --- Replay scrubbing ---
  const [replay, setReplay] = useState<{ histIndex: number; frames: ReplayFrame[] } | null>(null);
  const [frameIdx, setFrameIdx] = useState(0);
  const [replayPlaying, setReplayPlaying] = useState(false);

  const openReplayAt = (idx: number) => {
    const hist = arena.getHistory();
    if (idx < 0 || idx >= hist.length) return;
    arena.pause();
    setReplay({ histIndex: idx, frames: buildHandFrames(hist[idx]!, meta) });
    setFrameIdx(0);
    setReplayPlaying(false);
  };
  const openReplay = () => openReplayAt(arena.getHistory().length - 1);

  useEffect(() => {
    if (!replay || !replayPlaying) return;
    const last = replay.frames.length - 1;
    const t = setInterval(() => setFrameIdx((p) => (p >= last ? p : p + 1)), 750);
    return () => clearInterval(t);
  }, [replay, replayPlaying]);
  useEffect(() => {
    if (replay && replayPlaying && frameIdx >= replay.frames.length - 1) setReplayPlaying(false);
  }, [frameIdx, replay, replayPlaying]);

  const displayView = replay ? (replay.frames[frameIdx]?.view ?? view) : view;
  const historyCount = arena.getHistory().length;

  return (
    <main className="mx-auto min-h-screen max-w-[1400px] px-5 py-6">
      {/* Header */}
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="eyebrow mb-1">Heads-Up · No-Limit Hold&apos;em</div>
          <h1 className="brass text-4xl font-semibold leading-none tracking-tight" style={{ fontFamily: "var(--font-display)" }}>
            AI Poker Arena
          </h1>
        </div>
        <div className="flex items-center gap-5">
          <Scoreboard arena={arena} />
          <Controls arena={arena} />
          <button
            onClick={replay ? () => setReplay(null) : openReplay}
            disabled={!replay && historyCount === 0}
            className="rounded-lg px-4 py-2 text-sm transition-all hover:brightness-125 disabled:opacity-40"
            style={{ border: "1px solid var(--color-line)", color: replay ? "var(--color-rust)" : "var(--color-brass-bright)" }}
            title={historyCount === 0 ? "Play a hand first" : "Scrub through past hands"}
          >
            {replay ? "Exit Replay" : `Replay ⏮ ${historyCount}`}
          </button>
          <Link
            href="/learning"
            className="rounded-lg px-4 py-2 text-sm transition-all hover:brightness-125"
            style={{ border: "1px solid var(--color-line)", color: "var(--color-brass-bright)" }}
          >
            Learning ↗
          </Link>
        </div>
      </header>

      {/* Setup bar */}
      <SetupBar
        draft={draft}
        setDraft={setDraft}
        onStart={startNew}
        mode={draftMode}
        setMode={setDraftMode}
        llmLive={llmLive}
      />

      {/* Main grid */}
      <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-[1fr_minmax(540px,1.4fr)_1fr]">
        {/* Left rail — seat 0 */}
        <div className="order-2 flex flex-col gap-4 lg:order-1">
          <ThoughtPanel thought={displayView.thoughts[0]} meta={meta[0]} align="left" />
          <HudPanel hud={view.hud[0]} meta={meta[0]} net={view.sessionNet[0]} align="left" />
        </div>

        {/* Center — the table */}
        <div className="order-1 lg:order-2">
          <PokerTable view={displayView} meta={meta} />
        </div>

        {/* Right rail — seat 1 */}
        <div className="order-3 flex flex-col gap-4">
          <ThoughtPanel thought={displayView.thoughts[1]} meta={meta[1]} align="right" />
          <HudPanel hud={view.hud[1]} meta={meta[1]} net={view.sessionNet[1]} align="right" />
        </div>
      </div>

      {/* Replay scrubber + action log */}
      <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-[1fr_minmax(540px,1.4fr)_1fr]">
        <div className="hidden lg:block" />
        <div className="flex flex-col gap-4">
          {replay && (
            <ReplayBar
              frames={replay.frames}
              frameIdx={frameIdx}
              setFrameIdx={setFrameIdx}
              playing={replayPlaying}
              setPlaying={setReplayPlaying}
              histIndex={replay.histIndex}
              total={historyCount}
              onPrevHand={() => openReplayAt(replay.histIndex - 1)}
              onNextHand={() => openReplayAt(replay.histIndex + 1)}
              onClose={() => setReplay(null)}
            />
          )}
          <ActionLog view={displayView} meta={meta} />
        </div>
        <div className="hidden lg:block" />
      </div>

      <footer className="mt-8 text-center">
        <span className="eyebrow" style={{ opacity: 0.5 }}>
          {arena.mode === "reasoning"
            ? llmLive
              ? "reasoning agents · live Anthropic API"
              : "reasoning agents · offline mock (set ANTHROPIC_API_KEY for live)"
            : "heuristic agents · switch to Reasoning above to watch the LLM think"}
        </span>
      </footer>
    </main>
  );
}

function Scoreboard({ arena }: { arena: ReturnType<typeof useArena> }) {
  const { view } = arena;
  return (
    <div className="flex items-center gap-4 rounded-lg px-4 py-2" style={{ border: "1px solid var(--color-line)" }}>
      <Stat label="hand" value={`${view.handIndex + 1}`} />
      <Divider />
      <Stat label="played" value={`${view.handsPlayed}`} />
      <Divider />
      <Stat label="blinds" value={`${view.smallBlind}/${view.bigBlind}`} />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col items-center">
      <span className="eyebrow">{label}</span>
      <span className="data text-base" style={{ color: "var(--color-cream)" }}>
        {value}
      </span>
    </div>
  );
}

function Divider() {
  return <div className="h-7 w-px" style={{ background: "var(--color-line)" }} />;
}

function ModeToggle({
  mode,
  setMode,
  llmLive,
}: {
  mode: ArenaMode;
  setMode: (m: ArenaMode) => void;
  llmLive: boolean | null;
}) {
  return (
    <div className="flex items-center gap-2">
      <div className="flex overflow-hidden rounded-lg" style={{ border: "1px solid var(--color-line)" }}>
        {(["heuristic", "reasoning"] as ArenaMode[]).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className="px-3 py-1.5 text-xs capitalize transition-all"
            style={{
              background: mode === m ? "var(--color-brass-bright)" : "transparent",
              color: mode === m ? "#1a130a" : "var(--color-muted)",
              fontWeight: mode === m ? 700 : 500,
            }}
          >
            {m}
          </button>
        ))}
      </div>
      {mode === "reasoning" && (
        <span
          className="data text-[0.6rem] uppercase"
          style={{ color: llmLive ? "var(--color-jade)" : "var(--color-amber)" }}
          title={llmLive ? "Using the live Anthropic API" : "Using the offline mock client"}
        >
          {llmLive === null ? "…" : llmLive ? "● live API" : "● mock"}
        </span>
      )}
    </div>
  );
}

function SetupBar({
  draft,
  setDraft,
  onStart,
  mode,
  setMode,
  llmLive,
}: {
  draft: MatchSetup;
  setDraft: (s: MatchSetup) => void;
  onStart: () => void;
  mode: ArenaMode;
  setMode: (m: ArenaMode) => void;
  llmLive: boolean | null;
}) {
  const setSeat = (i: 0 | 1, patch: Partial<MatchSetup["seats"][0]>) => {
    const seats = [...draft.seats] as MatchSetup["seats"];
    seats[i] = { ...seats[i], ...patch };
    setDraft({ ...draft, seats });
  };

  return (
    <div className="panel flex flex-wrap items-center gap-4 rounded-xl px-4 py-3">
      <ModeToggle mode={mode} setMode={setMode} llmLive={llmLive} />
      <div className="h-7 w-px" style={{ background: "var(--color-line)" }} />
      <span className="eyebrow">new match</span>
      {[0, 1].map((i) => (
        <div key={i} className="flex items-center gap-2">
          <input
            value={draft.seats[i as 0 | 1].name}
            onChange={(e) => setSeat(i as 0 | 1, { name: e.target.value })}
            className="data w-24 rounded bg-transparent px-2 py-1 text-sm outline-none"
            style={{ border: "1px solid var(--color-line)", color: "var(--color-cream)" }}
          />
          <select
            value={draft.seats[i as 0 | 1].personality}
            onChange={(e) => setSeat(i as 0 | 1, { personality: e.target.value as PersonalityName })}
            className="data rounded px-2 py-1 text-sm outline-none"
            style={{ border: "1px solid var(--color-line)", background: "#0a1611", color: "var(--color-cream)" }}
          >
            {PERSONALITIES.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
          {i === 0 && <span className="eyebrow px-1">vs</span>}
        </div>
      ))}
      <button
        onClick={onStart}
        className="ml-auto rounded-lg px-4 py-2 text-sm transition-all hover:brightness-125 active:scale-95"
        style={{ border: "1px solid var(--color-line)", color: "var(--color-brass-bright)" }}
      >
        ⟳ New Match
      </button>
    </div>
  );
}
