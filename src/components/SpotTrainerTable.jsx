import React, { useMemo, useState } from "react";

/**
 * PokerTable — composant de TABLE pour un Spot Trainer (outil d'ÉTUDE).
 *
 * L'élève voit un spot, choisit une action, PUIS reçoit un feedback.
 * Ce composant n'invente JAMAIS de verdict GTO ni de fréquences : quand
 * l'élève agit, on affiche seulement son action + une note rappelant que la
 * vérité GTO vient de la couche solver (en aval).
 *
 * 100 % data-driven : remplace simplement l'objet `spot` (props `spot`) par un
 * spot issu de ta librairie solver. Aucune prop n'est obligatoire.
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

// ───────────────────────── SPOT PAR DÉFAUT ─────────────────────────
// Défense BB face au c-bet du BTN. $1/$2 ante $2, 6-max — notation 1/2(2).
// Préflop : BTN open 5, SB fold, BB call → pot 23. Flop Qs7d2c.
// BTN c-bet 8 → pot 31, à payer 8. Héros = 8h 8d.
const DEFAULT_SPOT = {
  stakes: { sb: 1, bb: 2, ante: 2, seats: 6 },
  players: [
    { id: "sb", pos: "SB", name: "Sara", stack: 197, folded: true },
    { id: "bb", pos: "BB", name: "Toi", stack: 193, hero: true, folded: false },
    { id: "utg", pos: "UTG", name: "Max", stack: 198, folded: true },
    { id: "hj", pos: "HJ", name: "Joy", stack: 198, folded: true },
    { id: "co", pos: "CO", name: "Léo", stack: 198, folded: true },
    // BTN a misé son c-bet de 8 (déjà déduit du stack : 200-2-5-8 = 185).
    { id: "btn", pos: "BTN", name: "Ivan", stack: 185, folded: false, bet: 8 },
  ],
  board: [
    { r: "Q", s: "s" },
    { r: "7", s: "d" },
    { r: "2", s: "c" },
  ],
  heroCards: [
    { r: "8", s: "h" },
    { r: "8", s: "d" },
  ],
  pot: 31, // 23 (au flop) + 8 (c-bet)
  toCall: 8, // c-bet à payer
  heroStack: 193,
  minRaise: 16, // mise 8 → relance min à 16
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
function Seat({ player, isHeroTurn, heroCards }) {
  const { x, y } = SEAT_XY[player.pos];
  const folded = player.folded;
  const isHero = !!player.hero;
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
      <Chip amount={2} tone="#1e293b" label="ante 2" />
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

export default function PokerTable({ spot = DEFAULT_SPOT }) {
  const { stakes, players, board, heroCards, pot, toCall, heroStack, minRaise } = spot;

  const villainBet = useMemo(
    () => Math.max(0, ...players.filter((p) => !p.hero).map((p) => p.bet || 0)),
    [players]
  );

  // Compta du pot EXACTE : 6 antes + SB + BB = 15 préflop.
  const preflopPot = stakes.seats * stakes.ante + stakes.sb + stakes.bb;

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
  const [committed, setCommitted] = useState(null); // { kind, amount }

  const heroTurn = committed === null;

  const commit = (kind, amount) => setCommitted({ kind, amount });
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

      {/* En-tête : structure de jeu */}
      <div
        style={{
          display: "flex",
          justifyContent: "center",
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
          {`$${stakes.sb} / $${stakes.bb} · ante $${stakes.ante} · ${stakes.seats}-max`}
        </div>
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

        {/* board central : 3 cartes + 2 fantômes */}
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
            préflop {preflopPot} → flop {pot - villainBet} → +c-bet {villainBet}
          </div>
        </div>

        {/* sièges */}
        {players.map((p) => (
          <Seat key={p.id} player={p} isHeroTurn={heroTurn} heroCards={heroCards} />
        ))}

        {/* bouton dealer "D" à côté du BTN */}
        <TowardCenter pos="BTN" factor={0.16}>
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

        {/* chip de mise du c-bet devant le BTN */}
        {villainBet > 0 && (
          <TowardCenter pos="BTN" factor={0.38}>
            <Chip amount={villainBet} tone="#b45309" label={`mise ${villainBet}`} />
          </TowardCenter>
        )}
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
          // ── FEEDBACK NEUTRE : aucun verdict GTO inventé ──
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
            <p
              style={{
                margin: "0 auto 14px",
                maxWidth: 380,
                fontSize: "clamp(11px,3vw,13px)",
                color: "#94a3b8",
                lineHeight: 1.5,
              }}
            >
              Action enregistrée. Le feedback (verdict, fréquences, EV) viendra de
              la couche solver — ce trainer n'évalue pas le coup lui-même.
            </p>
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
