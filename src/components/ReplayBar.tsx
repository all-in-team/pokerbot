"use client";

import type { ReplayFrame } from "@/lib/client/replay.js";

export function ReplayBar({
  frames,
  frameIdx,
  setFrameIdx,
  playing,
  setPlaying,
  histIndex,
  total,
  onPrevHand,
  onNextHand,
  onClose,
}: {
  frames: ReplayFrame[];
  frameIdx: number;
  setFrameIdx: (i: number) => void;
  playing: boolean;
  setPlaying: (p: boolean) => void;
  histIndex: number;
  total: number;
  onPrevHand: () => void;
  onNextHand: () => void;
  onClose: () => void;
}) {
  const last = frames.length - 1;
  const clamp = (i: number) => Math.max(0, Math.min(last, i));
  const caption = frames[frameIdx]?.caption ?? "";

  return (
    <div className="panel rounded-xl p-4" style={{ borderColor: "var(--color-brass)" }}>
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="eyebrow" style={{ color: "var(--color-brass)" }}>
            ⏮ replay
          </span>
          <button onClick={onPrevHand} className="data px-1.5 text-sm hover:brightness-150" style={{ color: "var(--color-muted)" }} title="Older hand">
            ‹
          </button>
          <span className="data text-[0.72rem]" style={{ color: "var(--color-cream)" }}>
            hand {histIndex + 1} / {total}
          </span>
          <button onClick={onNextHand} className="data px-1.5 text-sm hover:brightness-150" style={{ color: "var(--color-muted)" }} title="Newer hand">
            ›
          </button>
        </div>
        <button onClick={onClose} className="data text-[0.7rem] hover:brightness-150" style={{ color: "var(--color-rust)" }}>
          ✕ exit replay
        </button>
      </div>

      <div className="mb-2 data text-[0.78rem]" style={{ color: "var(--color-cream)" }}>
        <span style={{ color: "var(--color-muted)" }}>{frameIdx} / {last} · </span>
        {caption}
      </div>

      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1">
          <Btn onClick={() => { setPlaying(false); setFrameIdx(0); }} label="First">⏮</Btn>
          <Btn onClick={() => { setPlaying(false); setFrameIdx(clamp(frameIdx - 1)); }} label="Back">◀</Btn>
          <Btn onClick={() => setPlaying(!playing)} label={playing ? "Pause" : "Play"} primary>
            {playing ? "❚❚" : "▶"}
          </Btn>
          <Btn onClick={() => { setPlaying(false); setFrameIdx(clamp(frameIdx + 1)); }} label="Forward">▶</Btn>
          <Btn onClick={() => { setPlaying(false); setFrameIdx(last); }} label="Last">⏭</Btn>
        </div>
        <input
          type="range"
          min={0}
          max={last}
          value={frameIdx}
          onChange={(e) => { setPlaying(false); setFrameIdx(Number(e.target.value)); }}
          className="arena-range h-1 flex-1 cursor-pointer appearance-none rounded-full"
          style={{ background: "linear-gradient(90deg, var(--color-brass), rgba(255,255,255,0.1))" }}
        />
      </div>
    </div>
  );
}

function Btn({ onClick, label, children, primary = false }: { onClick: () => void; label: string; children: React.ReactNode; primary?: boolean }) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={label}
      className="flex h-8 w-8 items-center justify-center rounded text-sm transition-all hover:brightness-125 active:scale-95"
      style={{
        background: primary ? "var(--color-brass-bright)" : "rgba(255,255,255,0.04)",
        color: primary ? "#1a130a" : "var(--color-cream)",
        border: `1px solid ${primary ? "var(--color-brass-bright)" : "var(--color-line)"}`,
      }}
    >
      {children}
    </button>
  );
}
