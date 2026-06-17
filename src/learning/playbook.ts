/**
 * A bot's PLAYBOOK — its persistent, versioned strategy document. The coach
 * reflection pass produces a diff against this after each session; storing the
 * versions is what makes strategy evolution visible in the learning timeline.
 */

import type { PersonalityName } from "../bots/heuristic.js";

export interface Playbook {
  version: number;
  style: string;
  preflop: {
    /** % of hands to open-raise from the button (SB). 0..1. */
    openRaise: number;
    /** % to 3-bet when facing an open. 0..1. */
    threeBet: number;
    /** % to call (flat) an open rather than fold. 0..1. */
    callVsOpen: number;
    /** Open-raise size in big blinds. */
    openSizeBb: number;
    /** 3-bet size as a multiple of the open. */
    threeBetX: number;
  };
  postflop: {
    /** Flop continuation-bet frequency as the preflop aggressor. 0..1. */
    cbet: number;
    /** Turn double-barrel bluff frequency. 0..1. */
    doubleBarrel: number;
    /** Frequency of raising as a bluff. 0..1. */
    bluffRaise: number;
    /** Value bet size as a fraction of the pot. */
    valueSizing: number;
    /** Bluff bet size as a fraction of the pot. */
    bluffSizing: number;
  };
  /** Free-text observed opponent leaks and self-corrections. */
  notes: string[];
}

/** Numeric playbook paths the coach is allowed to tune. */
export const TUNABLE_PATHS = [
  "preflop.openRaise",
  "preflop.threeBet",
  "preflop.callVsOpen",
  "preflop.openSizeBb",
  "preflop.threeBetX",
  "postflop.cbet",
  "postflop.doubleBarrel",
  "postflop.bluffRaise",
  "postflop.valueSizing",
  "postflop.bluffSizing",
] as const;

export type TunablePath = (typeof TUNABLE_PATHS)[number];

export interface PlaybookChange {
  path: TunablePath;
  from: number;
  to: number;
  reason: string;
}

export interface PlaybookDiff {
  summary: string;
  changes: PlaybookChange[];
  addedNotes: string[];
}

const BASE: Record<PersonalityName, Omit<Playbook, "version" | "style">> = {
  TAG: {
    preflop: { openRaise: 0.55, threeBet: 0.12, callVsOpen: 0.32, openSizeBb: 2.5, threeBetX: 3 },
    postflop: { cbet: 0.62, doubleBarrel: 0.45, bluffRaise: 0.12, valueSizing: 0.66, bluffSizing: 0.6 },
    notes: ["Default tight-aggressive baseline. Value-bet thin in position; respect raises."],
  },
  LAG: {
    preflop: { openRaise: 0.78, threeBet: 0.2, callVsOpen: 0.28, openSizeBb: 2.3, threeBetX: 3.2 },
    postflop: { cbet: 0.72, doubleBarrel: 0.55, bluffRaise: 0.22, valueSizing: 0.7, bluffSizing: 0.66 },
    notes: ["Apply relentless pressure. Barrel turns when the story is credible."],
  },
  nit: {
    preflop: { openRaise: 0.42, threeBet: 0.06, callVsOpen: 0.22, openSizeBb: 2.5, threeBetX: 2.8 },
    postflop: { cbet: 0.5, doubleBarrel: 0.3, bluffRaise: 0.05, valueSizing: 0.7, bluffSizing: 0.55 },
    notes: ["Wait for strong holdings. Avoid marginal spots out of position."],
  },
  maniac: {
    preflop: { openRaise: 0.92, threeBet: 0.3, callVsOpen: 0.2, openSizeBb: 2.2, threeBetX: 3.5 },
    postflop: { cbet: 0.82, doubleBarrel: 0.66, bluffRaise: 0.35, valueSizing: 0.75, bluffSizing: 0.72 },
    notes: ["Maximize chaos. Force opponents to make tough decisions for stacks."],
  },
};

export function defaultPlaybook(personality: PersonalityName): Playbook {
  return { version: 1, style: personality, ...structuredClone(BASE[personality]) };
}

function getPath(pb: Playbook, path: TunablePath): number {
  const [a, b] = path.split(".") as [keyof Playbook, string];
  return (pb[a] as Record<string, number>)[b]!;
}

function setPath(pb: Playbook, path: TunablePath, value: number): void {
  const [a, b] = path.split(".") as [keyof Playbook, string];
  (pb[a] as Record<string, number>)[b] = value;
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

/** Apply a coach diff, returning a new playbook with an incremented version. */
export function applyDiff(playbook: Playbook, diff: PlaybookDiff): Playbook {
  const next = structuredClone(playbook);
  next.version = playbook.version + 1;
  for (const change of diff.changes) {
    if (!TUNABLE_PATHS.includes(change.path)) continue;
    // Frequencies are clamped to [0,1]; sizes are kept positive and sane.
    const isFreq = !change.path.includes("Size") && !change.path.includes("X");
    const v = isFreq ? clamp01(change.to) : Math.max(0.5, change.to);
    setPath(next, change.path, v);
  }
  for (const note of diff.addedNotes) {
    if (note.trim()) next.notes.push(note.trim());
  }
  // Keep the notes list from growing without bound.
  if (next.notes.length > 12) next.notes = next.notes.slice(next.notes.length - 12);
  return next;
}

export { getPath };
