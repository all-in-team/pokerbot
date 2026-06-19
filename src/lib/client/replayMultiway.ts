/**
 * Multiway replay reconstruction (2..6 players), client-safe.
 *
 * A stored HandLog (config + the exact action sequence) is deterministically
 * re-run through the engine to produce one displayable Frame per step — deal,
 * each action, then showdown + award — so the viewer can animate any hand
 * without re-implementing game logic. Imports ONLY the pure engine.
 */

import { applyAction, createHand } from "@/engine/engine.js";
import { handCategoryFr } from "@/engine/evaluator.js";
import { pot as potOf, type ActionType, type GameState, type Position, type Seat } from "@/engine/state.js";
import type { HandLog } from "@/sim/match.js";

export type FrameKind = "deal" | "action" | "board" | "showdown" | "award";

export interface SeatFrame {
  seat: Seat;
  name: string;
  position: Position;
  /** Chips behind. */
  stack: number;
  /** Chips committed on the current street (the "bet" in front of the seat). */
  bet: number;
  folded: boolean;
  allIn: boolean;
  isButton: boolean;
  /** This seat is the one to act on this frame. */
  isActor: boolean;
  /** This seat won (part of) the pot — set on the award frame. */
  isWinner: boolean;
  /** Hole cards as dealt. */
  cards: string[];
  /** Whether these cards are turned face-up on this frame (showdown). */
  revealed: boolean;
}

export interface PotView {
  amount: number;
  label: string; // "Pot" (main) / "Side 1" / "Side 2" …
}

export interface Frame {
  kind: FrameKind;
  street: GameState["street"];
  board: string[];
  /** Chips already collected in the middle (current-street bets shown per seat). */
  pot: number;
  /** Side-pot breakdown on the award frame; empty otherwise. */
  pots: PotView[];
  /** Ante posted by every player this hand (for the ante chips). */
  ante: number;
  seats: SeatFrame[];
  caption: string;
  toAct: Seat | null;
  /** The voluntary action on this frame (action/board frames), for log tags. */
  actionType?: ActionType;
}

interface FrameOpts {
  kind: FrameKind;
  caption: string;
  /** Turn non-folded hole cards face up. */
  reveal: boolean;
  /** Highlight the result winners. */
  showWinners: boolean;
  /** Award frame: chips are pushed (pot → 0, stacks final). */
  pushed: boolean;
}

function buildFrame(state: GameState, opts: FrameOpts): Frame {
  const result = state.result;
  const awarded = result?.awarded ?? [];
  const winners = opts.showWinners && result ? new Set<Seat>(result.winners) : new Set<Seat>();

  // A hand-ending frame (showdown or win-by-fold) is "terminal": chips are
  // collected into the pot for display, so the central pot shows the full sum
  // (the climax displays the amount won — no "POT 0") and NOTHING lingers in
  // front of any seat (no ghost bet chips). Note: a win by fold resolves without
  // the engine sweeping committedThisStreet, so we collect it here at display.
  const terminal = result !== null;
  const totalBets = state.players.reduce((a, p) => a + p.committedThisStreet, 0);
  const pot = terminal ? potOf(state) : potOf(state) - totalBets;

  const seats: SeatFrame[] = state.players.map((p, i) => {
    // Pre-award frames (result set but chips not yet "pushed" in the animation)
    // show each seat short by what it ultimately gets back.
    const stack = result && !opts.pushed ? p.stack - (awarded[i] ?? 0) : p.stack;
    return {
      seat: p.seat,
      name: p.name,
      position: state.positions[i]!,
      stack,
      bet: terminal ? 0 : p.committedThisStreet,
      folded: p.folded,
      allIn: p.allIn,
      isButton: p.seat === state.button,
      isActor: state.toAct === p.seat,
      isWinner: winners.has(p.seat),
      cards: [...p.holeCards],
      revealed: opts.reveal && !p.folded,
    };
  });

  const pots: PotView[] =
    opts.pushed && result?.pots
      ? result.pots
          .filter((pt) => pt.amount > 0)
          .map((pt, i) => ({ amount: pt.amount, label: i === 0 ? "Pot" : `Side ${i}` }))
      : [];

  return {
    kind: opts.kind,
    street: state.street,
    board: [...state.board],
    pot,
    pots,
    ante: state.ante,
    seats,
    caption: opts.caption,
    toAct: state.toAct,
  };
}

function awardCaption(state: GameState): string {
  const r = state.result!;
  const names = r.winners.map((s) => state.players[s]!.name).join(" & ");
  const total = r.winners.reduce((a, s) => a + (r.awarded[s] ?? 0), 0);
  // Win by fold: no cards shown ⇒ no hand category.
  if (!r.showdown) return `${names} remporte le pot (${total})`;
  // At showdown: name the winning hand straight from the engine's evaluator.
  const w = r.winners[0]!;
  const category = handCategoryFr([...state.players[w]!.holeCards, ...state.board]);
  const verb = r.winners.length > 1 ? "se partagent" : "gagne";
  return `${names} ${verb} ${total} · ${category}`;
}

/** Re-run a logged hand into an ordered list of displayable frames. */
export function replayMultiway(log: HandLog): Frame[] {
  let state = createHand(log.config);
  const frames: Frame[] = [
    buildFrame(state, { kind: "deal", caption: "Cartes distribuées · blinds postées", reveal: false, showWinners: false, pushed: false }),
  ];

  for (const d of log.decisions) {
    const seat = d.seat;
    const name = state.players[seat]!.name;
    const amount = "to" in d.action ? d.action.to : 0;
    const verb = amount ? `${d.action.type} ${amount}` : d.action.type;
    const boardBefore = state.board.length;

    state = applyAction(state, d.action);

    const boardGrew = state.board.length > boardBefore;
    const f = buildFrame(state, {
      kind: boardGrew ? "board" : "action",
      caption: `${name} : ${verb}`,
      reveal: false,
      showWinners: false,
      pushed: false,
    });
    f.actionType = d.action.type;
    frames.push(f);
  }

  // Terminal beats: reveal at showdown, then push the pot to the winner(s).
  if (state.result) {
    if (state.result.showdown) {
      frames.push(
        buildFrame(state, { kind: "showdown", caption: "Abattage", reveal: true, showWinners: false, pushed: false }),
      );
    }
    frames.push(
      buildFrame(state, {
        kind: "award",
        caption: awardCaption(state),
        reveal: state.result.showdown,
        showWinners: true,
        pushed: true,
      }),
    );
  }

  return frames;
}

/** Suggested dwell time (ms) for a frame kind, before the speed multiplier. */
export const FRAME_MS: Record<FrameKind, number> = {
  deal: 600,
  action: 950,
  board: 1200,
  showdown: 1600,
  award: 2000,
};
