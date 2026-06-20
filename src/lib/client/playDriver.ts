/**
 * Interactive 6-max play driver — a human at a fixed seat vs 5 heuristic bots.
 *
 * 100% client-side, in-memory: it wraps the existing engine state machine and
 * the existing heuristic bot brain. It NEVER touches engine/equity/EV logic — it
 * only drives the turn order: advance bots automatically, then PAUSE for the
 * human. The BotBrain interface stays pluggable (swap in smarter bots later).
 */

import { applyAction, createHand, getLegalActions, type HandConfig } from "@/engine/engine.js";
import { pot as potOf, type AtLeastTwo, type GameState, type Seat } from "@/engine/state.js";
import type { ActionInput, LegalActions } from "@/engine/actions.js";
import { buildView } from "@/sim/match.js";
import { createHeuristicBot } from "@/bots/heuristic.js";
import { createExploitBot } from "@/lib/client/exploitBot.js";
import { EMPTY_READ, type HumanRead } from "@/lib/client/humanModel.js";
import type { Bot } from "@/bots/types.js";
import type { Frame, PotView, SeatFrame } from "@/lib/client/replayMultiway.js";

/** Same EV-seeking brain every bot uses on /watch (no divergent archetypes). */
const EV_BRAIN = { tightness: 0.62, aggression: 0.6, bluffFreq: 0.12 } as const;

export interface PlayConfig {
  heroSeat?: Seat; // default 0 (bottom seat)
  seats?: number; // default 6
  smallBlind?: number; // 1
  bigBlind?: number; // 2
  ante?: number; // 2 ($1/$2 ante $2)
  startingStack?: number; // 200 (100bb)
  seed?: string;
  /** Live human read for exploitative adjustments (defaults to empty = no read). */
  getRead?: () => HumanRead;
}

export interface PlayTable {
  bots: (Bot | null)[]; // null at the hero seat
  heroSeat: Seat;
  seats: number;
  smallBlind: number;
  bigBlind: number;
  ante: number;
  startingStack: number;
  seed: string;
}

export function createPlayTable(opts: PlayConfig = {}): PlayTable {
  const seats = opts.seats ?? 6;
  const heroSeat = opts.heroSeat ?? 0;
  const seed = opts.seed ?? "play";
  const getRead = opts.getRead ?? (() => EMPTY_READ);
  let botNo = 0;
  const bots: (Bot | null)[] = Array.from({ length: seats }, (_, i) => {
    if (i === heroSeat) return null;
    botNo += 1;
    // Heuristic baseline, wrapped with the exploitative layer (no-op until the
    // read has confidence). BotBrain stays pluggable.
    const base = createHeuristicBot({ name: `Bot ${botNo}`, style: "EV", seed: `${seed}:bot${i}`, equitySamples: 240, ...EV_BRAIN });
    return createExploitBot({ base, seed: `${seed}:bot${i}`, getRead, humanSeat: heroSeat });
  });
  return {
    bots,
    heroSeat,
    seats,
    smallBlind: opts.smallBlind ?? 1,
    bigBlind: opts.bigBlind ?? 2,
    ante: opts.ante ?? 2,
    startingStack: opts.startingStack ?? 200,
    seed,
  };
}

export function seatName(table: PlayTable, seat: Seat): string {
  return seat === table.heroSeat ? "Toi" : table.bots[seat]?.name ?? `Bot ${seat}`;
}

/** Re-buy any seat too short to post the big blind to the starting stack. */
export function rebuy(table: PlayTable, stacks: number[]): number[] {
  return stacks.map((s) => (s < table.bigBlind ? table.startingStack : s));
}

/** Deal a fresh hand (no auto-advance). Stacks are taken as-is. */
export function dealHand(table: PlayTable, stacks: number[], button: Seat, handId: number): GameState {
  const players = stacks.map((stack, i) => ({ name: seatName(table, i), stack })) as AtLeastTwo<{
    name: string;
    stack: number;
  }>;
  const config: HandConfig = {
    handId,
    seed: `${table.seed}#${handId}`,
    button,
    smallBlind: table.smallBlind,
    bigBlind: table.bigBlind,
    ante: table.ante,
    players,
  };
  return createHand(config);
}

/** Run bots until it's the human's turn or the hand is complete. */
export async function advance(state: GameState, table: PlayTable): Promise<GameState> {
  let s = state;
  let guard = 0;
  while (s.street !== "complete" && s.toAct !== null && s.toAct !== table.heroSeat) {
    const bot = table.bots[s.toAct];
    if (!bot) break; // safety: should never be null for a non-hero seat
    const decision = await bot.decide(buildView(s, s.toAct));
    s = applyAction(s, decision.action);
    if (++guard > 400) throw new Error("play: hand did not terminate");
  }
  return s;
}

/** Deal a hand and immediately advance to the human (or to a fold-out end). */
export async function startHand(table: PlayTable, stacks: number[], button: Seat, handId: number): Promise<GameState> {
  return advance(dealHand(table, rebuy(table, stacks), button, handId), table);
}

/** Legal actions for the human, or null if it isn't their turn. */
export function heroLegal(state: GameState, heroSeat: Seat): LegalActions | null {
  if (state.toAct !== heroSeat || state.street === "complete" || state.street === "showdown") return null;
  return getLegalActions(state);
}

/** Apply the human's action (engine validates legality), then advance bots. */
export async function applyHuman(state: GameState, input: ActionInput, table: PlayTable): Promise<GameState> {
  return advance(applyAction(state, input), table);
}

/** Apply the human's action only (no auto-advance) — for the animated UI loop. */
export function applyHumanRaw(state: GameState, input: ActionInput): GameState {
  return applyAction(state, input);
}

/**
 * Apply exactly ONE pending bot action (for animating bot turns one-by-one), or
 * null if it's the human's turn or the hand is over.
 */
export async function botStep(state: GameState, table: PlayTable): Promise<GameState | null> {
  if (state.street === "complete" || state.toAct === null || state.toAct === table.heroSeat) return null;
  const bot = table.bots[state.toAct];
  if (!bot) return null;
  const decision = await bot.decide(buildView(state, state.toAct));
  return applyAction(state, decision.action);
}

/** Whether it's a bot's turn to act (for the UI animation loop). */
export function botToAct(state: GameState, heroSeat: Seat): boolean {
  return state.street !== "complete" && state.toAct !== null && state.toAct !== heroSeat;
}

/** Stacks to carry into the next hand. */
export function carryStacks(state: GameState): number[] {
  return state.players.map((p) => p.stack);
}

/** Human-readable label of the most recent voluntary action (for the callout). */
export function lastActionLabel(state: GameState, table: PlayTable): string | null {
  const a = [...state.actionHistory]
    .reverse()
    .find((x) => x.type !== "post-ante" && x.type !== "post-sb" && x.type !== "post-bb");
  if (!a) return null;
  const name = seatName(table, a.seat);
  // For bet/raise the actor's committed-this-street IS the "to" amount right after
  // they act (nobody has acted since), so the label reads naturally.
  const to = state.players[a.seat]?.committedThisStreet ?? a.amount;
  switch (a.type) {
    case "fold":
      return `${name} se couche`;
    case "check":
      return `${name} checke`;
    case "call":
      return `${name} suit (${a.amount})`;
    case "bet":
      return `${name} mise ${to}`;
    case "raise":
      return `${name} relance à ${to}`;
    default:
      return `${name} ${a.type}`;
  }
}

/** Build a displayable Frame for PokerTableView from the live engine state. */
export function liveFrame(state: GameState, heroSeat: Seat): Frame {
  const result = state.result;
  const terminal = result !== null;
  const awarded = result?.awarded ?? [];
  const winners = new Set<Seat>(result ? result.winners : []);
  const bets = state.players.map((p) => p.committedThisStreet);
  const totalBets = bets.reduce((a, b) => a + b, 0);
  // At terminal frames chips are collected → pot shows the full sum; otherwise
  // the central pot is the collected amount (current bets sit in front).
  const pot = terminal ? potOf(state) : potOf(state) - totalBets;

  const seats: SeatFrame[] = state.players.map((p, i) => ({
    seat: p.seat,
    name: p.name,
    position: state.positions[i]!,
    stack: p.stack,
    bet: terminal ? 0 : p.committedThisStreet,
    folded: p.folded,
    allIn: p.allIn,
    isButton: p.seat === state.button,
    isActor: state.toAct === p.seat,
    isWinner: winners.has(p.seat),
    cards: [...p.holeCards],
    // Hero's cards are always visible; villains reveal only at showdown.
    revealed: p.seat === heroSeat || (terminal && !!result?.showdown && !p.folded),
  }));
  void awarded; // (kept for symmetry with replay; not needed for the live view)

  const pots: PotView[] =
    terminal && result?.pots
      ? result.pots.filter((pt) => pt.amount > 0).map((pt, i) => ({ amount: pt.amount, label: i === 0 ? "Pot" : `Side ${i}` }))
      : [];

  const preVoluntary = state.actionHistory.filter(
    (a) => a.type !== "post-ante" && a.type !== "post-sb" && a.type !== "post-bb",
  ).length;

  return {
    kind: terminal ? "award" : preVoluntary === 0 ? "deal" : "action",
    street: state.street,
    board: [...state.board],
    pot,
    pots,
    ante: state.ante,
    seats,
    caption: "",
    toAct: state.toAct,
  };
}
