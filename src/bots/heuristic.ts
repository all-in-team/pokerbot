/**
 * A self-contained heuristic bot — no API calls. It plays a believable,
 * personality-driven game so headless self-play produces realistic hand
 * histories and stress-tests the engine. It is intentionally simple; the strong
 * play comes later from the reasoning agents.
 *
 * Preflop hand strength uses the Chen formula (normalized 0..1). Postflop uses
 * the made-hand class from the evaluator. Personality knobs (tightness,
 * aggression, bluff frequency) shape thresholds and sizing.
 */

import { evaluate } from "../engine/evaluator.js";
import { rankValue, type Card } from "../engine/cards.js";
import { createRng, type Rng } from "../engine/rng.js";
import type { ActionInput } from "../engine/actions.js";
import { lookupPreflop, sampleAction, type PreflopLookupResult } from "../lib/preflop/preflopLookup.js";
import { clampToLegal, sizeToFromPotFraction } from "./util.js";
import { equityEvDecide } from "./equityEval.js";
import type { Bot, Decision, DecisionView, TablePosition } from "./types.js";

/** Default Monte Carlo iterations per postflop decision (overridable per bot). */
const DEFAULT_EQUITY_SAMPLES = 80;

/**
 * Positional looseness, 0 (earliest, tightest) … 1 (button, loosest). Heads-up
 * is disambiguated by player count: there the SB *is* the button (in position).
 */
function positionLooseness(pos: TablePosition, numPlayers: number): number {
  if (numPlayers === 2) return pos === "SB" ? 0.95 : 0.45; // HU: SB = button
  switch (pos) {
    case "UTG": return 0.0;
    case "HJ": return 0.3;
    case "CO": return 0.6;
    case "BTN": return 1.0;
    case "SB": return 0.25; // blind, out of position post-flop
    case "BB": return 0.4;
    default: return 0.4;
  }
}

export interface HeuristicConfig {
  name: string;
  style?: string;
  /** Starting-hand bar: higher = tighter (folds more preflop). 0..1. */
  tightness: number;
  /** How often and how big it bets/raises. 0..1. */
  aggression: number;
  /** Probability of firing a bluff in a spot with no value. 0..1. */
  bluffFreq: number;
  /** Seed for this bot's randomness (keeps self-play deterministic). */
  seed: string;
  /** Monte Carlo iterations per postflop equity/EV decision. Default 80. */
  equitySamples?: number;
}

/** Chen-formula starting-hand score, normalized to roughly 0..1. */
export function preflopStrength(hole: Card[]): number {
  const a = rankValue(hole[0]!);
  const b = rankValue(hole[1]!);
  const hi = Math.max(a, b);
  const lo = Math.min(a, b);
  const suited = hole[0]![1] === hole[1]![1];

  const highCardScore = (r: number): number => {
    if (r === 14) return 10; // Ace
    if (r === 13) return 8; // King
    if (r === 12) return 7; // Queen
    if (r === 11) return 6; // Jack
    return r / 2;
  };

  let score: number;
  if (a === b) {
    // Pair: twice the high-card score, minimum 5 (so 22 = 5, AA = 20).
    score = Math.max(5, highCardScore(hi) * 2);
  } else {
    score = highCardScore(hi);
    if (suited) score += 2;
    const gap = hi - lo - 1; // cards strictly between
    if (gap === 1) score -= 1;
    else if (gap === 2) score -= 2;
    else if (gap === 3) score -= 4;
    else if (gap >= 4) score -= 5;
    // Straight bonus for low connectors.
    if (gap <= 1 && hi < 12) score += 1;
  }
  return Math.max(0, Math.min(1, score / 20));
}

/** Made-hand strength from the evaluator's class rank, mapped to 0..1. */
function postflopStrength(hole: Card[], board: Card[]): number {
  const evald = evaluate([...hole, ...board]);
  // pokersolver rank: 1 high card … 9 straight flush. Map to a 0..1 scale.
  const byRank: Record<number, number> = {
    1: 0.18, // high card
    2: 0.42, // pair
    3: 0.62, // two pair
    4: 0.76, // trips
    5: 0.84, // straight
    6: 0.9, // flush
    7: 0.95, // full house
    8: 0.99, // quads
    9: 1.0, // straight flush
  };
  return byRank[evald.rank] ?? 0.2;
}

function strengthFor(view: DecisionView): number {
  return view.street === "preflop"
    ? preflopStrength(view.holeCards)
    : postflopStrength(view.holeCards, view.board);
}

export function createHeuristicBot(config: HeuristicConfig): Bot {
  const rng: Rng = createRng(config.seed);

  // Preflop, table-driven: sample the action from the range table's distribution
  // for this spot (frequencies + size come from the table, nothing invented).
  function decideFromRange(lk: PreflopLookupResult, view: DecisionView): Decision {
    const { dist, source, scenario, combo } = lk;
    const picked = sampleAction(dist, rng.next());
    const freq = picked === "fold" ? dist.fold : picked === "call" ? dist.call : dist.raise;
    const raiseTo = dist.raiseTo ?? 2.5;

    let intent: ActionInput;
    if (picked === "raise") intent = { type: view.legal.aggressiveType, to: Math.round(raiseTo * view.bigBlind) };
    else if (picked === "call") intent = { type: "call" };
    else intent = { type: "fold" };

    return {
      action: clampToLegal(intent, view.legal),
      confidence: freq, // straight from the table — not invented
      source,
      reasoning: `Range ${scenario} · ${combo}: ${picked}${picked === "raise" ? ` to ${raiseTo}bb` : ""} (${(freq * 100) | 0}%, ${source})`,
      // perceivedEquity intentionally omitted: the table carries no equity/EV.
    };
  }

  const equitySamples = config.equitySamples ?? DEFAULT_EQUITY_SAMPLES;

  function decide(view: DecisionView): Decision {
    // Preflop stays table-driven (range tables); uncovered preflop spots fall back
    // to the labelled heuristic.
    if (view.street === "preflop") {
      const lk = lookupPreflop(view);
      if (lk) return decideFromRange(lk, view);
      return heuristicDecide(view);
    }
    // Postflop: equity/EV policy vs the opponents' assumed continuation range.
    // The made-hand heuristic remains a safety fallback (still labelled "heuristic").
    try {
      return equityEvDecide(view, { aggression: config.aggression, bluffFreq: config.bluffFreq, samples: equitySamples }, rng);
    } catch {
      return heuristicDecide(view);
    }
  }

  // Postflop + uncovered-preflop fallback: the existing approx heuristic.
  function heuristicDecide(view: DecisionView): Decision {
    const { legal } = view;
    const strength = strengthFor(view);
    const aggr = config.aggression;
    const currentBet = view.myCommittedThisStreet + view.toCall;

    // --- Multiway / positional context (HU fallback when fields are absent). ---
    const numPlayers = view.numPlayers ?? 2;
    const activePlayers = view.activePlayers ?? 2;
    const tablePos: TablePosition = view.tablePosition ?? (view.position === "button" ? "SB" : "BB");
    const looseness = positionLooseness(tablePos, numPlayers);
    // Opponents still contesting the pot (hero excluded).
    const oppsInHand = Math.max(1, activePlayers - 1);
    // Each extra live opponent demands more strength: multiway pots favour made
    // hands, and bluffs must get through more players, so they shrink fast.
    const multiwayPenalty = (oppsInHand - 1) * 0.07;
    const bluffScale = 1 / oppsInHand;
    const canAggress = legal.canBet || legal.canRaise;

    let intent;
    let reasoning: string;

    if (view.toCall > 0) {
      // Facing a bet. Compare strength to pot odds, gated by position & field size.
      const potOdds = view.toCall / (view.pot + view.toCall);
      const valueBar = 0.82 + multiwayPenalty * 0.5;
      const callBar = potOdds + 0.06 + multiwayPenalty;
      // Preflop continuation: looser in late position, tighter multiway.
      const preflopPlayBar = 0.30 + config.tightness * 0.34 - looseness * 0.2 + multiwayPenalty;

      if (strength > valueBar && canAggress && rng.next() < 0.75) {
        const to = sizeToFromPotFraction(0.6 + aggr * 0.5, view.pot, view.myCommittedThisStreet, currentBet, legal);
        intent = { type: legal.aggressiveType, to } as const;
        reasoning = `Strong hand (${(strength * 100) | 0}%) vs ${oppsInHand}; raising for value.`;
      } else if (strength > valueBar) {
        intent = { type: "call" } as const;
        reasoning = `Very strong; flat-calling to keep bluffs in.`;
      } else if (
        (view.street !== "preflop" && strength > callBar) ||
        (view.street === "preflop" && strength > preflopPlayBar)
      ) {
        intent = { type: "call" } as const;
        reasoning = `Hand (${(strength * 100) | 0}%) good enough vs ${oppsInHand} (odds ${(potOdds * 100) | 0}%, ${tablePos}); calling.`;
      } else if (oppsInHand === 1 && rng.next() < config.bluffFreq * 0.5 * bluffScale && canAggress) {
        const to = sizeToFromPotFraction(0.7, view.pot, view.myCommittedThisStreet, currentBet, legal);
        intent = { type: legal.aggressiveType, to } as const;
        reasoning = `Heads-up in the hand — bluff-raising.`;
      } else {
        intent = { type: "fold" } as const;
        reasoning = `Too weak (${(strength * 100) | 0}%) vs ${oppsInHand} for the price; folding.`;
      }
    } else {
      // No bet to call: check or bet. Stronger bar & fewer stabs when multiway.
      const valueBar = 0.55 - aggr * 0.1 + multiwayPenalty;
      if (strength > valueBar && canAggress) {
        const to = sizeToFromPotFraction(0.5 + aggr * 0.35, view.pot, view.myCommittedThisStreet, currentBet, legal);
        intent = { type: legal.aggressiveType, to } as const;
        reasoning = `Betting ${(strength * 100) | 0}%-strength hand for value vs ${oppsInHand}.`;
      } else if (oppsInHand === 1 && rng.next() < config.bluffFreq * (0.5 + aggr * 0.5) * bluffScale && canAggress) {
        const to = sizeToFromPotFraction(0.5, view.pot, view.myCommittedThisStreet, currentBet, legal);
        intent = { type: legal.aggressiveType, to } as const;
        reasoning = `No showdown value, one opponent — taking a stab.`;
      } else {
        intent = { type: "check" } as const;
        reasoning = `Checking a ${(strength * 100) | 0}%-strength hand (${tablePos}).`;
      }
    }

    return {
      action: clampToLegal(intent, legal),
      confidence: Math.round(Math.abs(strength - 0.5) * 200) / 100,
      perceivedEquity: strength,
      reasoning,
      source: "heuristic",
    };
  }

  return { name: config.name, style: config.style, decide };
}

/** Personality presets for interesting matchups. */
export const PERSONALITIES = {
  TAG: { tightness: 0.7, aggression: 0.7, bluffFreq: 0.18, style: "TAG" },
  LAG: { tightness: 0.35, aggression: 0.85, bluffFreq: 0.32, style: "LAG" },
  nit: { tightness: 0.85, aggression: 0.45, bluffFreq: 0.06, style: "nit" },
  maniac: { tightness: 0.2, aggression: 0.95, bluffFreq: 0.45, style: "maniac" },
} as const;

export type PersonalityName = keyof typeof PERSONALITIES;

export function heuristicFromPersonality(
  name: string,
  personality: PersonalityName,
  seed: string,
): Bot {
  const p = PERSONALITIES[personality];
  return createHeuristicBot({ name, seed, style: p.style, tightness: p.tightness, aggression: p.aggression, bluffFreq: p.bluffFreq });
}
