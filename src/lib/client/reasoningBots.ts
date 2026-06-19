"use client";

/**
 * Client-side reasoning bots for the live table. Each bot's decision is a round
 * trip to /api/decide, which runs the LLM client (offline mock or live
 * Anthropic) server-side. The opponent HUD is read live from the director, and
 * the playbook is the personality's default — so the same Bot interface that
 * powers the heuristic table now thinks with the reasoning agents.
 */

import { clampToLegal } from "@/bots/util.js";
import { defaultPlaybook } from "@/learning/playbook.js";
import { computeHudStats } from "@/sim/hud.js";
import type { Bot, Decision, DecisionView } from "@/bots/types.js";
import type { ActionInput } from "@/engine/actions.js";
import type { DecisionJson } from "@/llm/types.js";
import type { Seat } from "@/engine/state.js";
import type { ArenaDirector } from "./director.js";
import type { MatchSetup } from "./bots.js";

/** Shared mutable reference so the bots can read the director once it exists. */
export interface DirectorCtx {
  director: ArenaDirector | null;
}

function toActionInput(d: DecisionJson): ActionInput {
  switch (d.action) {
    case "fold":
      return { type: "fold" };
    case "check":
      return { type: "check" };
    case "call":
      return { type: "call" };
    case "bet":
      return { type: "bet", to: Math.round(d.sizing) };
    case "raise":
      return { type: "raise", to: Math.round(d.sizing) };
  }
}

function makeRemoteBot(seat: Seat, setup: MatchSetup, ctx: DirectorCtx): Bot {
  const playbook = defaultPlaybook(setup.seats[seat]!.personality);
  const name = setup.seats[seat]!.name;
  const opp: Seat = (seat === 0 ? 1 : 0) as Seat;

  async function decide(view: DecisionView): Promise<Decision> {
    const opponentHud = ctx.director?.opponentHudOf(opp) ?? computeHudStats([], opp);
    try {
      const res = await fetch("/api/decide", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ view, playbook, opponentHud }),
      });
      const data = (await res.json()) as { decision?: DecisionJson; error?: string };
      if (!data.decision) throw new Error(data.error ?? "no decision");
      const d = data.decision;
      return {
        action: clampToLegal(toActionInput(d), view.legal),
        confidence: clampish(d.confidence),
        reasoning: d.reasoning,
        perceivedEquity: clampish(d.perceivedEquity),
      };
    } catch (err) {
      const fallback: ActionInput = view.legal.canCheck ? { type: "check" } : { type: "fold" };
      return {
        action: fallback,
        confidence: 0,
        reasoning: `(reasoning unavailable: ${(err as Error).message})`,
        perceivedEquity: undefined,
      };
    }
  }

  return { name, style: setup.seats[seat]!.personality, decide };
}

export function buildReasoningBots(setup: MatchSetup, ctx: DirectorCtx): [Bot, Bot] {
  return [makeRemoteBot(0, setup, ctx), makeRemoteBot(1, setup, ctx)];
}

const clampish = (x: number) => (Number.isFinite(x) ? Math.max(0, Math.min(1, x)) : 0);
