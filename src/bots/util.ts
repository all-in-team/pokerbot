/**
 * Normalize a bot's intended action into a guaranteed-legal ActionInput.
 *
 * Bots — especially the API-backed reasoning agents — may propose an action
 * that is almost-but-not-quite legal (a bet below the minimum, a raise when only
 * a call is possible, a check when facing a bet). Rather than letting the engine
 * throw, we coerce the intent to the closest legal action so play never stalls.
 */

import type { ActionInput, LegalActions } from "../engine/actions.js";

export function clampToLegal(intent: ActionInput, legal: LegalActions): ActionInput {
  switch (intent.type) {
    case "fold":
      // Never fold when checking is free.
      if (legal.canFold) return { type: "fold" };
      return { type: "check" };

    case "check":
      if (legal.canCheck) return { type: "check" };
      // Can't check facing a bet → treat as a call.
      if (legal.canCall) return { type: "call" };
      return { type: "fold" };

    case "call":
      if (legal.canCall) return { type: "call" };
      if (legal.canCheck) return { type: "check" };
      return { type: "fold" };

    case "bet":
    case "raise": {
      if (legal.canBet || legal.canRaise) {
        const to = clampTo(intent.to, legal);
        return { type: legal.aggressiveType, to };
      }
      // Aggression not available → fall back to call, else check, else fold.
      if (legal.canCall) return { type: "call" };
      if (legal.canCheck) return { type: "check" };
      return { type: "fold" };
    }
  }
}

function clampTo(to: number, legal: LegalActions): number {
  const rounded = Math.round(to);
  if (rounded < legal.minTo) return legal.minTo;
  if (rounded > legal.maxTo) return legal.maxTo;
  return rounded;
}

/**
 * Convert a pot-fraction sizing into a legal "to" amount for a bet or raise.
 * `committed` is the actor's chips already in this street.
 */
export function sizeToFromPotFraction(
  fraction: number,
  pot: number,
  committed: number,
  currentBet: number,
  legal: LegalActions,
): number {
  // Bet: wager `fraction × pot`. Raise: raise BY `fraction × pot` over the call.
  const raiseBy = Math.max(1, Math.round(fraction * pot));
  const target = currentBet === 0 ? committed + raiseBy : currentBet + raiseBy;
  return clampTo(target, legal);
}
