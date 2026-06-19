/**
 * Preflop range tables (6-max, 100bb) — DATA, not strategy logic.
 *
 * ⚠️  PLACEHOLDER APPROXIMATE VALUES. These are standard-chart approximations,
 *     NOT solver output. Do NOT present them as exact GTO. They exist so the bot
 *     can play a *table-driven* preflop instead of a pure heuristic; replace each
 *     table later with coach-validated ranges or a solver export (flip `source`
 *     to "solver" once that is done).
 *
 * Shape: each scenario (hero position + action context) maps the 169 starting
 * hands (pair "77", suited "AKs", offsuit "T9o") to an action distribution whose
 * frequencies sum to 1. Hands NOT listed default to fold:1 (out of range). The
 * lookup module reads these — it never invents a frequency or a size.
 *
 * Seed coverage: RFI (raise-first-in) for UTG/HJ/CO/BTN/SB, and BB defence vs a
 * single open. Everything else (limped pots, 3-bet pots, vs-open from non-BB, …)
 * is intentionally absent → the bot falls back to the labelled heuristic.
 */

export type RangeSource = "approx" | "solver";

/** Action distribution for one starting hand. Frequencies sum to 1. */
export interface RangeAction {
  fold: number;
  call: number;
  raise: number;
  /** Total "raise to" size in big blinds (only meaningful when raise > 0). */
  raiseTo?: number;
}

export interface PreflopRangeTable {
  /** Scenario key, e.g. "RFI:BTN", "BBvsOpen". */
  key: string;
  label: string;
  source: RangeSource;
  /** Default open/raise size in bb for this table (per-hand raiseTo can override). */
  raiseTo: number;
  /** 169-combo notation → distribution. Unlisted hands = fold. */
  combos: Record<string, RangeAction>;
}

/** Build pure-raise entries for an opening (RFI) range. */
function openRange(hands: string[], raiseTo: number): Record<string, RangeAction> {
  const out: Record<string, RangeAction> = {};
  for (const h of hands) out[h] = { fold: 0, call: 0, raise: 1, raiseTo };
  return out;
}

// ── RFI opening ranges (approx, pure raise) ─────────────────────────────────

const UTG = [
  "55", "66", "77", "88", "99", "TT", "JJ", "QQ", "KK", "AA",
  "A9s", "ATs", "AJs", "AQs", "AKs", "KTs", "KJs", "KQs", "QTs", "QJs", "JTs", "T9s", "98s",
  "AJo", "AQo", "AKo", "KQo",
];

const HJ = [
  ...UTG,
  "22", "33", "44",
  "A2s", "A3s", "A4s", "A5s", "A8s", "K9s", "Q9s", "J9s", "T8s", "87s",
  "ATo", "KJo", "QJo",
];

const CO = [
  ...HJ,
  "A6s", "A7s", "K8s", "K7s", "Q8s", "J8s", "T7s", "97s", "76s", "65s", "54s",
  "A9o", "A8o", "KTo", "QTo", "JTo",
];

const BTN = [
  ...CO,
  "K2s", "K3s", "K4s", "K5s", "K6s", "Q5s", "Q6s", "Q7s", "J6s", "J7s",
  "T6s", "96s", "86s", "85s", "75s", "64s", "53s", "43s",
  "A2o", "A3o", "A4o", "A5o", "A6o", "A7o", "K8o", "K9o", "Q9o", "J9o", "T9o", "98o",
];

// SB opens bigger (3bb) — vs only the BB. Approx ~ a touch wider than CO.
const SB = [
  ...CO,
  "K3s", "K4s", "K5s", "K6s", "Q7s", "J7s", "T6s", "96s", "86s", "75s", "64s",
  "A2o", "A3o", "A4o", "A5o", "A6o", "A7o", "K9o", "QJo", "J9o", "T9o",
];

// ── BB defence vs a single open (~2.5bb). Mixed: 3-bet / call / fold. ────────
// Value/bluff 3-bets, a wide flat range (good odds closing the action), the rest
// folds. A couple of explicitly MIXED hands exercise the mixed-frequency path.
const BB_3BET = ["AA", "KK", "QQ", "JJ", "AKs", "AKo", "AQs", "A5s"];
const BB_CALL = [
  "22", "33", "44", "55", "66", "77", "88", "99", "TT",
  "A2s", "A3s", "A4s", "A6s", "A7s", "A8s", "A9s", "ATs", "AJs",
  "K9s", "KTs", "KJs", "KQs", "Q9s", "QTs", "QJs", "J9s", "JTs", "T9s", "98s", "87s", "76s", "65s", "54s",
  "ATo", "AJo", "AQo", "KQo", "KJo", "QJo", "JTo",
];
const BB_MIXED: Record<string, RangeAction> = {
  // demonstrate mixed strategies (frequencies still sum to 1)
  A4s: { fold: 0, call: 0.5, raise: 0.5, raiseTo: 11 }, // mixed 3-bet bluff
  KTo: { fold: 0.4, call: 0.6, raise: 0 },
  T8s: { fold: 0.3, call: 0.7, raise: 0 },
};

function bbDefence(): Record<string, RangeAction> {
  const out: Record<string, RangeAction> = {};
  for (const h of BB_CALL) out[h] = { fold: 0, call: 1, raise: 0 };
  for (const h of BB_3BET) out[h] = { fold: 0, call: 0, raise: 1, raiseTo: 11 };
  for (const [h, a] of Object.entries(BB_MIXED)) out[h] = a;
  return out;
}

export const PREFLOP_RANGES: Record<string, PreflopRangeTable> = {
  "RFI:UTG": { key: "RFI:UTG", label: "UTG open (RFI)", source: "approx", raiseTo: 2.5, combos: openRange(UTG, 2.5) },
  "RFI:HJ": { key: "RFI:HJ", label: "HJ open (RFI)", source: "approx", raiseTo: 2.5, combos: openRange(HJ, 2.5) },
  "RFI:CO": { key: "RFI:CO", label: "CO open (RFI)", source: "approx", raiseTo: 2.5, combos: openRange(CO, 2.5) },
  "RFI:BTN": { key: "RFI:BTN", label: "BTN open (RFI)", source: "approx", raiseTo: 2.5, combos: openRange(BTN, 2.5) },
  "RFI:SB": { key: "RFI:SB", label: "SB open (RFI)", source: "approx", raiseTo: 3, combos: openRange(SB, 3) },
  BBvsOpen: { key: "BBvsOpen", label: "BB defence vs single open", source: "approx", raiseTo: 11, combos: bbDefence() },
};
