"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { LineChart, type Series } from "@/components/LineChart.js";
import type { Playbook, PlaybookDiff } from "@/learning/playbook.js";
import type { HudStats } from "@/sim/hud.js";

interface MatchSummary {
  id: number;
  createdAt: string;
  bigBlind: number;
  bot0Name: string;
  bot1Name: string;
  bot0Style: string | null;
  bot1Style: string | null;
  mode: string;
  hands: number;
  sessions: number;
}
interface SessionStat {
  sessionIndex: number;
  botSeat: number;
  botName: string;
  hands: number;
  netChips: number;
  bbPer100: number;
  stats: HudStats;
}
interface PlaybookVersion {
  version: number;
  sessionIndex: number | null;
  playbook: Playbook;
  diffText: string | null;
}
interface LearningData {
  match: MatchSummary;
  sessionStats: SessionStat[];
  playbooks: [PlaybookVersion[], PlaybookVersion[]];
}

const SEAT_COLORS = ["#5fd1c4", "#e8a64e"];
const pct = (x: number) => `${Math.round(x * 100)}%`;

export default function LearningPage() {
  const [matches, setMatches] = useState<MatchSummary[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [data, setData] = useState<LearningData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/matches")
      .then((r) => r.json())
      .then((d) => {
        const ms: MatchSummary[] = d.matches ?? [];
        setMatches(ms);
        const withLearning = ms.find((m) => m.sessions > 0) ?? ms[0];
        setSelected(withLearning?.id ?? null);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (selected === null) return;
    setData(null);
    fetch(`/api/learning?matchId=${selected}`)
      .then((r) => r.json())
      .then((d) => (d.error ? setData(null) : setData(d)))
      .catch(() => setData(null));
  }, [selected]);

  return (
    <main className="mx-auto min-h-screen max-w-[1200px] px-5 py-6">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="eyebrow mb-1">how their strategy evolves</div>
          <h1 className="brass text-4xl font-semibold leading-none" style={{ fontFamily: "var(--font-display)" }}>
            Learning Timeline
          </h1>
        </div>
        <div className="flex items-center gap-3">
          {matches.length > 0 && (
            <select
              value={selected ?? ""}
              onChange={(e) => setSelected(Number(e.target.value))}
              className="data rounded px-3 py-2 text-sm outline-none"
              style={{ border: "1px solid var(--color-line)", background: "#0a1611", color: "var(--color-cream)" }}
            >
              {matches.map((m) => (
                <option key={m.id} value={m.id}>
                  #{m.id} {m.bot0Name} vs {m.bot1Name} · {m.mode} · {m.hands}h{m.sessions ? ` · ${m.sessions} sessions` : ""}
                </option>
              ))}
            </select>
          )}
          <Link
            href="/"
            className="rounded-lg px-4 py-2 text-sm transition-all hover:brightness-125"
            style={{ border: "1px solid var(--color-line)", color: "var(--color-brass-bright)" }}
          >
            ← Table
          </Link>
        </div>
      </header>

      {loading && <Empty>loading matches…</Empty>}
      {!loading && matches.length === 0 && (
        <Empty>
          No matches in the database yet. Run <code className="data">npm run reason</code> to generate a learning match,
          then refresh.
        </Empty>
      )}
      {!loading && data && data.match.sessions === 0 && (
        <Empty>
          Match #{data.match.id} is heuristic self-play with no learning data. Pick a reasoning match, or run{" "}
          <code className="data">npm run reason</code>.
        </Empty>
      )}
      {!loading && data && data.match.sessions > 0 && <Timeline data={data} />}
    </main>
  );
}

function Timeline({ data }: { data: LearningData }) {
  const { match, sessionStats, playbooks } = data;

  const perSeat = useMemo(() => {
    const seats: SessionStat[][] = [[], []];
    for (const s of sessionStats) seats[s.botSeat]?.push(s);
    seats.forEach((arr) => arr.sort((a, b) => a.sessionIndex - b.sessionIndex));
    return seats;
  }, [sessionStats]);

  const bbSeries: Series[] = [0, 1].map((seat) => ({
    label: seat === 0 ? match.bot0Name : match.bot1Name,
    color: SEAT_COLORS[seat]!,
    points: perSeat[seat]!.map((s) => s.bbPer100),
  }));

  const cumulative: Series[] = [0, 1].map((seat) => {
    let acc = 0;
    return {
      label: seat === 0 ? match.bot0Name : match.bot1Name,
      color: SEAT_COLORS[seat]!,
      points: perSeat[seat]!.map((s) => (acc += s.netChips)),
    };
  });

  return (
    <div className="space-y-6">
      {/* Headline charts */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <div className="panel rounded-xl p-5">
          <ChartTitle>win rate · bb per 100 by session</ChartTitle>
          <LineChart series={bbSeries} yLabel="bb/100" format={(v) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}`} />
        </div>
        <div className="panel rounded-xl p-5">
          <ChartTitle>cumulative net chips</ChartTitle>
          <LineChart series={cumulative} yLabel="chips" format={(v) => `${v >= 0 ? "+" : ""}${Math.round(v)}`} />
        </div>
      </div>

      {/* Per-bot strategy evolution */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {[0, 1].map((seat) => (
          <BotEvolution
            key={seat}
            seat={seat}
            name={seat === 0 ? match.bot0Name : match.bot1Name}
            style={(seat === 0 ? match.bot0Style : match.bot1Style) ?? ""}
            versions={playbooks[seat]!}
          />
        ))}
      </div>
    </div>
  );
}

function BotEvolution({
  seat,
  name,
  style,
  versions,
}: {
  seat: number;
  name: string;
  style: string;
  versions: PlaybookVersion[];
}) {
  const color = SEAT_COLORS[seat]!;
  const freqSeries: Series[] = [
    { label: "c-bet", color: "#5fd1c4", points: versions.map((v) => v.playbook.postflop.cbet * 100) },
    { label: "2-barrel", color: "#e8a64e", points: versions.map((v) => v.playbook.postflop.doubleBarrel * 100) },
    { label: "bluff-raise", color: "#d8694c", points: versions.map((v) => v.playbook.postflop.bluffRaise * 100) },
  ];

  return (
    <div className="panel rounded-xl p-5">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-lg" style={{ fontFamily: "var(--font-display)", color: "var(--color-cream)" }}>
          {name}
          <span className="data ml-2 text-[0.6rem] uppercase" style={{ color }}>
            {style}
          </span>
        </span>
        <span className="eyebrow">v1 → v{versions.at(-1)?.version ?? 1}</span>
      </div>

      <ChartTitle>postflop tendencies over versions (%)</ChartTitle>
      <LineChart series={freqSeries} height={150} symmetric={false} format={(v) => `${v.toFixed(0)}%`} />

      <div className="mt-4 space-y-2.5">
        <span className="eyebrow">playbook revisions</span>
        {versions
          .filter((v) => v.version > 1)
          .reverse()
          .map((v) => (
            <VersionCard key={v.version} version={v} accent={color} />
          ))}
        {versions.length <= 1 && (
          <p className="data text-[0.72rem]" style={{ color: "var(--color-muted)" }}>
            no revisions yet
          </p>
        )}
      </div>
    </div>
  );
}

function VersionCard({ version, accent }: { version: PlaybookVersion; accent: string }) {
  let diff: PlaybookDiff | null = null;
  try {
    diff = version.diffText ? (JSON.parse(version.diffText) as PlaybookDiff) : null;
  } catch {
    diff = null;
  }
  return (
    <div className="rounded-lg p-3" style={{ border: "1px solid var(--color-line)", background: "rgba(0,0,0,0.2)" }}>
      <div className="flex items-baseline gap-2">
        <span className="data text-[0.7rem]" style={{ color: accent }}>
          v{version.version}
        </span>
        <span className="text-[0.82rem]" style={{ color: "var(--color-cream)" }}>
          {diff?.summary ?? "updated"}
        </span>
      </div>
      {diff && diff.changes.length > 0 && (
        <ul className="mt-1.5 space-y-1">
          {diff.changes.map((c, i) => (
            <li key={i} className="data flex items-baseline gap-2 text-[0.7rem]">
              <span style={{ color: "var(--color-brass)" }}>{c.path}</span>
              <span style={{ color: "var(--color-muted)" }}>
                {fmt(c.from)} → {fmt(c.to)}
              </span>
              <span style={{ color: "var(--color-muted)", opacity: 0.85 }}>· {c.reason}</span>
            </li>
          ))}
        </ul>
      )}
      {diff && diff.addedNotes.length > 0 && (
        <div className="mt-2 space-y-1">
          {diff.addedNotes.map((note, i) => (
            <p key={i} className="text-[0.74rem] italic" style={{ color: "var(--color-cream)", opacity: 0.85 }}>
              “{note}”
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

const fmt = (v: number) => (v <= 1 && v >= 0 && !Number.isInteger(v) ? `${Math.round(v * 100)}%` : `${v}`);

function ChartTitle({ children }: { children: React.ReactNode }) {
  return <div className="eyebrow mb-3">{children}</div>;
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="panel rounded-xl p-10 text-center">
      <p className="data text-sm" style={{ color: "var(--color-muted)" }}>
        {children}
      </p>
    </div>
  );
}
