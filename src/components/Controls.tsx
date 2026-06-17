"use client";

import type { ArenaControls } from "@/lib/client/useArena.js";

function IconButton({
  onClick,
  label,
  children,
  primary = false,
  accent = "var(--color-brass)",
}: {
  onClick: () => void;
  label: string;
  children: React.ReactNode;
  primary?: boolean;
  accent?: string;
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={label}
      className="flex h-10 items-center justify-center gap-2 rounded-lg px-4 text-sm transition-all hover:brightness-125 active:scale-95"
      style={{
        background: primary ? accent : "rgba(255,255,255,0.04)",
        color: primary ? "#1a130a" : "var(--color-cream)",
        border: `1px solid ${primary ? accent : "var(--color-line)"}`,
        fontWeight: primary ? 700 : 500,
      }}
    >
      {children}
    </button>
  );
}

export function Controls({ arena }: { arena: ArenaControls }) {
  const { playing, play, pause, stepOnce, speed, setSpeed } = arena;
  return (
    <div className="flex flex-wrap items-center gap-3">
      <IconButton onClick={playing ? pause : play} label={playing ? "Pause" : "Play"} primary accent="var(--color-brass-bright)">
        {playing ? "❚❚ Pause" : "▶ Play"}
      </IconButton>
      <IconButton onClick={stepOnce} label="Step one action">
        ⤳ Step
      </IconButton>

      <div className="flex items-center gap-2.5 rounded-lg px-3 py-2" style={{ border: "1px solid var(--color-line)" }}>
        <span className="eyebrow">speed</span>
        <input
          type="range"
          min={0}
          max={100}
          value={speed}
          onChange={(e) => setSpeed(Number(e.target.value))}
          className="arena-range h-1 w-28 cursor-pointer appearance-none rounded-full"
          style={{ background: "linear-gradient(90deg, var(--color-brass), rgba(255,255,255,0.1))" }}
        />
      </div>
    </div>
  );
}
