"use client";

/**
 * CoachPanel — write a lesson → it's injected into the bot's playbook → it takes
 * effect on the bot's next decision (the playbook is read fresh per /api/decide).
 * Frequencies/notes are the coachable knobs; all the NUMBERS the bot is judged on
 * (HUD, equity) come from the engine elsewhere — the coach only sets strategy.
 *
 * The playbook is client-held and session-scoped (Vercel-stateless). "Reflect"
 * runs the coach LLM (mock offline, live with ANTHROPIC_API_KEY) over the
 * session's real hands and applies the returned diff.
 */

import { useState } from "react";
import type { Playbook, PlaybookDiff, TunablePath } from "@/learning/playbook.js";
import type { BotMeta } from "@/lib/client/bots.js";
import type { Seat } from "@/engine/state.js";

const KNOBS: { path: TunablePath; label: string }[] = [
  { path: "preflop.openRaise", label: "Open-raise" },
  { path: "preflop.threeBet", label: "3-bet" },
  { path: "postflop.cbet", label: "C-bet" },
  { path: "postflop.doubleBarrel", label: "Double-barrel" },
  { path: "postflop.bluffRaise", label: "Bluff-raise" },
];

function readFreq(pb: Playbook, path: TunablePath): number {
  const [g, f] = path.split(".") as [keyof Playbook, string];
  return (pb[g] as Record<string, number>)[f]!;
}

export function CoachPanel({
  playbooks,
  meta,
  mode,
  llmLive,
  onAddNote,
  onSetTunable,
  onReflect,
}: {
  playbooks: [Playbook, Playbook];
  meta: [BotMeta, BotMeta];
  mode: "heuristic" | "reasoning";
  llmLive: boolean | null;
  onAddNote: (seat: Seat, note: string) => void;
  onSetTunable: (seat: Seat, path: TunablePath, value: number) => void;
  onReflect: (seat: Seat) => Promise<PlaybookDiff | null>;
}) {
  const [seat, setSeat] = useState<Seat>(0);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [lastDiff, setLastDiff] = useState<PlaybookDiff | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const pb = playbooks[seat]!;
  const m = meta[seat]!;

  const add = () => {
    if (!draft.trim()) return;
    onAddNote(seat, draft);
    setDraft("");
    setMsg(mode === "reasoning" ? "Leçon injectée — effet dès la prochaine décision." : "Leçon ajoutée (passe en mode Reasoning pour qu'elle agisse).");
  };

  const reflect = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const diff = await onReflect(seat);
      if (!diff) setMsg("Aucune main jouée cette session — joue quelques mains avant de réfléchir.");
      else {
        setLastDiff(diff);
        setMsg(`Coach: ${diff.summary}`);
      }
    } catch (e) {
      setMsg(`Erreur reflect: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="panel rounded-xl p-4">
      <div className="mb-3 flex items-center justify-between">
        <span className="eyebrow" style={{ color: "var(--color-brass-bright)" }}>
          Coaching
        </span>
        <div className="flex overflow-hidden rounded-lg" style={{ border: "1px solid var(--color-line)" }}>
          {([0, 1] as Seat[]).map((s) => (
            <button
              key={s}
              onClick={() => { setSeat(s); setLastDiff(null); setMsg(null); }}
              className="px-3 py-1 text-xs transition-all"
              style={{
                background: seat === s ? meta[s]!.accent : "transparent",
                color: seat === s ? "#10130d" : "var(--color-muted)",
                fontWeight: seat === s ? 700 : 500,
              }}
            >
              {meta[s]!.name}
            </button>
          ))}
        </div>
      </div>

      {mode !== "reasoning" && (
        <p className="data mb-3 text-[0.7rem]" style={{ color: "var(--color-amber)" }}>
          Le coaching agit sur les bots <b>Reasoning</b>. Passe le mode sur Reasoning et lance un match pour le voir s&apos;adapter.
        </p>
      )}

      {/* Lesson input */}
      <label className="eyebrow mb-1 block">Leçon pour {m.name}</label>
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder="ex. Villain sur-folde face aux c-bets — barrele plus souvent."
        rows={2}
        className="data w-full rounded bg-transparent px-2 py-1.5 text-sm outline-none"
        style={{ border: "1px solid var(--color-line)", color: "var(--color-cream)", resize: "vertical" }}
      />
      <div className="mt-2 flex gap-2">
        <button
          onClick={add}
          disabled={!draft.trim()}
          className="rounded-lg px-3 py-1.5 text-sm transition-all hover:brightness-125 disabled:opacity-40"
          style={{ border: "1px solid var(--color-line)", color: "var(--color-jade)" }}
        >
          + Ajouter la leçon
        </button>
        <button
          onClick={reflect}
          disabled={busy}
          className="ml-auto rounded-lg px-3 py-1.5 text-sm transition-all hover:brightness-125 disabled:opacity-50"
          style={{ border: "1px solid var(--color-line)", color: "var(--color-brass-bright)" }}
          title={llmLive ? "Coach LLM live (Anthropic)" : "Coach LLM mock (offline)"}
        >
          {busy ? "Réflexion…" : `↻ Reflect (${llmLive ? "live" : "mock"})`}
        </button>
      </div>

      {msg && (
        <p className="data mt-2 text-[0.72rem]" style={{ color: "var(--color-muted)" }}>
          {msg}
        </p>
      )}

      {/* Tunable frequencies */}
      <div className="mt-4">
        <span className="eyebrow">Fréquences ({m.name})</span>
        <div className="mt-2 flex flex-col gap-2">
          {KNOBS.map(({ path, label }) => {
            const v = readFreq(pb, path);
            return (
              <div key={path} className="flex items-center gap-2">
                <span className="data w-28 text-[0.72rem]" style={{ color: "var(--color-muted)" }}>
                  {label}
                </span>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={v}
                  onChange={(e) => onSetTunable(seat, path, Number(e.target.value))}
                  className="flex-1"
                  style={{ accentColor: m.accent }}
                />
                <span className="data w-10 text-right text-[0.72rem]" style={{ color: "var(--color-cream)", fontVariantNumeric: "tabular-nums" }}>
                  {Math.round(v * 100)}%
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Current notes */}
      <div className="mt-4">
        <span className="eyebrow">Notes du playbook v{pb.version}</span>
        {pb.notes.length === 0 ? (
          <p className="data mt-1 text-[0.72rem]" style={{ color: "var(--color-muted)" }}>
            (aucune note — ajoute une leçon ci-dessus)
          </p>
        ) : (
          <ul className="mt-1 flex flex-col gap-1">
            {pb.notes.map((n, i) => (
              <li key={i} className="data text-[0.74rem] leading-snug" style={{ color: "var(--color-cream)" }}>
                <span style={{ color: m.accent }}>•</span> {n}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Last coach diff */}
      {lastDiff && lastDiff.changes.length > 0 && (
        <div className="mt-4">
          <span className="eyebrow">Dernier diff du coach</span>
          <ul className="mt-1 flex flex-col gap-1">
            {lastDiff.changes.map((c, i) => (
              <li key={i} className="data text-[0.72rem]" style={{ color: "var(--color-muted)" }}>
                <span style={{ color: "var(--color-brass-bright)" }}>{c.path}</span>{" "}
                {Math.round(c.from * 100) / 100} → {Math.round(c.to * 100) / 100} · {c.reason}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
