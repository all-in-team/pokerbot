/**
 * Vanilla counterfactual regret minimization (CFR) for Kuhn Poker.
 *
 * Each iteration traverses the full game tree over all 6 deals, accumulating
 * counterfactual regret via regret matching; the average strategy converges to
 * a Nash equilibrium. We track two convergence signals per checkpoint:
 *   - exploitability: how much a best-responding opponent could win against the
 *     current average strategy (→ 0 at equilibrium), computed exactly.
 *   - strategy entropy: mean Shannon entropy of the average strategy (drops as
 *     strategies sharpen toward the equilibrium).
 */

import {
  ACTIONS,
  DEALS,
  currentPlayer,
  historyOfKey,
  infoSetKey,
  isTerminal,
  utilityToP0,
} from "./kuhn.js";

class Node {
  regretSum = [0, 0];
  strategySum = [0, 0];

  /** Current strategy via regret matching; accumulate the average weighted by reach. */
  strategy(reachWeight: number): number[] {
    const r = [Math.max(this.regretSum[0]!, 0), Math.max(this.regretSum[1]!, 0)];
    const norm = r[0]! + r[1]!;
    const s = norm > 0 ? [r[0]! / norm, r[1]! / norm] : [0.5, 0.5];
    this.strategySum[0]! += reachWeight * s[0]!;
    this.strategySum[1]! += reachWeight * s[1]!;
    return s;
  }

  average(): number[] {
    const norm = this.strategySum[0]! + this.strategySum[1]!;
    return norm > 0 ? [this.strategySum[0]! / norm, this.strategySum[1]! / norm] : [0.5, 0.5];
  }
}

export interface ConvergencePoint {
  iteration: number;
  exploitability: number;
  entropy: number;
}

export interface StrategyEntry {
  infoSet: string;
  card: number;
  context: string;
  bet: number; // P(bet)
}

export interface SolveResult {
  history: ConvergencePoint[];
  strategy: StrategyEntry[];
  finalExploitability: number;
  finalEntropy: number;
  iterations: number;
}

type Policy = (key: string) => number[];

export class KuhnSolver {
  private nodes = new Map<string, Node>();

  private node(key: string): Node {
    let n = this.nodes.get(key);
    if (!n) {
      n = new Node();
      this.nodes.set(key, n);
    }
    return n;
  }

  /** CFR recursion (Neller–Lanctot form): returns node utility to the acting player. */
  private cfr(cards: [number, number], history: string, p0: number, p1: number): number {
    if (isTerminal(history)) {
      const u = utilityToP0(cards, history);
      return currentPlayer(history) === 0 ? u : -u;
    }
    const player = currentPlayer(history);
    const key = infoSetKey(cards[player], history);
    const node = this.node(key);
    const strategy = node.strategy(player === 0 ? p0 : p1);

    const util = [0, 0];
    let nodeUtil = 0;
    for (let i = 0; i < ACTIONS.length; i++) {
      const next = history + ACTIONS[i];
      util[i] =
        player === 0
          ? -this.cfr(cards, next, p0 * strategy[i]!, p1)
          : -this.cfr(cards, next, p0, p1 * strategy[i]!);
      nodeUtil += strategy[i]! * util[i]!;
    }
    const cfReach = player === 0 ? p1 : p0;
    for (let i = 0; i < ACTIONS.length; i++) {
      node.regretSum[i]! += cfReach * (util[i]! - nodeUtil);
    }
    return nodeUtil;
  }

  /** Average-strategy policy for a player (uniform on unseen info sets). */
  private avgPolicy(): Policy {
    return (key) => this.nodes.get(key)?.average() ?? [0.5, 0.5];
  }

  /** Expected value to P0 under the given policies, averaged over deals. */
  private expectedValue(policy0: Policy, policy1: Policy): number {
    const ev = (cards: [number, number], history: string): number => {
      if (isTerminal(history)) return utilityToP0(cards, history);
      const player = currentPlayer(history);
      const probs = (player === 0 ? policy0 : policy1)(infoSetKey(cards[player], history));
      return probs[0]! * ev(cards, history + "p") + probs[1]! * ev(cards, history + "b");
    };
    return DEALS.reduce((sum, d) => sum + ev(d, ""), 0) / DEALS.length;
  }

  private infoSetsOf(player: 0 | 1): string[] {
    return [...this.nodes.keys()].filter((k) => currentPlayer(historyOfKey(k)) === player);
  }

  /**
   * Exact exploitability = best-response gain for both players against the
   * current average strategy. Brute-forces pure strategies (≤ 2^6 each).
   */
  exploitability(): number {
    const avg = this.avgPolicy();
    const best = (player: 0 | 1): number => {
      const sets = this.infoSetsOf(player);
      const k = sets.length;
      let bestVal = -Infinity;
      for (let mask = 0; mask < 1 << k; mask++) {
        const pure: Policy = (key) => {
          const idx = sets.indexOf(key);
          if (idx < 0) return [0.5, 0.5];
          return (mask >> idx) & 1 ? [0, 1] : [1, 0];
        };
        const evToP0 = player === 0 ? this.expectedValue(pure, avg) : this.expectedValue(avg, pure);
        const val = player === 0 ? evToP0 : -evToP0; // each player maximizes their own payoff
        if (val > bestVal) bestVal = val;
      }
      return bestVal;
    };
    return best(0) + best(1);
  }

  /** Mean Shannon entropy (bits) of the average strategy across info sets. */
  entropy(): number {
    let total = 0;
    let count = 0;
    for (const node of this.nodes.values()) {
      const a = node.average();
      let h = 0;
      for (const p of a) if (p > 0) h -= p * Math.log2(p);
      total += h;
      count++;
    }
    return count > 0 ? total / count : 0;
  }

  strategyTable(): StrategyEntry[] {
    const labelCard = (c: number) => (c === 3 ? "K" : c === 2 ? "Q" : "J");
    const labelCtx = (h: string) =>
      h === "" ? "open" : h === "p" ? "vs check" : h === "b" ? "facing bet" : h === "pb" ? "facing bet (checked)" : h;
    return [...this.nodes.entries()]
      .map(([key, node]) => {
        const card = Number(key[0]);
        const ctx = historyOfKey(key);
        return { infoSet: key, card, context: `${labelCard(card)} · ${labelCtx(ctx)}`, bet: node.average()[1]! };
      })
      .sort((a, b) => b.card - a.card || a.infoSet.localeCompare(b.infoSet));
  }

  train(iterations: number, sampleEvery: number, onProgress?: (p: ConvergencePoint) => void): ConvergencePoint[] {
    const history: ConvergencePoint[] = [];
    for (let i = 1; i <= iterations; i++) {
      for (const deal of DEALS) this.cfr(deal, "", 1, 1);
      if (i % sampleEvery === 0 || i === iterations) {
        const point = { iteration: i, exploitability: this.exploitability(), entropy: this.entropy() };
        history.push(point);
        onProgress?.(point);
      }
    }
    return history;
  }
}

/** Convenience: run CFR to completion and return everything the UI needs. */
export function solveKuhn(iterations = 5000, sampleEvery = Math.max(1, Math.floor(iterations / 40))): SolveResult {
  const solver = new KuhnSolver();
  const history = solver.train(iterations, sampleEvery);
  return {
    history,
    strategy: solver.strategyTable(),
    finalExploitability: history.at(-1)?.exploitability ?? NaN,
    finalEntropy: history.at(-1)?.entropy ?? NaN,
    iterations,
  };
}
