/**
 * Equity / EV postflop policy — a bot DECISION layer (no solver, no external
 * data). It reuses the engine's TRUTH layer (the pokersolver-backed evaluator,
 * the same primitive equity.ts is built on) to Monte-Carlo the acting bot's
 * equity against the opponents' ASSUMED continuation range on the current board,
 * then plays greedy max-EV vs that range (intentionally exploitable).
 *
 * It does NOT modify engine/equity logic. The player-exploitation layer
 * (exploitBot.ts) sits ON TOP of the Decision returned here.
 */

import { evaluate, compare } from "../engine/evaluator.js";
import { freshDeck, rankValue, type Card } from "../engine/cards.js";
import { createRng, type Rng } from "../engine/rng.js";
import { clampToLegal, sizeToFromPotFraction } from "./util.js";
import type { ActionInput } from "../engine/actions.js";
import type { Decision, DecisionView } from "./types.js";

const pct = (x: number) => `${Math.round(x * 100)}%`;

/**
 * Rough normalized starting-hand strength (0..1), used ONLY to model an
 * opponent's assumed continuation range (which 2-card combos they'd keep
 * betting/calling with). Self-contained so there's no import cycle with the
 * heuristic bot.
 */
function comboRangeStrength(c1: Card, c2: Card): number {
  const a = rankValue(c1);
  const b = rankValue(c2);
  const hi = Math.max(a, b);
  const lo = Math.min(a, b);
  const suited = c1[1] === c2[1];
  if (a === b) return Math.min(1, 0.5 + (hi - 2) / 24); // 22 ≈ .5 … AA ≈ 1
  let s = ((hi - 2) / 12) * 0.6; // top card weight
  if (suited) s += 0.12;
  const gap = hi - lo - 1;
  if (gap === 0) s += 0.12;
  else if (gap === 1) s += 0.06;
  else if (gap >= 4) s -= 0.1;
  if (lo >= 10) s += 0.08; // both broadway-ish
  return Math.max(0, Math.min(1, s));
}

export interface EquityVsRangeOptions {
  /** Monte Carlo iterations (more = smoother, slower). */
  iterations?: number;
  /**
   * Continuation-range bar 0..1: opponents are assumed to hold combos with
   * `comboRangeStrength ≥ rangeBar`. Higher = tighter (e.g. they bet/raised).
   */
  rangeBar?: number;
}

// Cache equity by content (hole+board+opps+range+iters): deterministic and
// avoids recompute for recurring spots. Bounded to keep memory flat.
const eqCache = new Map<string, number>();
const EQ_CACHE_CAP = 5000;

/**
 * Monte-Carlo equity (0..1) for `hole` on `board` against `opponents` hands
 * drawn from the assumed continuation range. Win = 1, split = 1/k, loss = 0.
 * Reuses the engine evaluator (truth layer) — engine equity code is untouched.
 */
export function equityVsRange(
  hole: Card[],
  board: Card[],
  opponents: number,
  opts: EquityVsRangeOptions = {},
): number {
  const iterations = Math.max(1, opts.iterations ?? 200);
  const rangeBar = opts.rangeBar ?? 0.34;
  const opps = Math.max(1, opponents);
  const key = `${hole.join("")}|${board.join("")}|${opps}|${rangeBar}|${iterations}`;
  const cached = eqCache.get(key);
  if (cached !== undefined) return cached;

  const known = new Set<Card>([...hole, ...board]);
  const deck = freshDeck().filter((c) => !known.has(c));
  const rng = createRng(`eqr#${key}`);
  const toCome = 5 - board.length;

  let sum = 0;
  for (let it = 0; it < iterations; it++) {
    const pool = deck.slice();
    let used = 0; // cards consumed from the front of `pool`
    const draw = (): Card => {
      const idx = used + rng.int(pool.length - used);
      const tmp = pool[used]!;
      pool[used] = pool[idx]!;
      pool[idx] = tmp;
      return pool[used++]!;
    };

    // Opponent hands from the assumed continuation range (rejection-sampled).
    const oppHands: [Card, Card][] = [];
    for (let o = 0; o < opps; o++) {
      let h: [Card, Card] = [draw(), draw()];
      for (let attempt = 0; attempt < 5 && comboRangeStrength(h[0], h[1]) < rangeBar; attempt++) {
        h = [draw(), draw()];
      }
      oppHands.push(h);
    }

    // Complete the board.
    const full = board.slice();
    for (let d = 0; d < toCome; d++) full.push(draw());

    const hero7 = [...hole, ...full];
    const heroEval = evaluate(hero7);
    let lose = false;
    let ties = 1;
    for (const oh of oppHands) {
      const opp7 = [oh[0], oh[1], ...full];
      const oppEval = evaluate(opp7);
      if (oppEval.rank > heroEval.rank) {
        lose = true;
        break;
      }
      if (oppEval.rank < heroEval.rank) continue;
      const c = compare(hero7, opp7); // same class → resolve kickers exactly
      if (c < 0) {
        lose = true;
        break;
      }
      if (c === 0) ties++;
    }
    sum += lose ? 0 : 1 / ties;
  }

  const equity = sum / iterations;
  if (eqCache.size >= EQ_CACHE_CAP) eqCache.clear();
  eqCache.set(key, equity);
  return equity;
}

export interface EquityEvConfig {
  aggression: number; // 0..1
  bluffFreq: number; // 0..1
  /** Monte Carlo iterations per decision. */
  samples: number;
}

/**
 * Greedy max-EV postflop decision vs the assumed range (exploitable by design):
 *  - facing a bet: equity vs pot odds (with a realization margin) → raise / call / fold,
 *  - with the lead: value bet when ahead, semi-bluff genuine draws, else check.
 * Sizing uses the existing pot-fraction helper. Labelled source "equity-EV".
 */
export function equityEvDecide(view: DecisionView, config: EquityEvConfig, rng: Rng): Decision {
  const { legal } = view;
  const canAggress = legal.canBet || legal.canRaise;
  const currentBet = view.myCommittedThisStreet + view.toCall;
  const oppsInHand = Math.max(1, (view.activePlayers ?? 2) - 1);
  const facingBet = view.toCall > 0;

  // Assumed opponent continuation range, derived from the action: a bettor/raiser
  // represents strength (tighter), an unled pot is wider.
  const rangeBar = facingBet ? 0.5 : 0.34;
  const equity = equityVsRange(view.holeCards, view.board, oppsInHand, {
    iterations: config.samples,
    rangeBar,
  });

  // Made-hand class (1 high card … 9 straight flush) to tell draws from air.
  let madeRank = 1;
  if (view.board.length >= 3) {
    try {
      madeRank = evaluate([...view.holeCards, ...view.board]).rank;
    } catch {
      madeRank = 1;
    }
  }

  // Realization-of-equity margin: out of position / multiway we realize less than
  // raw equity, so demand a little extra before investing.
  const realizeMargin = 0.03 + 0.03 * (oppsInHand - 1) + (view.position === "bigBlind" ? 0.02 : 0);

  let intent: ActionInput;
  let reasoning: string;

  if (facingBet) {
    const potOdds = view.toCall / (view.pot + view.toCall);
    const callBar = potOdds + realizeMargin;
    const valueBar = 0.66 + 0.04 * (oppsInHand - 1);
    // A real draw: weak made hand but enough equity to keep going past the price.
    const isDraw = madeRank <= 2 && equity < 0.55 && equity >= potOdds + 0.04;

    if (equity >= valueBar && canAggress && rng.next() < 0.7 + config.aggression * 0.3) {
      const to = sizeToFromPotFraction(0.6 + config.aggression * 0.4, view.pot, view.myCommittedThisStreet, currentBet, legal);
      intent = { type: legal.aggressiveType, to };
      reasoning = `Équité ${pct(equity)} vs ${oppsInHand} → relance value.`;
    } else if (equity >= callBar) {
      intent = { type: "call" };
      reasoning = `Équité ${pct(equity)} ≥ cotes ${pct(potOdds)} (+marge) → call.`;
    } else if (isDraw && oppsInHand === 1 && canAggress && rng.next() < config.bluffFreq * (0.6 + config.aggression * 0.6)) {
      const to = sizeToFromPotFraction(0.75, view.pot, view.myCommittedThisStreet, currentBet, legal);
      intent = { type: legal.aggressiveType, to };
      reasoning = `Tirage (équité ${pct(equity)}) → semi-bluff relance.`;
    } else {
      intent = { type: "fold" };
      reasoning = `Équité ${pct(equity)} < cotes ${pct(potOdds)} (+marge) → fold.`;
    }
  } else {
    const valueBar = 0.58 + 0.04 * (oppsInHand - 1) - config.aggression * 0.06;
    const isDraw = madeRank <= 2 && equity >= 0.34 + realizeMargin && equity < valueBar;

    if (equity >= valueBar && canAggress) {
      const to = sizeToFromPotFraction(0.5 + config.aggression * 0.35, view.pot, view.myCommittedThisStreet, currentBet, legal);
      intent = { type: legal.aggressiveType, to };
      reasoning = `Équité ${pct(equity)} vs ${oppsInHand} → value bet.`;
    } else if (isDraw && canAggress && rng.next() < (config.bluffFreq * (0.6 + config.aggression * 0.6)) / oppsInHand) {
      const to = sizeToFromPotFraction(0.5, view.pot, view.myCommittedThisStreet, currentBet, legal);
      intent = { type: legal.aggressiveType, to };
      reasoning = `Tirage (équité ${pct(equity)}) → semi-bluff.`;
    } else if (madeRank <= 1 && equity < 0.3 && oppsInHand === 1 && canAggress && rng.next() < config.bluffFreq * 0.4) {
      const to = sizeToFromPotFraction(0.5, view.pot, view.myCommittedThisStreet, currentBet, legal);
      intent = { type: legal.aggressiveType, to };
      reasoning = `Pas d'équité, tête-à-tête → bluff occasionnel.`;
    } else {
      intent = { type: "check" };
      reasoning = `Équité ${pct(equity)} insuffisante vs ${oppsInHand} → check.`;
    }
  }

  return {
    action: clampToLegal(intent, legal),
    confidence: Math.round(Math.abs(equity - 0.5) * 200) / 100,
    perceivedEquity: equity,
    reasoning,
    source: "equity-EV",
  };
}
