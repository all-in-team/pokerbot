/**
 * Spot Trainer scoring engine — 100 % derived from the STORED solver solution
 * (spot.solution). Nothing here computes GTO: it only reads frequencies and EVs
 * that were imported from PioSOLVER / GTO Wizard and grades the student against
 * them.
 *
 * Theory: at equilibrium every action played with frequency > 0 has ~the same
 * (best) EV; actions never played have a lower EV. So:
 *   - frequency > 0  → a valid GTO mix action → verdict "gto" (we NEVER call a
 *     mixed action "wrong", even if it isn't the highest-frequency one).
 *   - frequency == 0 → a deviation, quantified by EV lost:
 *       evLoss = max(ev over all actions) - ev(chosen action)
 *     bucketed into Imprécision / Erreur / Blunder.
 */
import type { Action, SolutionAction, Spot } from "./spots.js";

/** EV-loss thresholds, in the SAME unit as solution.actions[].ev. Adjustable. */
export const IMPRECISION_TOL = 0.5;
export const ERREUR_TOL = 2.0;

export type Verdict = "gto" | "imprecision" | "erreur" | "blunder" | "out-of-tree";

export interface ScoreResult {
  verdict: Verdict;
  /** EV lost vs the best action; null when not applicable (gto / out-of-tree). */
  evLoss: number | null;
  /** The solution action the student's move was graded against (ref into actions). */
  matched: SolutionAction | null;
  /** Best EV across all solution actions. */
  bestEv: number;
  /** Set when a raise was graded against a different solver sizing. */
  sizingNote?: string;
}

/** Display metadata per verdict (label + color for the banner). */
export const VERDICT_META: Record<Verdict, { label: string; color: string }> = {
  gto: { label: "GTO", color: "#22c55e" },
  imprecision: { label: "Imprécision", color: "#eab308" },
  erreur: { label: "Erreur", color: "#f97316" },
  blunder: { label: "Blunder", color: "#ef4444" },
  "out-of-tree": { label: "Hors-arbre", color: "#64748b" },
};

/**
 * Grade a student's action against the stored solution.
 *
 * Mapping:
 *  - fold / call → direct match on action type.
 *  - raise → closest solver raise by sizing; flags `sizingNote` if it differs.
 *  - action absent from the tree → "out-of-tree" (no evLoss).
 */
export function scoreAttempt(
  solution: Spot["solution"],
  action: Action,
  sizing?: number,
): ScoreResult {
  const actions = solution.actions;
  if (actions.length === 0) {
    return { verdict: "out-of-tree", evLoss: null, matched: null, bestEv: 0 };
  }

  const bestEv = Math.max(...actions.map((a) => a.ev));

  let matched: SolutionAction | null = null;
  let sizingNote: string | undefined;

  if (action === "raise") {
    const raises = actions.filter((a) => a.action === "raise");
    if (raises.length > 0) {
      const target = sizing ?? 0;
      matched = raises.reduce((best, a) =>
        Math.abs((a.sizing ?? 0) - target) < Math.abs((best.sizing ?? 0) - target) ? a : best,
      );
      // Note the grading basis only when the closest solver sizing actually differs.
      if (matched.sizing != null && matched.sizing !== sizing) {
        sizingNote = `noté contre la taille solver la plus proche : ${matched.sizing}`;
      }
    }
  } else {
    matched = actions.find((a) => a.action === action) ?? null;
  }

  if (!matched) {
    return { verdict: "out-of-tree", evLoss: null, matched: null, bestEv, sizingNote };
  }

  // An action in the mix is GTO-valid — never flagged wrong.
  if (matched.frequency > 0) {
    return { verdict: "gto", evLoss: 0, matched, bestEv, sizingNote };
  }

  // Pure deviation: quantify by EV lost vs the best action.
  const evLoss = bestEv - matched.ev;
  let verdict: Verdict;
  if (evLoss <= IMPRECISION_TOL) verdict = "imprecision";
  else if (evLoss <= ERREUR_TOL) verdict = "erreur";
  else verdict = "blunder";

  return { verdict, evLoss, matched, bestEv, sizingNote };
}
