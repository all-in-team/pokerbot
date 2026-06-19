import React, { useMemo, useState } from "react";
import { scoreAttempt, VERDICT_META } from "@/lib/score.js";
import { getProfile, isProfilePlaceholder } from "@/lib/profiles.js";

/**
 * SpotTrainerTable — composant de TABLE pour un Spot Trainer (outil d'ÉTUDE).
 *
 * 100 % data-driven : tout l'affichage est dérivé de la prop `spot` (type `Spot`
 * de src/lib/spots.ts). Le composant ne contient AUCUNE coordonnée de table dans
 * les données — il garde un mapping interne pos → siège (SEAT_XY).
 *
 * Le feedback (verdict, fréquences, EV) est TIRÉ de `spot.solution`, c.-à-d. la
 * vérité solver stockée. Ce composant ne calcule JAMAIS la GTO : il compare
 * l'action de l'élève à `spot.solution.bestAction` et affiche les nombres tels
 * quels. Si la solution n'est pas encore importée (placeholder), il le dit au
 * lieu d'afficher des « 0 % » comme s'ils étaient vrais.
 *
 * React + styles inline (positionnement absolu des sièges), zéro dépendance
 * externe, pas de localStorage.
 */

// ─────────────────────────── DECK 4 COULEURS ───────────────────────────
const SUITS = {
  s: { glyph: "♠", color: "#0f0f14", label: "pique" }, // NOIR
  h: { glyph: "♥", color: "#e02544", label: "cœur" }, // ROUGE
  d: { glyph: "♦", color: "#1f78ff", label: "carreau" }, // BLEU
  c: { glyph: "♣", color: "#15a05a", label: "trèfle" }, // VERT
};

// Couleurs des badges de position
const POS_COLOR = { BTN: "#f59e0b", SB: "#3b82f6", BB: "#22c55e" };
const posColor = (p) => POS_COLOR[p] || "#64748b";

// Placement des 6 sièges autour de l'ovale (en % du conteneur).
// Sens horaire : SB, BB(héros), UTG, HJ, CO, BTN. Héros (BB) en bas au centre.
const SEAT_XY = {
  BB: { x: 50, y: 89 }, // héros — bas centre
  UTG: { x: 11, y: 62 },
  HJ: { x: 15, y: 22 },
  CO: { x: 50, y: 11 },
  BTN: { x: 85, y: 22 },
  SB: { x: 89, y: 62 },
};

const ACTION_LABEL = { fold: "Fold", call: "Call", raise: "Raise" };

/** "8h" → { r: "8", s: "h" } ; "Ts" → { r: "T", s: "s" }. */
const parseCard = (str) => ({ r: str.slice(0, -1), s: str.slice(-1) });

// ───────────────────────── SPOT PAR DÉFAUT ─────────────────────────
// Défense BB face au c-bet du BTN. $1/$2 ante $2, 6-max — notation 1/2(2).
// Préflop : BTN open 5, SB fold, BB call → pot 23. Flop Qs7d2c.
// BTN c-bet 8 → pot 31, à payer 8. Héros = 8h 8d.
// Miroir du premier spot de src/data/spots.json — solution PLACEHOLDER.
const DEFAULT_SPOT = {
  id: "bb-defense-qs7d2c",
  axis: "BB defense vs c-bet",
  stakes: { sb: 1, bb: 2, ante: 2 },
  heroId: "bb",
  players: [
    { id: "sb", name: "Sara", pos: "SB", stack: 197, folded: true },
    { id: "bb", name: "Toi", pos: "BB", stack: 193 },
    { id: "utg", name: "Max", pos: "UTG", stack: 198, folded: true },
    { id: "hj", name: "Joy", pos: "HJ", stack: 198, folded: true },
    { id: "co", name: "Léo", pos: "CO", stack: 198, folded: true },
    { id: "btn", name: "Ivan", pos: "BTN", stack: 185, dealer: true, bet: 8 },
  ],
  board: ["Qs", "7d", "2c"],
  heroCards: ["8h", "8d"],
  pot: 31,
  toCall: 8,
  minRaise: 16,
  solution: {
    mode: "gto",
    bestAction: "call",
    actions: [
      { action: "fold", frequency: 0, ev: 0 },
      { action: "call", frequency: 0, ev: 0 },
      { action: "raise", sizing: 16, frequency: 0, ev: 0 },
    ],
    source: "PLACEHOLDER — TODO import PioSOLVER/GTO Wizard export",
  },
};

// ─────────────────────────── PRIMITIVES UI ───────────────────────────

/** Carte de jeu — grosse, blanche, très contrastée. Tailles en clamp(). */
function Card({ card, variant = "board", faceDown = false, ghost = false }) {
  const dims = {
    board: { w: "clamp(40px, 11.5vw, 62px)", r: "clamp(20px,5.6vw,30px)", c: "clamp(26px,7.6vw,40px)" },
    hero: { w: "clamp(56px, 16vw, 92px)", r: "clamp(26px,7.4vw,42px)", c: "clamp(36px,10.4vw,58px)" },
    mini: { w: "clamp(26px, 7vw, 38px)", r: 0, c: 0 }, // dos adversaire
  }[variant];

  const base = {
    width: dims.w,
    aspectRatio: "5 / 7",
    borderRadius: "clamp(5px,1.4vw,9px)",
    flex: "0 0 auto",
    boxSizing: "border-box",
  };

  if (ghost) {
    return (
      <div
        aria-hidden="true"
        style={{
          ...base,
          border: "2px dashed rgba(255,255,255,0.22)",
          background: "rgba(255,255,255,0.03)",
        }}
      />
    );
  }

  if (faceDown) {
    return (
      <div
        aria-hidden="true"
        style={{
          ...base,
          border: "1px solid rgba(255,255,255,0.18)",
          background:
            "repeating-linear-gradient(45deg, #1e3a8a 0 6px, #1d4ed8 6px 12px)",
          boxShadow: "0 2px 6px rgba(0,0,0,0.5)",
        }}
      />
    );
  }

  const suit = SUITS[card.s];
  return (
    <div
      role="img"
      aria-label={`${card.r} de ${suit.label}`}
      style={{
        ...base,
        position: "relative",
        background: "#ffffff",
        border: "1px solid rgba(0,0,0,0.25)",
        boxShadow: "0 3px 9px rgba(0,0,0,0.55)",
        color: suit.color,
        fontWeight: 800,
        lineHeight: 1,
        userSelect: "none",
      }}
    >
      {/* coin haut-gauche : rang + petit symbole */}
      <div
        style={{
          position: "absolute",
          top: "6%",
          left: "8%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          fontSize: dims.r,
        }}
      >
        <span>{card.r}</span>
        <span style={{ fontSize: "0.78em", marginTop: "-0.06em" }}>{suit.glyph}</span>
      </div>
      {/* gros symbole central */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "grid",
          placeItems: "center",
          fontSize: dims.c,
          opacity: 0.96,
        }}
      >
        {suit.glyph}
      </div>
    </div>
  );
}

/** Petit jeton (ante / mise). */
function Chip({ amount, tone = "#334155", label }) {
  return (
    <div
      title={label}
      style={{
        minWidth: "clamp(20px,5.5vw,26px)",
        height: "clamp(20px,5.5vw,26px)",
        padding: "0 6px",
        borderRadius: 999,
        background: tone,
        border: "2px dashed rgba(255,255,255,0.55)",
        color: "#fff",
        fontSize: "clamp(10px,3vw,12px)",
        fontWeight: 800,
        display: "grid",
        placeItems: "center",
        boxShadow: "0 2px 5px rgba(0,0,0,0.5)",
      }}
    >
      {amount}
    </div>
  );
}

/** Un siège positionné en absolu autour de l'ovale. */
function Seat({ player, isHero, isHeroTurn, heroCards, ante }) {
  const { x, y } = SEAT_XY[player.pos];
  const folded = player.folded;
  const highlight = isHero && isHeroTurn;

  return (
    <div
      style={{
        position: "absolute",
        left: `${x}%`,
        top: `${y}%`,
        transform: "translate(-50%, -50%)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 4,
        opacity: folded ? 0.4 : 1,
        filter: folded ? "grayscale(1)" : "none",
        transition: "opacity .2s ease, filter .2s ease",
        zIndex: isHero ? 5 : 3,
        width: "max-content",
      }}
    >
      {/* Cartes au-dessus du siège */}
      {!folded && (
        <div
          style={{
            display: "flex",
            gap: isHero ? "clamp(2px,1vw,6px)" : 3,
            marginBottom: 2,
          }}
        >
          {isHero ? (
            <>
              {/* héros : cartes visibles, agrandies, légèrement relevées/inclinées */}
              <div style={{ transform: "rotate(-7deg) translateY(4px)" }}>
                <Card card={heroCards[0]} variant="hero" />
              </div>
              <div style={{ transform: "rotate(7deg) translateY(4px)" }}>
                <Card card={heroCards[1]} variant="hero" />
              </div>
            </>
          ) : (
            <>
              <Card variant="mini" faceDown />
              <Card variant="mini" faceDown />
            </>
          )}
        </div>
      )}

      {/* Pastille du siège */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 7,
          padding: "5px 9px 5px 5px",
          borderRadius: 999,
          background: highlight ? "rgba(245,158,11,0.18)" : "rgba(10,12,18,0.82)",
          border: highlight
            ? "2px solid #f59e0b"
            : "1px solid rgba(255,255,255,0.12)",
          boxShadow: highlight
            ? "0 0 0 4px rgba(245,158,11,0.22), 0 4px 12px rgba(0,0,0,0.5)"
            : "0 4px 12px rgba(0,0,0,0.45)",
          transition: "box-shadow .2s ease, border-color .2s ease, background .2s ease",
        }}
      >
        {/* avatar */}
        <div
          style={{
            width: "clamp(26px,7vw,34px)",
            height: "clamp(26px,7vw,34px)",
            borderRadius: "50%",
            background: `linear-gradient(135deg, ${posColor(player.pos)}, #0b0d12)`,
            color: "#fff",
            display: "grid",
            placeItems: "center",
            fontWeight: 800,
            fontSize: "clamp(12px,3.4vw,15px)",
            flex: "0 0 auto",
          }}
        >
          {player.name[0]}
        </div>
        <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.15 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 5,
              fontSize: "clamp(11px,3vw,13px)",
              color: "#e5e7eb",
              fontWeight: 700,
            }}
          >
            <span>{player.name}</span>
            <span
              style={{
                fontSize: "clamp(8px,2.4vw,10px)",
                fontWeight: 800,
                letterSpacing: 0.4,
                padding: "1px 5px",
                borderRadius: 5,
                color: "#0b0d12",
                background: posColor(player.pos),
              }}
            >
              {player.pos}
            </span>
          </div>
          <span style={{ fontSize: "clamp(10px,2.8vw,12px)", color: "#9ca3af" }}>
            {folded ? "couché" : `${player.stack} `}
            {!folded && <span style={{ color: "#64748b" }}>bb·$</span>}
          </span>
        </div>
      </div>

      {/* chip d'ante sous le siège — rend l'ante visible */}
      <Chip amount={ante} tone="#1e293b" label={`ante ${ante}`} />
    </div>
  );
}

/** Élément posé "vers le centre" relativement à un siège (mise, bouton D). */
function TowardCenter({ pos, factor = 0.26, children }) {
  const { x, y } = SEAT_XY[pos];
  const cx = x + (50 - x) * factor;
  const cy = y + (50 - y) * factor;
  return (
    <div
      style={{
        position: "absolute",
        left: `${cx}%`,
        top: `${cy}%`,
        transform: "translate(-50%, -50%)",
        zIndex: 4,
      }}
    >
      {children}
    </div>
  );
}

// ─────────────────────────── COMPOSANT PRINCIPAL ───────────────────────────

export default function SpotTrainerTable(props) {
  // Props loosely typed on purpose: this is a JS component consumed from TS with
  // a typed `Spot`. Defaulting inside the body keeps the exported component type
  // permissive (no DEFAULT_SPOT shape leaking into callers).
  const spot = props.spot ?? DEFAULT_SPOT;
  const onAttempt = props.onAttempt;
  const { stakes, players, heroId, pot, toCall, minRaise, solution } = spot;

  const seats = players.length;
  const board = useMemo(() => spot.board.map(parseCard), [spot.board]);
  const heroCards = useMemo(() => spot.heroCards.map(parseCard), [spot.heroCards]);

  const heroPlayer =
    players.find((p) => p.id === heroId) ?? players.find((p) => !p.folded) ?? players[0];
  const heroStack = heroPlayer?.stack ?? 0;
  const dealerPos = players.find((p) => p.dealer)?.pos ?? "BTN";

  const villainBet = useMemo(
    () => Math.max(0, ...players.filter((p) => p.id !== heroId).map((p) => p.bet || 0)),
    [players, heroId]
  );

  // Compta du pot EXACTE : antes (1 par siège) + SB + BB.
  const preflopPot = seats * stakes.ante + stakes.sb + stakes.bb;

  // Cote du pot : toCall / (pot + toCall).
  const needPct = ((toCall / (pot + toCall)) * 100).toFixed(1);

  // Relance "pot" : payer toCall puis miser la taille du pot résultant.
  const potRaiseTo = toCall + (pot + toCall);
  const clamp = (n) => Math.max(minRaise, Math.min(heroStack, Math.round(n)));
  const shortcuts = [
    { key: "min", label: "Min", to: clamp(minRaise) },
    { key: "x2_5", label: "2.5x", to: clamp(villainBet * 2.5) },
    { key: "x3", label: "3x", to: clamp(villainBet * 3) },
    { key: "pot", label: `Pot ${potRaiseTo}`, to: clamp(potRaiseTo) },
    { key: "allin", label: "All-in", to: heroStack },
  ];

  const [panel, setPanel] = useState("idle"); // idle | raise
  const [raiseTo, setRaiseTo] = useState(clamp(minRaise));
  const [committed, setCommitted] = useState(null); // { kind, amount, score }
  const [showProfile, setShowProfile] = useState(false);

  const heroTurn = committed === null;

  // Mode du spot + profil adverse (exploit). La GTO reste la référence ; la
  // vérité EV vient toujours de spot.solution (stocké), jamais d'un LLM.
  const exploit = solution.mode === "exploit";
  const profile = exploit && solution.vsProfile ? getProfile(solution.vsProfile) : undefined;

  // Placeholder si la solution OU (en exploit) le profil n'est pas encore importé.
  const solutionPlaceholder = !solution.source || solution.source.startsWith("PLACEHOLDER");
  const profilePlaceholder = exploit && (!profile || isProfilePlaceholder(profile));
  const placeholder = solutionPlaceholder || profilePlaceholder;
  const placeholderReason = solutionPlaceholder
    ? "Solution pas encore importée"
    : "Profil adverse pas encore importé";

  // Note l'action à partir de la VÉRITÉ STOCKÉE (spot.solution) — aucune GTO
  // calculée ici, scoreAttempt ne fait que lire fréquences/EV. Remonte la
  // tentative au parent (qui la persiste). Si la solution est un placeholder,
  // on enregistre quand même mais sans verdict ni evLoss.
  const commit = (kind, amount) => {
    const sizing = kind === "raise" ? amount : undefined;
    const score = placeholder ? null : scoreAttempt(solution, kind, sizing);
    setCommitted({ kind, amount, score });
    if (onAttempt) {
      onAttempt({
        spotId: spot.id,
        action: kind,
        sizing,
        verdict: score ? score.verdict : null,
        evLoss: score ? score.evLoss : null,
      });
    }
  };
  const reset = () => {
    setCommitted(null);
    setPanel("idle");
    setRaiseTo(clamp(minRaise));
  };

  return (
    <div
      className="spot-root"
      style={{
        maxWidth: 600,
        margin: "0 auto",
        padding: "clamp(10px,3vw,18px)",
        background: "radial-gradient(120% 120% at 50% 0%, #0b0d13 0%, #050608 70%)",
        minHeight: "100%",
        color: "#e5e7eb",
        fontFamily:
          "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
        boxSizing: "border-box",
      }}
    >
      {/* styles pour focus clavier visible + prefers-reduced-motion (impossibles en inline) */}
      <style>{`
        .spot-root *:focus-visible{ outline:3px solid #ffd479; outline-offset:2px; border-radius:8px; }
        @media (prefers-reduced-motion: reduce){
          .spot-root *{ transition:none !important; animation:none !important; }
        }
      `}</style>

      {/* En-tête : structure de jeu + axe du spot */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 6,
          marginBottom: "clamp(8px,2.5vw,14px)",
        }}
      >
        <div
          style={{
            padding: "6px 14px",
            borderRadius: 999,
            background: "rgba(255,255,255,0.06)",
            border: "1px solid rgba(255,255,255,0.12)",
            fontSize: "clamp(11px,3vw,13px)",
            fontWeight: 700,
            letterSpacing: 0.3,
          }}
        >
          {`$${stakes.sb} / $${stakes.bb} · ante $${stakes.ante} · ${seats}-max`}
        </div>
        <div style={{ fontSize: "clamp(11px,3vw,13px)", color: "#94a3b8" }}>{spot.axis}</div>

        {/* Badge de mode : GTO (référence) ou EXPLOIT vs profil (best-response stockée) */}
        <button
          type="button"
          onClick={() => exploit && setShowProfile((v) => !v)}
          title={exploit ? profile?.description : "Solution d'équilibre (référence)"}
          style={{
            appearance: "none",
            cursor: exploit ? "pointer" : "default",
            padding: "3px 10px",
            borderRadius: 999,
            fontSize: "clamp(10px,2.6vw,12px)",
            fontWeight: 800,
            letterSpacing: 0.4,
            color: exploit ? "#a78bfa" : "#22c55e",
            background: exploit ? "rgba(167,139,250,0.14)" : "rgba(34,197,94,0.14)",
            border: `1px solid ${exploit ? "#a78bfa" : "#22c55e"}`,
          }}
        >
          {exploit ? `EXPLOIT vs ${profile?.name ?? solution.vsProfile ?? "?"}` : "GTO"}
        </button>

        {exploit && showProfile && profile && (
          <p
            style={{
              margin: 0,
              maxWidth: 420,
              textAlign: "center",
              fontSize: "clamp(10px,2.8vw,12px)",
              color: "#cbd5e1",
              lineHeight: 1.45,
            }}
          >
            {profile.description}
          </p>
        )}
      </div>

      {/* ── TABLE ── */}
      <div
        style={{
          position: "relative",
          width: "100%",
          aspectRatio: "1.42 / 1",
          margin: "0 auto",
        }}
      >
        {/* rail + feutre */}
        <div
          style={{
            position: "absolute",
            inset: "8%",
            borderRadius: "50% / 50%",
            background: "linear-gradient(#1a1d24, #0c0e13)",
            padding: "clamp(8px,2.4vw,16px)",
            boxShadow: "0 18px 40px rgba(0,0,0,0.7)",
          }}
        >
          <div
            style={{
              position: "absolute",
              inset: "clamp(8px,2.4vw,16px)",
              borderRadius: "50% / 50%",
              background:
                "radial-gradient(120% 120% at 50% 38%, #1f7a6e 0%, #145e55 48%, #0c413b 100%)",
              border: "2px solid rgba(0,0,0,0.4)",
              boxShadow: "inset 0 8px 30px rgba(0,0,0,0.45)",
            }}
          />
        </div>

        {/* board central : cartes + fantômes jusqu'à 5 */}
        <div
          style={{
            position: "absolute",
            left: "50%",
            top: "41%",
            transform: "translate(-50%, -50%)",
            display: "flex",
            gap: "clamp(4px,1.6vw,8px)",
            zIndex: 2,
          }}
        >
          {[0, 1, 2, 3, 4].map((i) =>
            board[i] ? (
              <Card key={i} card={board[i]} variant="board" />
            ) : (
              <Card key={i} variant="board" ghost />
            )
          )}
        </div>

        {/* pot + compta exacte */}
        <div
          style={{
            position: "absolute",
            left: "50%",
            top: "60%",
            transform: "translate(-50%, -50%)",
            textAlign: "center",
            zIndex: 2,
          }}
        >
          <div
            style={{
              padding: "5px 16px",
              borderRadius: 999,
              background: "rgba(0,0,0,0.55)",
              border: "1px solid rgba(255,255,255,0.15)",
              fontWeight: 800,
              fontSize: "clamp(13px,3.6vw,16px)",
            }}
          >
            POT {pot}
          </div>
          <div
            style={{
              marginTop: 4,
              fontSize: "clamp(9px,2.5vw,11px)",
              color: "#94a3b8",
            }}
          >
            antes+blinds {preflopPot}
            {villainBet > 0 ? ` → mise face à toi ${villainBet}` : ""}
          </div>
        </div>

        {/* sièges */}
        {players.map((p) => (
          <Seat
            key={p.id}
            player={p}
            isHero={p.id === heroId}
            isHeroTurn={heroTurn}
            heroCards={heroCards}
            ante={stakes.ante}
          />
        ))}

        {/* bouton dealer "D" à côté du siège dealer */}
        <TowardCenter pos={dealerPos} factor={0.16}>
          <div
            style={{
              width: "clamp(20px,5.6vw,26px)",
              height: "clamp(20px,5.6vw,26px)",
              borderRadius: "50%",
              background: "#f8fafc",
              color: "#0b0d12",
              fontWeight: 900,
              fontSize: "clamp(11px,3vw,14px)",
              display: "grid",
              placeItems: "center",
              boxShadow: "0 2px 6px rgba(0,0,0,0.6)",
            }}
          >
            D
          </div>
        </TowardCenter>

        {/* chip de mise (c-bet) devant les vilains qui ont misé */}
        {players
          .filter((p) => p.id !== heroId && (p.bet || 0) > 0)
          .map((p) => (
            <TowardCenter key={p.id} pos={p.pos} factor={0.38}>
              <Chip amount={p.bet} tone="#b45309" label={`mise ${p.bet}`} />
            </TowardCenter>
          ))}
      </div>

      {/* ── PANNEAU D'ACTION (bien séparé) ── */}
      <div
        style={{
          marginTop: "clamp(12px,3.5vw,22px)",
          padding: "clamp(12px,3.5vw,18px)",
          borderRadius: 16,
          background: "rgba(255,255,255,0.04)",
          border: "1px solid rgba(255,255,255,0.1)",
        }}
      >
        {/* Pot odds */}
        <div
          style={{
            textAlign: "center",
            fontSize: "clamp(12px,3.2vw,14px)",
            color: "#cbd5e1",
            marginBottom: "clamp(10px,3vw,14px)",
          }}
        >
          <strong style={{ color: "#fff" }}>{toCall}</strong> to win{" "}
          <strong style={{ color: "#fff" }}>{pot}</strong> — need{" "}
          <strong style={{ color: "#7dd3fc" }}>{needPct}%</strong>
        </div>

        {committed ? (
          // ── FEEDBACK : verdict + fréquences/EV TIRÉS de spot.solution ──
          <div style={{ textAlign: "center" }}>
            <div
              style={{
                fontSize: "clamp(15px,4.2vw,18px)",
                fontWeight: 800,
                marginBottom: 6,
              }}
            >
              Ton action :{" "}
              <span style={{ color: "#fbbf24" }}>
                {committed.kind === "fold" && "Fold"}
                {committed.kind === "call" && `Call ${committed.amount}`}
                {committed.kind === "raise" && `Raise to ${committed.amount}`}
              </span>
            </div>

            {placeholder ? (
              // Pas de vérité solver importée → on NE note pas (tentative quand même enregistrée).
              <p
                style={{
                  margin: "0 auto 12px",
                  maxWidth: 420,
                  fontSize: "clamp(11px,3vw,13px)",
                  color: "#94a3b8",
                  lineHeight: 1.5,
                }}
              >
                {placeholderReason} — pas de notation. Tentative enregistrée.
                <br />
                <span style={{ color: "#64748b" }}>
                  source : {(profilePlaceholder && !solutionPlaceholder
                    ? profile?.source
                    : solution.source) ?? "—"}
                </span>
              </p>
            ) : (
              <Feedback score={committed.score} solution={solution} profile={profile} />
            )}

            {/* TODO(LLM) : générer ICI l'EXPLICATION en langage naturel.
                Input : { spot, solution, action élève (committed), evLoss/verdict
                (committed.score) } → POST /api/explain → Claude.
                L'LLM EXPLIQUE seulement ; il ne recalcule RIEN : fréquences, EV,
                bestAction et le verdict viennent exclusivement de spot.solution. */}

            <button onClick={reset} style={btnStyle("#334155")}>
              <span style={{ fontWeight: 800 }}>Recommencer</span>
            </button>
          </div>
        ) : panel === "raise" ? (
          // ── RELANCE DÉPLIÉE ──
          <div>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "baseline",
                marginBottom: 8,
                fontSize: "clamp(12px,3.2vw,14px)",
              }}
            >
              <span style={{ color: "#94a3b8" }}>Relancer à</span>
              <strong style={{ fontSize: "clamp(18px,5vw,22px)", color: "#fbbf24" }}>
                {raiseTo}
              </strong>
            </div>

            <input
              type="range"
              min={minRaise}
              max={heroStack}
              step={1}
              value={raiseTo}
              onChange={(e) => setRaiseTo(Number(e.target.value))}
              aria-label="Montant de la relance"
              style={{ width: "100%", accentColor: "#f59e0b", margin: "4px 0 10px" }}
            />
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                fontSize: "clamp(9px,2.6vw,11px)",
                color: "#64748b",
                marginBottom: 12,
              }}
            >
              <span>min {minRaise}</span>
              <span>all-in {heroStack}</span>
            </div>

            {/* raccourcis */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(5, 1fr)",
                gap: 6,
                marginBottom: 14,
              }}
            >
              {shortcuts.map((s) => (
                <button
                  key={s.key}
                  onClick={() => setRaiseTo(s.to)}
                  style={{
                    ...btnStyle(raiseTo === s.to ? "#92400e" : "#1f2937"),
                    padding: "8px 2px",
                    fontSize: "clamp(10px,2.8vw,12px)",
                    border:
                      raiseTo === s.to
                        ? "1px solid #f59e0b"
                        : "1px solid rgba(255,255,255,0.1)",
                  }}
                >
                  {s.label}
                </button>
              ))}
            </div>

            <div style={{ display: "flex", gap: 8 }}>
              <button
                onClick={() => setPanel("idle")}
                style={{ ...btnStyle("#334155"), flex: "0 0 32%" }}
              >
                Retour
              </button>
              <button
                onClick={() => commit("raise", raiseTo)}
                style={{ ...btnStyle("#d97706"), flex: 1, fontWeight: 800 }}
              >
                Confirmer la relance
              </button>
            </div>
          </div>
        ) : (
          // ── BOUTONS PRINCIPAUX ──
          <div style={{ display: "flex", gap: "clamp(6px,2vw,10px)" }}>
            <ActionButton tone="#7f1d1d" label="Fold" sub="couche" onClick={() => commit("fold", 0)} />
            <ActionButton tone="#15803d" label="Call" sub={String(toCall)} onClick={() => commit("call", toCall)} />
            <ActionButton tone="#b45309" label="Raise" sub={`min ${minRaise}`} onClick={() => setPanel("raise")} />
          </div>
        )}
      </div>
    </div>
  );
}

const mutedNote = {
  margin: "0 auto 8px",
  maxWidth: 420,
  fontSize: "clamp(10px,2.8vw,12px)",
  color: "#94a3b8",
  lineHeight: 1.45,
};

/**
 * Décrit l'action recommandée d'un bloc { bestAction, actions } : libellé +
 * sizing s'il s'agit d'une relance. Lit uniquement les données stockées.
 */
function describeBest(block) {
  const candidates = block.actions.filter((a) => a.action === block.bestAction);
  const best = candidates.slice().sort((a, b) => b.frequency - a.frequency)[0];
  const size = best && best.sizing ? ` ${best.sizing}` : "";
  return `${ACTION_LABEL[block.bestAction]}${size}`;
}

/**
 * Bandeau verdict + tableau solution. TOUT est tiré de `score` (issu de
 * scoreAttempt) et de `solution.actions` (vérité solver stockée) — rien n'est
 * recalculé ici. En mode exploit avec baselineGto, on affiche la comparaison
 * GTO → exploit (moment pédagogique), elle aussi tirée des données stockées.
 */
function Feedback({ score, solution, profile }) {
  if (!score) return null;
  const meta = VERDICT_META[score.verdict];
  const showEvLoss = score.evLoss != null && score.evLoss > 0;

  return (
    <>
      {/* Bandeau verdict coloré */}
      <div
        style={{
          margin: "0 auto 8px",
          maxWidth: 420,
          padding: "8px 14px",
          borderRadius: 10,
          background: `${meta.color}22`,
          border: `1px solid ${meta.color}`,
          color: meta.color,
          fontWeight: 800,
          fontSize: "clamp(13px,3.6vw,15px)",
        }}
      >
        {meta.label}
        {showEvLoss && (
          <span style={{ fontWeight: 600 }}> · EV perdue {score.evLoss.toFixed(2)}</span>
        )}
      </div>

      {score.verdict === "out-of-tree" && (
        <p style={mutedNote}>Cette action n'existe pas dans l'arbre solver — non notée.</p>
      )}
      {score.sizingNote && <p style={mutedNote}>{score.sizingNote}</p>}

      {/* Tableau : action | sizing | fréquence (barre) | EV. Ligne choisie surlignée. */}
      <div style={{ maxWidth: 360, margin: "10px auto 12px", fontSize: "clamp(11px,3vw,13px)" }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "auto 1fr auto",
            gap: "2px 10px",
            color: "#64748b",
            marginBottom: 4,
            padding: "0 6px",
            textAlign: "left",
          }}
        >
          <span>Action</span>
          <span>Fréquence</span>
          <span style={{ textAlign: "right" }}>EV</span>
        </div>
        {solution.actions.map((a) => {
          const chosen = !!score.matched && a === score.matched;
          const pct = Math.round(a.frequency * 100);
          return (
            <div
              key={`${a.action}-${a.sizing ?? 0}`}
              style={{
                display: "grid",
                gridTemplateColumns: "auto 1fr auto",
                gap: "2px 10px",
                alignItems: "center",
                padding: "5px 6px",
                borderRadius: 8,
                background: chosen ? "rgba(251,191,36,0.14)" : "transparent",
                border: chosen ? "1px solid rgba(251,191,36,0.5)" : "1px solid transparent",
              }}
            >
              <span
                style={{
                  textAlign: "left",
                  whiteSpace: "nowrap",
                  color: chosen ? "#fbbf24" : "#e5e7eb",
                  fontWeight: chosen ? 800 : 600,
                }}
              >
                {ACTION_LABEL[a.action]}
                {a.sizing ? ` ${a.sizing}` : ""}
              </span>
              {/* barre de fréquence */}
              <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span
                  style={{
                    flex: 1,
                    height: 8,
                    borderRadius: 999,
                    background: "rgba(255,255,255,0.08)",
                    overflow: "hidden",
                  }}
                >
                  <span
                    style={{
                      display: "block",
                      height: "100%",
                      width: `${pct}%`,
                      background: chosen ? "#fbbf24" : "#38bdf8",
                      transition: "width .25s ease",
                    }}
                  />
                </span>
                <span style={{ minWidth: 34, textAlign: "right", color: "#cbd5e1" }}>{pct}%</span>
              </span>
              <span style={{ minWidth: 30, textAlign: "right", color: "#cbd5e1" }}>{a.ev}</span>
            </div>
          );
        })}
      </div>

      {/* Comparaison GTO → exploit (mode exploit + baseline stockée). Les deux
          recommandations viennent des données solver, rien n'est inventé. */}
      {solution.mode === "exploit" && solution.baselineGto && (
        <div
          style={{
            maxWidth: 360,
            margin: "0 auto 12px",
            padding: "8px 12px",
            borderRadius: 10,
            background: "rgba(167,139,250,0.10)",
            border: "1px solid rgba(167,139,250,0.4)",
            fontSize: "clamp(11px,3vw,13px)",
            color: "#cbd5e1",
            lineHeight: 1.5,
          }}
        >
          GTO : <strong style={{ color: "#22c55e" }}>{describeBest(solution.baselineGto)}</strong>
          {"  →  "}
          vs {profile?.name ?? "ce profil"}, exploit :{" "}
          <strong style={{ color: "#a78bfa" }}>
            {describeBest({ bestAction: solution.bestAction, actions: solution.actions })}
          </strong>
        </div>
      )}
    </>
  );
}

// Gros bouton color-codé avec montant sous le label.
function ActionButton({ tone, label, sub, onClick }) {
  return (
    <button onClick={onClick} style={{ ...btnStyle(tone), flex: 1, padding: "clamp(10px,3vw,16px) 4px" }}>
      <span style={{ display: "block", fontSize: "clamp(14px,4vw,17px)", fontWeight: 800 }}>{label}</span>
      <span style={{ display: "block", fontSize: "clamp(10px,2.8vw,12px)", opacity: 0.85, marginTop: 2 }}>
        {sub}
      </span>
    </button>
  );
}

function btnStyle(bg) {
  return {
    appearance: "none",
    border: "1px solid rgba(255,255,255,0.12)",
    borderRadius: 12,
    background: bg,
    color: "#fff",
    cursor: "pointer",
    minHeight: 48,
    padding: "10px 14px",
    fontSize: "clamp(13px,3.4vw,15px)",
    transition: "transform .08s ease, filter .15s ease",
    WebkitTapHighlightColor: "transparent",
  };
}
