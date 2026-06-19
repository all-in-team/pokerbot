/**
 * Preflop range lookup — maps the current preflop spot to a table-driven action
 * distribution. Pure & isomorphic (engine + data only; runs client and server).
 *
 * It NEVER invents a strategy: it returns whatever the range table holds for the
 * scenario+hand, or null when no seeded table covers the spot (the caller then
 * falls back to the heuristic). Sampling an action from a distribution is done
 * here too, deterministically from a caller-supplied roll in [0,1).
 */

import { rankOf, suitOf, rankValue, type Card } from "@/engine/cards.js";
import { PREFLOP_RANGES, type RangeAction, type RangeSource } from "@/data/preflop-ranges.js";
import type { DecisionView } from "@/bots/types.js";

/** Two hole cards → 169-combo notation: "AKs" / "T9o" / "77". Order-independent. */
export function comboKey(hole: Card[]): string {
  const a = hole[0]!;
  const b = hole[1]!;
  const ra = rankOf(a);
  const rb = rankOf(b);
  if (rankValue(a) === rankValue(b)) return `${ra}${rb}`;
  const [hi, lo] = rankValue(a) > rankValue(b) ? [ra, rb] : [rb, ra];
  return `${hi}${lo}${suitOf(a) === suitOf(b) ? "s" : "o"}`;
}

/**
 * Identify the seeded scenario for the hero's current preflop spot, or null if
 * uncovered. Seed coverage: RFI (nobody has voluntarily entered yet) for
 * UTG/HJ/CO/BTN/SB, and BB facing exactly one open. Restricted to 6-max — the
 * seed ranges are 6-max-specific; other table sizes use the heuristic.
 */
export function preflopScenarioKey(view: DecisionView): string | null {
  if (view.street !== "preflop") return null;
  if ((view.numPlayers ?? 2) !== 6) return null;
  const pos = view.tablePosition;
  if (!pos) return null;

  const pre = view.actionHistory.filter((a) => a.street === "preflop");
  const voluntary = pre.filter((a) => a.type === "call" || a.type === "bet" || a.type === "raise");
  const raises = pre.filter((a) => a.type === "raise" || a.type === "bet");

  if (voluntary.length === 0) {
    // Raise-first-in: everyone before the hero folded. (BB never RFIs.)
    return pos === "BB" ? null : `RFI:${pos}`;
  }
  if (pos === "BB" && voluntary.length === 1 && raises.length === 1) {
    // BB faces a single open with no callers/3-bets in between.
    return "BBvsOpen";
  }
  return null; // 3-bet pots, limped pots, vs-open from non-BB, … → heuristic
}

export interface PreflopLookupResult {
  dist: RangeAction;
  source: RangeSource;
  scenario: string;
  combo: string;
}

/** Table-driven distribution for the hero's preflop spot, or null to fall back. */
export function lookupPreflop(view: DecisionView): PreflopLookupResult | null {
  const scenario = preflopScenarioKey(view);
  if (!scenario) return null;
  const table = PREFLOP_RANGES[scenario];
  if (!table) return null;
  const combo = comboKey(view.holeCards);
  // A covered scenario decides every hand: unlisted = out of range = fold.
  const dist = table.combos[combo] ?? { fold: 1, call: 0, raise: 0 };
  return { dist, source: table.source, scenario, combo };
}

export type SampledAction = "fold" | "call" | "raise";

/** Pick an action from a distribution given a roll in [0,1). Deterministic. */
export function sampleAction(dist: RangeAction, roll: number): SampledAction {
  if (roll < dist.fold) return "fold";
  if (roll < dist.fold + dist.call) return "call";
  return "raise";
}
