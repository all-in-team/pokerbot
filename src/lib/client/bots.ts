/** Client-side bot setup: builds heuristic bots and carries UI metadata. */

import { heuristicFromPersonality, type PersonalityName } from "@/bots/heuristic.js";
import type { Bot } from "@/bots/types.js";

export interface BotMeta {
  name: string;
  personality: PersonalityName;
  /** Accent color (hex) for this seat's UI. */
  accent: string;
  /** Monogram glyph shown on the avatar. */
  glyph: string;
  tagline: string;
}

export const PERSONALITY_META: Record<PersonalityName, { glyph: string; tagline: string; accent: string }> = {
  TAG: { glyph: "♠", tagline: "Tight-Aggressive · picks spots, presses edges", accent: "#5fd1c4" },
  LAG: { glyph: "♦", tagline: "Loose-Aggressive · relentless pressure", accent: "#e8a64e" },
  nit: { glyph: "♣", tagline: "Nit · waits for the nuts", accent: "#5ccb8c" },
  maniac: { glyph: "♥", tagline: "Maniac · chaos and fury", accent: "#d8694c" },
};

export interface MatchSetup {
  seed: string;
  seats: [{ name: string; personality: PersonalityName }, { name: string; personality: PersonalityName }];
}

export const DEFAULT_SETUP: MatchSetup = {
  seed: "arena",
  seats: [
    { name: "Cassius", personality: "TAG" },
    { name: "Vesper", personality: "LAG" },
  ],
};

export function buildBots(setup: MatchSetup): [Bot, Bot] {
  return [
    heuristicFromPersonality(setup.seats[0].name, setup.seats[0].personality, `${setup.seed}:0`),
    heuristicFromPersonality(setup.seats[1].name, setup.seats[1].personality, `${setup.seed}:1`),
  ];
}

export function botMeta(setup: MatchSetup): [BotMeta, BotMeta] {
  return setup.seats.map((s) => ({
    name: s.name,
    personality: s.personality,
    ...PERSONALITY_META[s.personality],
  })) as [BotMeta, BotMeta];
}
