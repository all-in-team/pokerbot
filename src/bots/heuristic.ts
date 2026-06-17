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
import { clampToLegal, sizeToFromPotFraction } from "./util.js";
import type { Bot, Decision, DecisionView } from "./types.js";

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

  function decide(view: DecisionView): Decision {
    const { legal } = view;
    const strength = strengthFor(view);
    const aggr = config.aggression;
    const currentBet = view.myCommittedThisStreet + view.toCall;

    // Preflop fold bar scales with tightness; postflop is governed by made hands.
    const foldBar = view.street === "preflop" ? 0.28 + config.tightness * 0.32 : 0;

    let intent;
    let reasoning: string;

    if (view.toCall > 0) {
      // Facing a bet. Compare strength to the pot odds we're being laid.
      const potOdds = view.toCall / (view.pot + view.toCall);
      if (strength > 0.82) {
        // Strong: raise for value (sometimes just call to trap when very strong).
        if (rng.next() < 0.75 && (legal.canRaise || legal.canBet)) {
          const to = sizeToFromPotFraction(0.6 + aggr * 0.5, view.pot, view.myCommittedThisStreet, currentBet, legal);
          intent = { type: legal.aggressiveType, to } as const;
          reasoning = `Strong hand (${(strength * 100) | 0}%); raising for value.`;
        } else {
          intent = { type: "call" } as const;
          reasoning = `Very strong; flat-calling to keep the bluffs in.`;
        }
      } else if (strength > potOdds + 0.06 || (view.street === "preflop" && strength > foldBar)) {
        intent = { type: "call" } as const;
        reasoning = `Hand (${(strength * 100) | 0}%) beats the ${(potOdds * 100) | 0}% pot odds; calling.`;
      } else if (rng.next() < config.bluffFreq * 0.5 && (legal.canRaise || legal.canBet)) {
        const to = sizeToFromPotFraction(0.7, view.pot, view.myCommittedThisStreet, currentBet, legal);
        intent = { type: legal.aggressiveType, to } as const;
        reasoning = `Weak but representing strength — bluff-raising.`;
      } else {
        intent = { type: "fold" } as const;
        reasoning = `Hand too weak (${(strength * 100) | 0}%) for the price; folding.`;
      }
    } else {
      // No bet to call: check or bet.
      const valueBar = 0.55 - aggr * 0.1;
      if (strength > valueBar && (legal.canBet || legal.canRaise)) {
        const to = sizeToFromPotFraction(0.5 + aggr * 0.35, view.pot, view.myCommittedThisStreet, currentBet, legal);
        intent = { type: legal.aggressiveType, to } as const;
        reasoning = `Betting ${(strength * 100) | 0}%-strength hand for value.`;
      } else if (rng.next() < config.bluffFreq * (0.5 + aggr * 0.5) && (legal.canBet || legal.canRaise)) {
        const to = sizeToFromPotFraction(0.5, view.pot, view.myCommittedThisStreet, currentBet, legal);
        intent = { type: legal.aggressiveType, to } as const;
        reasoning = `No showdown value — taking a stab at the pot.`;
      } else {
        intent = { type: "check" } as const;
        reasoning = `Checking with a ${(strength * 100) | 0}%-strength hand.`;
      }
    }

    return {
      action: clampToLegal(intent, legal),
      confidence: Math.round(Math.abs(strength - 0.5) * 200) / 100,
      perceivedEquity: strength,
      reasoning,
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
