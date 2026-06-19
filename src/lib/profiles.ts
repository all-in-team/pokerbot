/**
 * Opponent profiles for the EXPLOIT-oriented trainer.
 *
 * A profile describes a fixed opponent archetype. It carries human-readable
 * tendencies for the coach and (optionally) structured numbers. It is NEVER the
 * source of EV truth: exploit EVs come from a STORED solver best-response vs this
 * profile (see Spot.solution, mode: 'exploit'), never from an LLM or from these
 * numbers directly.
 *
 * Profiles whose `source` is missing or starts with "PLACEHOLDER" have not been
 * imported yet (tendencies are 0). The trainer must not grade against them.
 */
import profilesData from "@/data/profiles.json";

export interface OpponentProfile {
  id: string;
  /** Short archetype name, e.g. "Calling station", "Nit". */
  name: string;
  /** Plain-language tendencies for the coach. */
  description: string;
  /** Structured tendencies, e.g. { foldToCbet: 0.7 }. 0 until imported. */
  tendencies?: Record<string, number>;
  /** Provenance; "PLACEHOLDER …" until a real profile is imported. */
  source?: string;
}

const PROFILES = profilesData as unknown as OpponentProfile[];

export function listProfiles(): OpponentProfile[] {
  return PROFILES;
}

export function getProfile(id: string): OpponentProfile | undefined {
  return PROFILES.find((p) => p.id === id);
}

/** True when the profile has not been imported yet (no exploit grading). */
export function isProfilePlaceholder(profile: OpponentProfile): boolean {
  const src = profile.source;
  return !src || src.startsWith("PLACEHOLDER");
}
