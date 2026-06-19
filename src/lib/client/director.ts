/**
 * ArenaDirector — drives a live heads-up match one action at a time, entirely
 * client-side. The engine, bots, equity and HUD are all pure TS, so the viewer
 * gets instant heuristic play with full play/pause/step control and no server
 * round-trip. (Reasoning agents later just make `bot.decide` await a fetch.)
 *
 * The director owns the game loop and exposes an immutable ArenaView snapshot
 * that React renders and Framer Motion animates between.
 */

import { applyAction, createHand, getLegalActions, type HandConfig } from "@/engine/engine.js";
import { pot as potOf, opponent, cloneState, type GameState, type HandResult, type Seat, type Street } from "@/engine/state.js";
import { computeEquity, type EquityResult } from "@/engine/equity.js";
import type { Card } from "@/engine/cards.js";
import type { Bot, DecisionView, Position } from "@/bots/types.js";
import type { DecisionRecord, HandLog } from "@/sim/match.js";
import { computeHudStats, type HandForStats, type HudStats } from "@/sim/hud.js";

export interface ArenaConfig {
  seed: string;
  smallBlind: number;
  bigBlind: number;
  startingStack: number;
  /** Equity iterations for the preflop Monte-Carlo truth layer. */
  equityIterations?: number;
}

export interface PlayerView {
  seat: Seat;
  name: string;
  style?: string;
  stack: number;
  committedThisStreet: number;
  committedTotal: number;
  holeCards: Card[];
  folded: boolean;
  allIn: boolean;
  isButton: boolean;
  isToAct: boolean;
  position: Position;
}

export interface ThoughtView {
  seat: Seat;
  street: Street;
  actionType: string;
  amount: number;
  reasoning?: string;
  confidence?: number;
  perceivedEquity?: number;
}

export interface ArenaView {
  handId: number;
  handIndex: number;
  handsPlayed: number;
  street: Street;
  button: Seat;
  toAct: Seat | null;
  pot: number;
  smallBlind: number;
  bigBlind: number;
  currentBet: number;
  board: Card[];
  players: [PlayerView, PlayerView];
  bots: [{ name: string; style?: string }, { name: string; style?: string }];
  decisions: DecisionRecord[];
  thoughts: [ThoughtView | null, ThoughtView | null];
  equity: {
    true: [number, number] | null;
    exact: boolean;
    perceived: [number | null, number | null];
  };
  hud: [HudStats, HudStats];
  sessionNet: [number, number];
  result: HandResult | null;
  isComplete: boolean;
  lastEvent: ArenaEvent;
}

export type ArenaEvent = "idle" | "deal" | "action" | "street" | "showdown";

export class ArenaDirector {
  private config: ArenaConfig;
  private bots: [Bot, Bot];
  private state: GameState | null = null;
  private stacks: [number, number];
  private button: Seat = 0;
  private handIndex = 0;
  private decisions: DecisionRecord[] = [];
  private thoughts: [ThoughtView | null, ThoughtView | null] = [null, null];
  private completed: HandForStats[] = [];
  private sessionNet: [number, number] = [0, 0];
  private lastEvent: ArenaEvent = "idle";
  private equityCache = new Map<string, EquityResult>();
  private finalizedHandIndex = -1;
  private currentConfig: HandConfig | null = null;
  private currentHoleCards: [string[], string[]] | null = null;
  private completedLogs: HandLog[] = [];

  constructor(config: ArenaConfig, bots: [Bot, Bot]) {
    this.config = config;
    this.bots = bots;
    this.stacks = [config.startingStack, config.startingStack];
  }

  /** Advance one step: deal a new hand if the last is complete, else one action. */
  async step(): Promise<void> {
    if (this.state === null || this.state.street === "complete") {
      this.startHand();
      return;
    }
    await this.act();
  }

  private startHand(): void {
    // Re-buy both players each hand (cash-game style) so the match runs forever.
    this.stacks = [this.config.startingStack, this.config.startingStack];
    this.decisions = [];
    this.thoughts = [null, null];
    this.equityCache.clear();
    this.currentConfig = {
      handId: this.handIndex,
      seed: this.config.seed,
      button: this.button,
      smallBlind: this.config.smallBlind,
      bigBlind: this.config.bigBlind,
      players: [
        { name: this.bots[0].name, stack: this.stacks[0] },
        { name: this.bots[1].name, stack: this.stacks[1] },
      ],
    };
    this.state = createHand(this.currentConfig);
    this.currentHoleCards = [
      [...this.state.players[0].holeCards],
      [...this.state.players[1].holeCards],
    ];
    this.lastEvent = "deal";
  }

  private async act(): Promise<void> {
    const state = this.state!;
    const seat = state.toAct!;
    const streetBefore = state.street;
    const view = this.buildDecisionView(state, seat);
    const decision = await this.bots[seat]!.decide(view);

    this.decisions.push({
      index: this.decisions.length,
      seat,
      street: state.street,
      action: decision.action,
      potBefore: view.pot,
      toCall: view.toCall,
      reasoning: decision.reasoning,
      confidence: decision.confidence,
      perceivedEquity: decision.perceivedEquity,
    });
    this.thoughts[seat] = {
      seat,
      street: state.street,
      actionType: decision.action.type,
      amount: "to" in decision.action ? decision.action.to : 0,
      reasoning: decision.reasoning,
      confidence: decision.confidence,
      perceivedEquity: decision.perceivedEquity,
    };

    this.state = applyAction(state, decision.action);

    if (this.state.street === "complete") {
      this.finalizeHand();
      this.lastEvent = "showdown";
    } else if (this.state.street !== streetBefore) {
      this.lastEvent = "street";
    } else {
      this.lastEvent = "action";
    }
  }

  private finalizeHand(): void {
    const state = this.state!;
    if (this.finalizedHandIndex === this.handIndex) return;
    const result = state.result!;
    this.completed.push({
      button: this.button,
      bigBlind: this.config.bigBlind,
      actionHistory: state.actionHistory,
      showdown: result.showdown,
      winners: result.winners,
      net: result.net,
    });
    this.sessionNet = [this.sessionNet[0] + result.net[0], this.sessionNet[1] + result.net[1]];
    // Retain the full hand log so any past hand can be replayed/scrubbed.
    if (this.currentConfig && this.currentHoleCards) {
      this.completedLogs.push({
        config: this.currentConfig,
        state: cloneState(state),
        decisions: [...this.decisions],
        holeCards: this.currentHoleCards,
      });
      if (this.completedLogs.length > 300) this.completedLogs.shift();
    }
    this.finalizedHandIndex = this.handIndex;
    // Set up the next hand.
    this.handIndex += 1;
    this.button = opponent(this.button);
  }

  private buildDecisionView(state: GameState, seat: Seat): DecisionView {
    const me = state.players[seat]!;
    const opp = state.players[opponent(seat)]!;
    const legal = getLegalActions(state);
    return {
      handId: state.handId,
      seat,
      street: state.street,
      position: seat === state.button ? "button" : "bigBlind",
      holeCards: me.holeCards,
      board: state.board,
      pot: potOf(state),
      toCall: legal.toCall,
      myStack: me.stack,
      oppStack: opp.stack,
      myCommittedThisStreet: me.committedThisStreet,
      oppCommittedThisStreet: opp.committedThisStreet,
      bigBlind: state.bigBlind,
      legal,
      actionHistory: state.actionHistory,
    };
  }

  /** True all-in equity for the two live hands at the current board (cached per street). */
  private trueEquity(state: GameState): { eq: [number, number]; exact: boolean } | null {
    if (state.players[0].holeCards.length < 2 || state.players[1].holeCards.length < 2) return null;
    const key = `${state.handId}:${state.board.length}`;
    let cached = this.equityCache.get(key);
    if (!cached) {
      cached = computeEquity(
        state.players[0].holeCards,
        state.players[1].holeCards,
        state.board,
        { iterations: this.config.equityIterations ?? 1500, seed: key },
      );
      this.equityCache.set(key, cached);
    }
    return { eq: cached.equity, exact: cached.exact };
  }

  getView(): ArenaView {
    const state = this.state;
    if (!state) {
      // Pre-game placeholder.
      return this.emptyView();
    }
    const truth = this.trueEquity(state);
    const perceived: [number | null, number | null] = [
      this.thoughts[0]?.perceivedEquity ?? null,
      this.thoughts[1]?.perceivedEquity ?? null,
    ];

    const mkPlayer = (seat: Seat): PlayerView => {
      const p = state.players[seat]!;
      return {
        seat,
        name: p.name,
        style: this.bots[seat]!.style,
        stack: p.stack,
        committedThisStreet: p.committedThisStreet,
        committedTotal: p.committedTotal,
        holeCards: p.holeCards,
        folded: p.folded,
        allIn: p.allIn,
        isButton: seat === state.button,
        isToAct: seat === state.toAct,
        position: seat === state.button ? "button" : "bigBlind",
      };
    };

    return {
      handId: state.handId,
      handIndex: this.handIndex,
      handsPlayed: this.completed.length,
      street: state.street,
      button: state.button,
      toAct: state.toAct,
      pot: potOf(state),
      smallBlind: state.smallBlind,
      bigBlind: state.bigBlind,
      currentBet: state.currentBet,
      board: state.board,
      players: [mkPlayer(0), mkPlayer(1)],
      bots: [
        { name: this.bots[0].name, style: this.bots[0].style },
        { name: this.bots[1].name, style: this.bots[1].style },
      ],
      decisions: this.decisions,
      thoughts: this.thoughts,
      equity: {
        true: truth?.eq ?? null,
        exact: truth?.exact ?? false,
        perceived,
      },
      hud: [computeHudStats(this.completed, 0), computeHudStats(this.completed, 1)],
      sessionNet: this.sessionNet,
      result: state.result,
      isComplete: state.street === "complete",
      lastEvent: this.lastEvent,
    };
  }

  private emptyView(): ArenaView {
    const hud0 = computeHudStats([], 0);
    const hud1 = computeHudStats([], 1);
    return {
      handId: 0,
      handIndex: 0,
      handsPlayed: 0,
      street: "preflop",
      button: 0,
      toAct: null,
      pot: 0,
      smallBlind: this.config.smallBlind,
      bigBlind: this.config.bigBlind,
      currentBet: 0,
      board: [],
      players: [
        this.placeholderPlayer(0),
        this.placeholderPlayer(1),
      ],
      bots: [
        { name: this.bots[0].name, style: this.bots[0].style },
        { name: this.bots[1].name, style: this.bots[1].style },
      ],
      decisions: [],
      thoughts: [null, null],
      equity: { true: null, exact: false, perceived: [null, null] },
      hud: [hud0, hud1],
      sessionNet: [0, 0],
      result: null,
      isComplete: false,
      lastEvent: "idle",
    };
  }

  private placeholderPlayer(seat: Seat): PlayerView {
    return {
      seat,
      name: this.bots[seat]!.name,
      style: this.bots[seat]!.style,
      stack: this.config.startingStack,
      committedThisStreet: 0,
      committedTotal: 0,
      holeCards: [],
      folded: false,
      allIn: false,
      isButton: seat === this.button,
      isToAct: false,
      position: seat === this.button ? "button" : "bigBlind",
    };
  }

  /** The completed-hand history (for the action log / replay / persistence). */
  getCompletedCount(): number {
    return this.completed.length;
  }

  /** Live HUD of the given seat across completed hands this session. */
  opponentHudOf(seat: Seat): HudStats {
    return computeHudStats(this.completed, seat);
  }

  /** Full logs of completed hands, newest last — for replay scrubbing. */
  getHistory(): HandLog[] {
    return this.completedLogs;
  }
}
