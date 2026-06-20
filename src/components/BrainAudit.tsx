"use client";

/**
 * /play debug panel — fast headless bot-vs-bot audit of the EV brain. Runs N hands
 * with no animation (chunked so the tab stays responsive) and shows an aggregate
 * behaviour recap. Pure tooling: nothing trains, decideEV is unchanged.
 */

import { useState } from "react";
import { THEME as C } from "@/lib/theme.js";
import { runAudit, type AuditResult, type ActionCat } from "@/lib/client/simAudit.js";

const PRESETS = [100, 1000, 5000];
const CATS: ActionCat[] = ["fold", "check", "call", "bet", "raise", "all-in"];
const STREETS = ["preflop", "flop", "turn", "river"] as const;
const pctStr = (x: number) => `${x.toFixed(x >= 10 ? 0 : 1)}%`;

export function BrainAudit() {
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<AuditResult | null>(null);

  const run = async (hands: number) => {
    if (running) return;
    setRunning(true);
    setResult(null);
    setProgress(0);
    try {
      const res = await runAudit({ hands, onProgress: (d, t) => setProgress(t ? d / t : 1) });
      setResult(res);
    } catch (e) {
      console.warn("[audit] failed:", e);
    } finally {
      setRunning(false);
    }
  };

  return (
    <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14, padding: 14 }}>
      <div style={{ fontSize: 11, letterSpacing: 0.8, textTransform: "uppercase", color: C.text3, marginBottom: 6, fontWeight: 700 }}>
        Audit du cerveau (sim rapide)
      </div>
      <p style={{ fontSize: 11.5, color: C.text2, lineHeight: 1.45, margin: "0 0 10px" }}>
        Bot-vs-bot headless (même cerveau EV, sans lecture/exploit) pour vérifier en chiffres que le jeu est sain.
      </p>

      <div style={{ display: "flex", gap: 6 }}>
        {PRESETS.map((n) => (
          <button
            key={n}
            disabled={running}
            onClick={() => void run(n)}
            style={{
              flex: 1,
              appearance: "none",
              border: `1px solid ${C.border}`,
              borderRadius: 9,
              background: running ? "transparent" : C.appBg,
              color: running ? C.text3 : C.text,
              fontSize: 12.5,
              fontWeight: 700,
              minHeight: 38,
              cursor: running ? "default" : "pointer",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {n.toLocaleString("fr-FR")}
          </button>
        ))}
      </div>

      {running && (
        <div style={{ marginTop: 10 }}>
          <div style={{ height: 6, borderRadius: 999, background: C.appBg, overflow: "hidden" }}>
            <div style={{ width: `${Math.round(progress * 100)}%`, height: "100%", background: C.teal, transition: "width .1s linear" }} />
          </div>
          <div style={{ fontSize: 11, color: C.text3, marginTop: 4, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
            {Math.round(progress * 100)}%
          </div>
        </div>
      )}

      {result && !running && <Recap r={result} />}
    </div>
  );
}

function Row({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "3px 0", borderTop: "1px solid rgba(255,255,255,0.04)" }}>
      <span style={{ fontSize: 11.5, color: C.text2 }}>{label}</span>
      <span style={{ fontSize: 12.5, fontWeight: 700, fontVariantNumeric: "tabular-nums", color: warn ? "#E0913B" : C.text }}>{value}</span>
    </div>
  );
}

function Recap({ r }: { r: AuditResult }) {
  return (
    <div style={{ marginTop: 12 }}>
      <Row label="Mains jouées" value={r.hands.toLocaleString("fr-FR")} />
      <Row label="All-in préflop" value={pctStr(r.preflopAllInPct)} warn={r.preflopAllInPct > 25} />
      <Row label="VPIP / PFR" value={`${pctStr(r.vpip)} / ${pctStr(r.pfr)}`} />
      <Row label="Pot moyen" value={`${r.avgPotBb.toFixed(1)} bb`} />
      <Row label="Showdown" value={pctStr(r.showdownPct)} />

      <div style={{ fontSize: 10.5, color: C.text3, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.6, margin: "10px 0 4px" }}>
        Actions par street
      </div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11, fontVariantNumeric: "tabular-nums" }}>
          <thead>
            <tr style={{ color: C.text3 }}>
              <th style={{ textAlign: "left", fontWeight: 600, padding: "2px 4px" }} />
              {CATS.map((c) => (
                <th key={c} style={{ textAlign: "right", fontWeight: 600, padding: "2px 4px" }}>{c === "all-in" ? "AI" : c[0]!.toUpperCase()}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {STREETS.map((s) => {
              const d = r.byStreet[s];
              return (
                <tr key={s} style={{ color: C.text2 }}>
                  <td style={{ padding: "2px 4px", color: C.text }}>{s === "preflop" ? "PF" : s[0]!.toUpperCase() + s.slice(1)}</td>
                  {CATS.map((c) => (
                    <td key={c} style={{ textAlign: "right", padding: "2px 4px", color: d.total === 0 ? C.text3 : c === "all-in" && d.pct[c] > 50 ? "#E0913B" : C.text2 }}>
                      {d.total === 0 ? "·" : Math.round(d.pct[c])}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div style={{ fontSize: 10.5, color: C.text3, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.6, margin: "10px 0 4px" }}>
        bb/100 par siège
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {r.bb100.map((v, i) => (
          <span key={i} style={{ fontSize: 11, fontVariantNumeric: "tabular-nums", color: v >= 0 ? C.teal : "#E2533B", border: `1px solid ${C.border}`, borderRadius: 7, padding: "2px 7px" }}>
            S{i}: {v >= 0 ? "+" : ""}{v.toFixed(0)}
          </span>
        ))}
      </div>
    </div>
  );
}
