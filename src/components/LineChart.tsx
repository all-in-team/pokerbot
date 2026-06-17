"use client";

import { motion } from "framer-motion";

export interface Series {
  label: string;
  color: string;
  points: number[];
}

/** Minimal dependency-free SVG line chart with a zero baseline. */
export function LineChart({
  series,
  height = 180,
  yLabel,
  symmetric = true,
  format = (v) => v.toFixed(0),
}: {
  series: Series[];
  height?: number;
  yLabel?: string;
  /** Center the y-axis on zero (good for bb/100 which goes negative). */
  symmetric?: boolean;
  format?: (v: number) => string;
}) {
  const all = series.flatMap((s) => s.points);
  const n = Math.max(...series.map((s) => s.points.length), 1);
  if (all.length === 0) {
    return <div className="data text-sm" style={{ color: "var(--color-muted)" }}>no session data yet</div>;
  }

  const rawMax = Math.max(...all, 0);
  const rawMin = Math.min(...all, 0);
  const bound = symmetric ? Math.max(Math.abs(rawMax), Math.abs(rawMin)) || 1 : 0;
  const yMax = symmetric ? bound : rawMax || 1;
  const yMin = symmetric ? -bound : rawMin;

  const W = 100; // viewBox units (responsive via width 100%)
  const H = height;
  const padL = 6;
  const padR = 4;
  const padTB = 14;
  const innerW = W - padL - padR;
  const innerH = H - padTB * 2;

  const x = (i: number) => padL + (n === 1 ? innerW / 2 : (i / (n - 1)) * innerW);
  const y = (v: number) => padTB + innerH - ((v - yMin) / (yMax - yMin || 1)) * innerH;
  const zeroY = y(0);

  return (
    <div className="w-full">
      {yLabel && <div className="eyebrow mb-1">{yLabel}</div>}
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none" style={{ overflow: "visible" }}>
        {/* zero baseline */}
        <line x1={padL} x2={W - padR} y1={zeroY} y2={zeroY} stroke="rgba(255,255,255,0.14)" strokeWidth={0.4} strokeDasharray="1.5 1.5" />
        <text x={padL} y={zeroY - 1.5} fontSize={3} fill="var(--color-muted)" fontFamily="var(--font-mono)">0</text>

        {series.map((s) => {
          if (s.points.length === 0) return null;
          const d = s.points.map((p, i) => `${i === 0 ? "M" : "L"} ${x(i).toFixed(2)} ${y(p).toFixed(2)}`).join(" ");
          return (
            <g key={s.label}>
              <motion.path
                d={d}
                fill="none"
                stroke={s.color}
                strokeWidth={0.9}
                strokeLinejoin="round"
                strokeLinecap="round"
                initial={{ pathLength: 0, opacity: 0 }}
                animate={{ pathLength: 1, opacity: 1 }}
                transition={{ duration: 0.7 }}
                vectorEffect="non-scaling-stroke"
              />
              {s.points.map((p, i) => (
                <circle key={i} cx={x(i)} cy={y(p)} r={1.1} fill={s.color} />
              ))}
            </g>
          );
        })}
      </svg>

      <div className="mt-2 flex items-center gap-4">
        {series.map((s) => (
          <div key={s.label} className="flex items-center gap-1.5">
            <span style={{ width: 10, height: 10, borderRadius: 2, background: s.color, display: "inline-block" }} />
            <span className="data text-[0.72rem]" style={{ color: "var(--color-cream)" }}>
              {s.label}
              <span style={{ color: "var(--color-muted)" }}>
                {" "}
                {format(s.points.at(-1) ?? 0)}
              </span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
