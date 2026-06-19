"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import SpotTrainerTable from "@/components/SpotTrainerTable.js";
import { listSpots, isSolutionPlaceholder, type Action } from "@/lib/spots.js";
import { listProfiles, isProfilePlaceholder } from "@/lib/profiles.js";
import type { Verdict } from "@/lib/score.js";

/** What the table reports back when the student commits an action. */
interface Attempt {
  spotId: string;
  action: Action;
  sizing?: number;
  /** null when the spot's solution is still a placeholder (not graded). */
  verdict: Verdict | null;
  evLoss: number | null;
}

export default function TrainerPage() {
  const spots = useMemo(() => listSpots(), []);
  const profiles = useMemo(() => listProfiles(), []);

  // Filtre par profil adverse. "all" = tous les spots (GTO + exploit) ; un id de
  // profil = uniquement les spots exploit best-response contre ce profil.
  const [profileId, setProfileId] = useState("all");
  const filteredSpots = useMemo(
    () =>
      profileId === "all"
        ? spots
        : spots.filter(
            (s) => s.solution.mode === "exploit" && s.solution.vsProfile === profileId,
          ),
    [spots, profileId],
  );

  const [spotId, setSpotId] = useState(spots[0]?.id ?? "");

  // Garde le spot sélectionné cohérent avec le filtre de profil courant.
  useEffect(() => {
    if (!filteredSpots.some((s) => s.id === spotId)) {
      setSpotId(filteredSpots[0]?.id ?? "");
    }
  }, [filteredSpots, spotId]);

  const spot = filteredSpots.find((s) => s.id === spotId) ?? filteredSpots[0];

  // Persist the attempt. The /api/attempts route is a stub that logs for now;
  // it'll be wired to Supabase later. `verdict`/`evLoss` were graded against the
  // STORED solution inside the table — the server never re-derives GTO truth.
  async function recordAttempt(attempt: Attempt) {
    try {
      await fetch("/api/attempts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(attempt),
      });
    } catch (err) {
      console.error("attempt POST failed", err);
    }
  }

  const selectStyle = {
    appearance: "none" as const,
    padding: "10px 12px",
    borderRadius: 10,
    background: "rgba(255,255,255,0.06)",
    border: "1px solid rgba(255,255,255,0.12)",
    color: "#e5e7eb",
    fontSize: 14,
  };

  return (
    <main
      style={{
        minHeight: "100vh",
        background: "#050608",
        color: "#e5e7eb",
        fontFamily: "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
      }}
    >
      <header
        style={{
          maxWidth: 600,
          margin: "0 auto",
          padding: "16px clamp(10px,3vw,18px) 0",
          display: "flex",
          flexDirection: "column",
          gap: 10,
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h1 style={{ fontSize: 18, fontWeight: 800, margin: 0 }}>Spot Trainer</h1>
          <Link href="/" style={{ color: "#7dd3fc", fontSize: 13 }}>
            ← retour
          </Link>
        </div>

        <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13 }}>
          <span style={{ color: "#94a3b8" }}>Adversaire</span>
          <select
            value={profileId}
            onChange={(e) => setProfileId(e.target.value)}
            style={selectStyle}
          >
            <option value="all" style={{ background: "#0b0d13" }}>
              Tous les spots (GTO + exploit)
            </option>
            {profiles.map((p) => (
              <option key={p.id} value={p.id} style={{ background: "#0b0d13" }}>
                Exploit vs {p.name}
                {isProfilePlaceholder(p) ? " — profil à importer" : ""}
              </option>
            ))}
          </select>
        </label>

        <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13 }}>
          <span style={{ color: "#94a3b8" }}>Spot</span>
          <select value={spotId} onChange={(e) => setSpotId(e.target.value)} style={selectStyle}>
            {filteredSpots.map((s) => (
              <option key={s.id} value={s.id} style={{ background: "#0b0d13" }}>
                {s.axis}
                {isSolutionPlaceholder(s) ? " — solution à importer" : ""}
              </option>
            ))}
          </select>
        </label>
      </header>

      {/* key={spot.id} resets the table's local action state when the spot changes */}
      {spot ? (
        <SpotTrainerTable key={spot.id} spot={spot} onAttempt={recordAttempt} />
      ) : (
        <p
          style={{
            maxWidth: 600,
            margin: "24px auto",
            padding: "0 clamp(10px,3vw,18px)",
            color: "#94a3b8",
            fontSize: 14,
          }}
        >
          Aucun spot pour ce profil. Choisis « Tous les spots » ou importe des spots
          exploit dans <code>src/data/spots.json</code>.
        </p>
      )}
    </main>
  );
}
