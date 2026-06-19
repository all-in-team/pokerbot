/**
 * Spot model + loader for the Spot Trainer.
 *
 * The `solution` block is the STORED solver truth (PioSOLVER / GTO Wizard
 * exports). The trainer — and any future LLM layer — only ever READ these
 * numbers. They never compute or invent GTO frequencies: the LLM will only
 * EXPLAIN a stored solution in natural language, never calculate one.
 *
 * Spots whose `solution.source` is missing or starts with "PLACEHOLDER" have
 * NOT been imported yet (all freq/ev are 0). The UI must flag them as
 * un-verified rather than presenting `0%` / `EV 0` as if it were real truth.
 * See `isSolutionPlaceholder()`.
 */
import spotsData from "@/data/spots.json";

export type Action = "fold" | "call" | "raise";

export interface SolutionAction {
  action: Action;
  sizing?: number;
  /** Mixed-strategy weight in [0,1], straight from the solver export. */
  frequency: number;
  /** EV (big blinds / chips), straight from the solver export. */
  ev: number;
}

export interface SpotPlayer {
  id: string;
  name: string;
  pos: "SB" | "BB" | "UTG" | "HJ" | "CO" | "BTN";
  stack: number;
  folded?: boolean;
  dealer?: boolean;
  /** Chips this player has out on the current street (e.g. the villain c-bet). */
  bet?: number;
}

export interface Spot {
  id: string;
  /** Human axis label, e.g. "BB defense vs c-bet". */
  axis: string;
  stakes: { sb: number; bb: number; ante: number };
  /** Poker semantics only — NO UI coordinates (the table maps pos → seat). */
  players: SpotPlayer[];
  /** Community cards, e.g. ["Qs","7d","2c"]; empty preflop. */
  board: string[];
  heroCards: [string, string];
  /**
   * Which seat the hero is sitting in (heroCards belong to this player).
   * Needed because SpotPlayer carries no hero flag and heroCards live at the
   * spot level — this links the two without baking UI assumptions into players.
   */
  heroId: string;
  pot: number;
  toCall: number;
  minRaise: number;
  solution: {
    /**
     * 'gto' = equilibrium solution. 'exploit' = best-response vs a fixed
     * opponent profile (`vsProfile`). EV truth always comes from a STORED solver
     * export in both modes — never from an LLM.
     */
    mode: "gto" | "exploit";
    /** Opponent profile id (OpponentProfile), required when mode === 'exploit'. */
    vsProfile?: string;
    bestAction: Action;
    actions: SolutionAction[];
    /**
     * Optional GTO baseline to compare against in exploit mode (the teaching
     * moment: "GTO would X, vs this profile exploit is Y"). Both come from
     * stored solver data; nothing is computed here.
     */
    baselineGto?: { bestAction: Action; actions: SolutionAction[] };
    /**
     * Provenance of the solution. Until a real export is imported this is a
     * "PLACEHOLDER …" string and every freq/ev below is 0. Replace with the
     * actual source (e.g. "PioSOLVER 3.0" / "GTO Wizard") when importing.
     */
    source?: string;
  };
}

const SPOTS = spotsData as unknown as Spot[];

export function listSpots(): Spot[] {
  return SPOTS;
}

export function getSpot(id: string): Spot | undefined {
  return SPOTS.find((s) => s.id === id);
}

/** True when the solver truth for this spot has not been imported yet. */
export function isSolutionPlaceholder(spot: Spot): boolean {
  const src = spot.solution.source;
  return !src || src.startsWith("PLACEHOLDER");
}
