/**
 * Deterministic mock LLM client. Plays a reasonable, playbook-and-opponent-aware
 * game and produces sensible coach diffs — all offline, so the reasoning and
 * learning loop runs and tests without an API key. Swapped for the real
 * Anthropic client when ANTHROPIC_API_KEY is set.
 */

import { evaluate } from "../engine/evaluator.js";
import { preflopStrength } from "../bots/heuristic.js";
import { createRng } from "../engine/rng.js";
import { getPath, type PlaybookChange, type PlaybookDiff, type TunablePath } from "../learning/playbook.js";
import type { DecideInput, DecisionJson, LlmClient, ReflectInput } from "./types.js";

function strengthOf(input: DecideInput): number {
  const { view } = input;
  if (view.street === "preflop") return preflopStrength(view.holeCards);
  const rank = evaluate([...view.holeCards, ...view.board]).rank;
  const byRank: Record<number, number> = {
    1: 0.18, 2: 0.42, 3: 0.62, 4: 0.76, 5: 0.84, 6: 0.9, 7: 0.95, 8: 0.99, 9: 1,
  };
  return byRank[rank] ?? 0.2;
}

export class MockLlmClient implements LlmClient {
  readonly live = false;

  async decide(input: DecideInput): Promise<DecisionJson> {
    const { view, playbook, opponentHud } = input;
    const strength = strengthOf(input);
    const rng = createRng(`${view.handId}:${view.street}:${view.seat}:${view.board.join("")}`);

    // Opponent reads: bluff more into a folder, value heavier vs a station.
    const overFolds = opponentHud.foldToCbet > 0.5;
    const station = opponentHud.foldToCbet < 0.3 && opponentHud.hands > 5;
    const bluffBias = overFolds ? 1.4 : station ? 0.5 : 1;

    let action: DecisionJson["action"] = "check";
    let sizing = 0;
    let reasoning: string;

    const valueTo = (frac: number) =>
      Math.round(view.myCommittedThisStreet + view.toCall + frac * Math.max(view.pot, view.bigBlind));

    if (view.toCall > 0) {
      const potOdds = view.toCall / (view.pot + view.toCall);
      const preflopSteal =
        view.street === "preflop" && view.legal.canRaise && rng.next() < playbook.preflop.openRaise;
      if (strength > 0.82) {
        action = view.legal.canRaise ? "raise" : "call";
        sizing = action === "raise" ? valueTo(playbook.postflop.valueSizing) : 0;
        reasoning = `Strong hand (${pct(strength)}); ${action === "raise" ? "raising for value" : "calling to trap"}.`;
      } else if (preflopSteal) {
        action = "raise";
        sizing = Math.round(playbook.preflop.openSizeBb * view.bigBlind);
        reasoning = `Opening to ${sizing} — applying preflop pressure (${pct(playbook.preflop.openRaise)} open range).`;
      } else if (strength > potOdds + 0.05) {
        action = "call";
        reasoning = `${pct(strength)} equity beats the ${pct(potOdds)} price; calling.`;
      } else if (view.legal.canRaise && rng.next() < playbook.postflop.bluffRaise * bluffBias) {
        action = "raise";
        sizing = valueTo(playbook.postflop.bluffSizing);
        reasoning = overFolds
          ? `Villain over-folds (${pct(opponentHud.foldToCbet)} F2CB) — bluff-raising.`
          : `Repping a big hand with a raise.`;
      } else {
        action = "fold";
        reasoning = `Hand too weak (${pct(strength)}) for the price; folding.`;
      }
    } else {
      const cbetSpot = view.street === "flop";
      const valueBar = 0.55;
      if (strength > valueBar && view.legal.canBet) {
        action = "bet";
        sizing = valueTo(playbook.postflop.valueSizing);
        reasoning = `Betting ${pct(strength)}-strength hand for value.`;
      } else if (
        view.legal.canBet &&
        rng.next() < (cbetSpot ? playbook.postflop.cbet : playbook.postflop.doubleBarrel) * bluffBias
      ) {
        action = "bet";
        sizing = valueTo(playbook.postflop.bluffSizing);
        reasoning = overFolds
          ? `${cbetSpot ? "C-betting" : "Barreling"} into a player who folds too much.`
          : `${cbetSpot ? "Standard c-bet" : "Double-barrel"} to deny equity.`;
      } else {
        action = "check";
        reasoning = `Checking back ${pct(strength)}-strength; pot control.`;
      }
    }

    return {
      action,
      sizing,
      confidence: Math.round(Math.abs(strength - 0.5) * 200) / 100,
      reasoning,
      perceivedEquity: Math.round(strength * 100) / 100,
    };
  }

  async reflect(input: ReflectInput): Promise<PlaybookDiff> {
    const { playbook, opponentHud, net } = input;
    const changes: PlaybookChange[] = [];
    const notes: string[] = [];

    const bump = (path: TunablePath, delta: number, reason: string) => {
      const from = getPath(playbook, path);
      changes.push({ path, from, to: Math.round((from + delta) * 100) / 100, reason });
    };

    if (opponentHud.foldToCbet > 0.5) {
      bump("postflop.cbet", 0.06, "Villain over-folds to flop c-bets — widen c-betting range.");
      bump("postflop.doubleBarrel", 0.08, "Over-folds carry to the turn — barrel more often.");
      notes.push(`Villain folds to ${pct(opponentHud.foldToCbet)} of c-bets — exploit by barreling relentlessly.`);
    } else if (opponentHud.foldToCbet < 0.3 && opponentHud.hands > 10) {
      bump("postflop.bluffRaise", -0.05, "Villain is a calling station — cut bluffs, value heavier.");
      bump("postflop.valueSizing", 0.05, "Station pays off — increase value bet sizing.");
      notes.push(`Villain calls down light (${pct(opponentHud.foldToCbet)} F2CB) — stop bluffing, thin-value relentlessly.`);
    }

    if (opponentHud.vpip > 0.45) {
      bump("preflop.threeBet", 0.04, "Villain plays too many hands — 3-bet wider for value.");
    } else if (opponentHud.vpip < 0.2 && opponentHud.hands > 10) {
      bump("preflop.openRaise", 0.05, "Villain is a nit — steal blinds more aggressively.");
    }

    if (net < 0) {
      bump("postflop.bluffRaise", -0.03, "Down this session — tighten up bluff-raising.");
    }

    const summary =
      changes.length === 0
        ? "No significant leaks detected; holding strategy steady this session."
        : `Adjusted ${changes.length} tendenc${changes.length === 1 ? "y" : "ies"} based on opponent reads (F2CB ${pct(opponentHud.foldToCbet)}, VPIP ${pct(opponentHud.vpip)}).`;

    return { summary, changes, addedNotes: notes };
  }
}

const pct = (x: number) => `${Math.round(x * 100)}%`;
