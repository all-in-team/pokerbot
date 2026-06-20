/**
 * UNIFIED EV DECISION ENGINE — the single brain for every bot, every street.
 *
 * Principle: the ENGINE owns all the numbers (equity, EV, pot odds), COMPUTED via
 * the truth-layer evaluator — never invented. There are NO hard-coded poker rules
 * ("fold 26o", "call AA"). Every decision is the argmax of EV over the legal
 * actions, so it is contextual BY CONSTRUCTION (the same maths folds 72o to a HU
 * shove and calls it for 50:1 multiway, automatically).
 *
 * Only the opponents' RANGE ASSUMPTIONS are modelled (priors + a simple
 * continue-threshold). The exploit layer skews ONLY those assumptions, before the
 * maths — never the final argmax.
 *
 * Pure decision layer: reuses the engine evaluator; never touches engine/EV logic.
 */

import { evaluate, compare } from "../engine/evaluator.js";
import { freshDeck, rankValue, type Card } from "../engine/cards.js";
import { createRng, type Rng } from "../engine/rng.js";
import { clampToLegal, sizeToFromPotFraction } from "./util.js";
import { PREFLOP_RANGES } from "../data/preflop-ranges.js";
import { comboKey } from "../lib/preflop/preflopLookup.js";
import type { ActionInput } from "../engine/actions.js";
import type { Decision, DecisionView } from "./types.js";
import type { Seat } from "../engine/state.js";
import type { HumanRead } from "../lib/client/humanModel.js";

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const clamp = (x: number, lo: number, hi: number) => (x < lo ? lo : x > hi ? hi : x);
const logistic = (x: number) => 1 / (1 + Math.exp(-x));
const pct = (x: number) => `${Math.round(x * 100)}%`;

// ── Starting-hand strength (Chen-like, normalized) — used to RANK/sample ranges
//    and as the preflop "made strength". Self-contained (no import cycle). ───────
function comboStrength(c1: Card, c2: Card): number {
  const a = rankValue(c1);
  const b = rankValue(c2);
  const hi = Math.max(a, b);
  const lo = Math.min(a, b);
  const suited = c1[1] === c2[1];
  const hc = (r: number) => (r === 14 ? 10 : r === 13 ? 8 : r === 12 ? 7 : r === 11 ? 6 : r / 2);
  let s: number;
  if (a === b) {
    s = Math.max(5, hc(hi) * 2);
  } else {
    s = hc(hi);
    if (suited) s += 2;
    const gap = hi - lo - 1;
    if (gap === 1) s -= 1;
    else if (gap === 2) s -= 2;
    else if (gap === 3) s -= 4;
    else if (gap >= 4) s -= 5;
    if (gap <= 1 && hi < 12) s += 1;
  }
  return clamp01(s / 20);
}

// All 1326 combos ranked by strength (descending). "Top width%" = a prefix slice.
const RANKED_COMBOS: [Card, Card][] = (() => {
  const deck = freshDeck();
  const out: [Card, Card][] = [];
  for (let i = 0; i < deck.length; i++) {
    for (let j = i + 1; j < deck.length; j++) out.push([deck[i]!, deck[j]!]);
  }
  out.sort((p, q) => comboStrength(q[0], q[1]) - comboStrength(p[0], p[1]));
  return out;
})();

// ── Opener priors from the preflop range tables (prior only, NOT a decider). ────
function comboCountOf(notation: string): number {
  if (notation.length === 2) return 6; // pair
  return notation.endsWith("s") ? 4 : 12; // suited / offsuit
}
const OPENER_WIDTH: Record<string, number> = (() => {
  const out: Record<string, number> = {};
  for (const pos of ["UTG", "HJ", "CO", "BTN", "SB"]) {
    const table = PREFLOP_RANGES[`RFI:${pos}`];
    if (!table) continue;
    let combos = 0;
    for (const [k, a] of Object.entries(table.combos)) if (a.raise > 0) combos += comboCountOf(k);
    out[pos] = clamp(combos / 1326, 0.05, 1);
  }
  return out;
})();
function openerWidthFor(pos: string): number {
  return OPENER_WIDTH[pos] ?? (pos === "BTN" ? 0.45 : pos === "CO" ? 0.3 : pos === "SB" ? 0.4 : 0.18);
}

// ── Exploit skew: deform the assumed range params from the human read, BEFORE the
//    EV maths. Skews ONLY assumptions, only for the human seat. ─────────────────
export interface RangeParams {
  /** Top fraction of starting hands the opponent is assumed to hold (0..1). */
  width: number;
  /** Added to the postflop continue-threshold (+ = continues tighter = more fold equity). */
  contShift: number;
}

export function skewRange(base: RangeParams, read: HumanRead | null, isHuman: boolean): RangeParams {
  if (!isHuman || !read || read.weight <= 0) return base;
  const w = read.weight;
  let width = base.width;
  let contShift = base.contShift;
  // Over-folder → assume a tighter continuation range → more fold equity (bluffs +EV).
  if (read.foldToCbet > 0.5) contShift += w * (read.foldToCbet - 0.5) * 0.7;
  // Calling station → wider continuation range → less fold equity, thinner value.
  if (read.foldToCbet < 0.4 && read.wtsd > 0.4) contShift -= w * ((0.4 - read.foldToCbet) * 0.7 + 0.06);
  // Too tight preflop → narrower prior; too loose → wider prior.
  if (read.vpip < 0.22) width *= 1 - w * 0.4;
  else if (read.vpip > 0.4) width *= 1 + w * 0.4;
  return { width: clamp(width, 0.04, 1), contShift };
}

// ── Assumed range width for an opponent, from position + betting line (prior). ──
function priorWidth(view: DecisionView, oppSeat: Seat, oppPosition: string): number {
  const pre = view.actionHistory.filter((a) => a.street === "preflop");
  const oppPre = pre.filter((a) => a.seat === oppSeat);
  const raisedPre = oppPre.some((a) => a.type === "raise" || a.type === "bet");
  const calledPre = oppPre.some((a) => a.type === "call");
  const preRaises = pre.filter((a) => a.type === "raise" || a.type === "bet");

  let w: number;
  if (raisedPre) {
    const firstRaiseSeat = preRaises[0]?.seat;
    const reRaised = preRaises.length >= 2 && firstRaiseSeat !== oppSeat;
    w = reRaised ? 0.06 : openerWidthFor(oppPosition); // 3bet+ much tighter
  } else if (calledPre) {
    w = 0.3;
  } else {
    w = oppPosition === "BB" || oppPosition === "SB" ? 0.55 : 0.4;
  }
  // Later-street aggression tightens the continuing range.
  const post = view.actionHistory.filter((a) => a.street !== "preflop" && a.seat === oppSeat);
  if (post.some((a) => a.type === "bet" || a.type === "raise")) w *= 0.6;
  return clamp(w, 0.04, 1);
}

// Cheap made-hand strength of a combo on the current board (continue model only —
// hero's true equity always comes from the evaluator). 0..1.
function madeStrength(c1: Card, c2: Card, board: Card[]): number {
  if (board.length === 0) return comboStrength(c1, c2);
  const br = board.map(rankValue);
  const top = Math.max(...br);
  const bot = Math.min(...br);
  const r1 = rankValue(c1);
  const r2 = rankValue(c2);
  const m1 = br.includes(r1);
  const m2 = br.includes(r2);
  let s: number;
  if (r1 === r2) {
    s = br.includes(r1) ? 0.95 : 0.5 + (r1 - 2) / 28; // set, else overpair-ish
  } else if (m1 && m2) {
    s = 0.82; // two pair
  } else if (m1 || m2) {
    const pr = m1 ? r1 : r2;
    s = pr >= top ? 0.62 : pr > bot ? 0.45 : 0.38; // top / middle / bottom pair
  } else {
    s = 0.16 + Math.max(r1, r2) / 45; // overcards / air
  }
  if (c1[1] === c2[1]) {
    const fd = board.filter((c) => c[1] === c1[1]).length;
    if (fd >= 2) s = Math.max(s, 0.5); // flush draw keeps continuing
  }
  return clamp01(s);
}

// ── Equity Monte-Carlo (single pass, reweighted per bet size). Cached by content
//    so it stays deterministic AND fast (preflop spots recur heavily). ──────────
interface OppParam {
  width: number; // bucketed
  contShift: number;
}
interface McResult {
  /** Hero equity vs the full assumed range (for call / showdown value). */
  eFull: number;
  /** Per-sample hero outcome (0 / 1/k / 1). */
  outcomes: number[];
  /** Per-sample opponent made-strengths on the current board, [sample][opp]. */
  oppStr: number[][];
  nOpps: number;
}

const mcCache = new Map<string, McResult>();
const MC_CACHE_CAP = 6000;

function sampleCombo(width: number, used: Set<Card>, rng: Rng): [Card, Card] {
  const cut = Math.max(6, Math.floor(width * RANKED_COMBOS.length));
  for (let t = 0; t < 48; t++) {
    const combo = RANKED_COMBOS[rng.int(cut)]!;
    if (!used.has(combo[0]) && !used.has(combo[1])) return combo;
  }
  // Fallback: first legal combo in the slice, else any two free cards.
  for (let i = 0; i < cut; i++) {
    const combo = RANKED_COMBOS[i]!;
    if (!used.has(combo[0]) && !used.has(combo[1])) return combo;
  }
  const free = freshDeck().filter((c) => !used.has(c));
  return [free[0]!, free[1]!];
}

function runMc(hero: [Card, Card], board: Card[], opps: OppParam[], iterations: number): McResult {
  const preflop = board.length === 0;
  const heroKey = preflop ? comboKey(hero) : [...hero].sort().join("");
  const key = `${heroKey}|${[...board].sort().join("")}|${opps.map((o) => o.width.toFixed(2)).join(",")}|${iterations}`;
  const hit = mcCache.get(key);
  if (hit) return hit;

  const rng = createRng(`evmc#${key}`);
  const dead0 = new Set<Card>([...hero, ...board]);
  const toCome = 5 - board.length;
  const outcomes: number[] = [];
  const oppStr: number[][] = [];
  let eSum = 0;

  for (let k = 0; k < iterations; k++) {
    const used = new Set<Card>(dead0);
    const hands: [Card, Card][] = [];
    const strengths: number[] = [];
    for (const o of opps) {
      const c = sampleCombo(o.width, used, rng);
      used.add(c[0]);
      used.add(c[1]);
      hands.push(c);
      strengths.push(madeStrength(c[0], c[1], board));
    }
    // Complete the board from the remaining deck.
    const avail = freshDeck().filter((c) => !used.has(c));
    const full = board.slice();
    for (let d = 0; d < toCome; d++) {
      const idx = d + rng.int(avail.length - d);
      const tmp = avail[d]!;
      avail[d] = avail[idx]!;
      avail[idx] = tmp;
      full.push(avail[d]!);
    }
    const hero7 = [hero[0], hero[1], ...full];
    const heroEval = evaluate(hero7);
    let lose = false;
    let ties = 1;
    for (const h of hands) {
      const opp7 = [h[0], h[1], ...full];
      const oe = evaluate(opp7);
      if (oe.rank > heroEval.rank) {
        lose = true;
        break;
      }
      if (oe.rank < heroEval.rank) continue;
      const c = compare(hero7, opp7);
      if (c < 0) {
        lose = true;
        break;
      }
      if (c === 0) ties++;
    }
    const outcome = lose ? 0 : 1 / ties;
    eSum += outcome;
    outcomes.push(outcome);
    oppStr.push(strengths);
  }

  const result: McResult = { eFull: eSum / iterations, outcomes, oppStr, nOpps: opps.length };
  if (mcCache.size >= MC_CACHE_CAP) mcCache.clear();
  mcCache.set(key, result);
  return result;
}

// ── Public decision API ────────────────────────────────────────────────────────

export interface EvConfig {
  seed: string;
  /** Monte-Carlo iterations per decision (more = smoother, slower). */
  evSamples?: number;
  /** Live human read + which seat is the human, for range skew. */
  getRead?: () => HumanRead;
  humanSeat?: Seat;
  /** Softmax temperature scale (variety among near-EV actions). 0..1. */
  mix?: number;
}

export interface EvCandidate {
  label: string;
  kind: "fold" | "check" | "call" | "bet" | "raise";
  action: ActionInput;
  ev: number;
}

export interface EvTrace {
  street: string;
  equity: number;
  potOdds: number | null;
  rangeSummary: string;
  candidates: EvCandidate[];
  chosen: string;
  foldEv: number | null;
}

const POT_FRACTIONS: { label: string; f: number }[] = [
  { label: "1/3", f: 1 / 3 },
  { label: "1/2", f: 1 / 2 },
  { label: "2/3", f: 2 / 3 },
  { label: "pot", f: 1 },
];

/** The unified EV decision. ALWAYS returns a legal action; never crashes. */
export function decideEV(view: DecisionView, cfg: EvConfig, rng: Rng): Decision & { trace: EvTrace } {
  const legal = view.legal;
  const potNow = view.pot;
  const toCall = view.toCall;
  const heroCommitted = view.myCommittedThisStreet;
  const currentBet = heroCommitted + toCall;
  const bb = view.bigBlind || 1;
  const iterations = Math.max(8, cfg.evSamples ?? 80);
  const hero = [view.holeCards[0]!, view.holeCards[1]!] as [Card, Card];
  const board = view.board;

  const read = cfg.getRead ? cfg.getRead() : null;

  // Build assumed range params for each ACTIVE opponent (prior + exploit skew).
  const opponents = (view.opponents ?? []).filter((o) => !o.folded);
  const oppParams: OppParam[] = opponents.map((o) => {
    const base: RangeParams = { width: priorWidth(view, o.seat, o.position), contShift: 0 };
    const skewed = skewRange(base, read, cfg.humanSeat != null && o.seat === cfg.humanSeat);
    return { width: clamp(Math.round(skewed.width / 0.02) * 0.02, 0.04, 1), contShift: skewed.contShift };
  });
  // Guardrail: if no opponent info, assume one default opponent (never crash / never bias to fold).
  if (oppParams.length === 0) oppParams.push({ width: 0.5, contShift: 0 });

  let mc: McResult;
  try {
    mc = runMc(hero, board, oppParams, iterations);
  } catch {
    // Absolute fallback — coin-flip equity vs one default range, never throw.
    mc = { eFull: 0.5, outcomes: [], oppStr: [], nOpps: oppParams.length };
  }
  const eFull = mc.eFull;
  const K = mc.outcomes.length || 1;

  // Fold-equity + continuation equity for a given bet pot-fraction (reweight MC).
  const sizeStats = (f: number) => {
    if (mc.outcomes.length === 0) return { pAllFold: 0, eCont: eFull, expCallers: oppParams.length };
    const sumCont = new Array(oppParams.length).fill(0);
    let contWeightSum = 0;
    let eContSum = 0;
    for (let s = 0; s < K; s++) {
      let cw = 1;
      const strengths = mc.oppStr[s]!;
      for (let i = 0; i < oppParams.length; i++) {
        const thr = clamp(0.3 + 0.18 * f + oppParams[i]!.contShift, 0.05, 0.97);
        const p = logistic(10 * (strengths[i]! - thr));
        cw *= p;
        sumCont[i] += p;
      }
      contWeightSum += cw;
      eContSum += mc.outcomes[s]! * cw;
    }
    let pAllFold = 1;
    let expCallers = 0;
    for (let i = 0; i < oppParams.length; i++) {
      const meanCont = sumCont[i] / K;
      pAllFold *= 1 - meanCont;
      expCallers += meanCont;
    }
    const eCont = contWeightSum > 1e-9 ? eContSum / contWeightSum : eFull;
    return { pAllFold, eCont, expCallers };
  };

  // ── Candidate actions + their EV (fold = 0 baseline). ──
  const cands: EvCandidate[] = [];
  if (legal.canFold) cands.push({ label: "fold", kind: "fold", action: { type: "fold" }, ev: 0 });
  if (legal.canCheck) cands.push({ label: "check", kind: "check", action: { type: "check" }, ev: eFull * potNow });
  if (legal.canCall) cands.push({ label: "call", kind: "call", action: { type: "call" }, ev: eFull * (potNow + toCall) - toCall });

  if (legal.canBet || legal.canRaise) {
    const kind = legal.aggressiveType; // "bet" | "raise"
    const seen = new Set<number>();
    const sizeDefs = [...POT_FRACTIONS, { label: "all-in", f: Number.POSITIVE_INFINITY }];
    for (const sd of sizeDefs) {
      const to = sd.f === Number.POSITIVE_INFINITY ? legal.maxTo : sizeToFromPotFraction(sd.f, potNow, heroCommitted, currentBet, legal);
      if (seen.has(to)) continue;
      seen.add(to);
      const risked = to - heroCommitted;
      if (risked <= 0) continue;
      const fEff = clamp((to - currentBet) / Math.max(1, potNow), 0.05, 6);
      const { pAllFold, eCont, expCallers } = sizeStats(fEff);
      const potAfter = potNow + risked + risked * expCallers;
      const ev = pAllFold * potNow + (1 - pAllFold) * (eCont * potAfter - risked);
      cands.push({ label: `${kind} ${sd.label}`, kind, action: { type: kind, to }, ev });
    }
  }

  // Guardrail: there is always at least one legal candidate.
  if (cands.length === 0) {
    const fallback: ActionInput = legal.canCheck ? { type: "check" } : legal.canCall ? { type: "call" } : { type: "fold" };
    cands.push({ label: fallback.type, kind: fallback.type as EvCandidate["kind"], action: fallback, ev: 0 });
  }

  // ── argmax + light softmax mixing among near-EV actions (never below fold). ──
  const best = Math.max(...cands.map((c) => c.ev));
  const floor = legal.canFold ? 0 : Number.NEGATIVE_INFINITY;
  const eps = 0.05 * (potNow + bb) * (1 + (cfg.mix ?? 1));
  const pool = cands.filter((c) => c.ev >= best - eps && c.ev >= floor);
  const temp = Math.max(1e-6, eps * 0.6);
  const weights = pool.map((c) => Math.exp((c.ev - best) / temp));
  const total = weights.reduce((a, b) => a + b, 0);
  let r = rng.next() * total;
  let chosen = pool[pool.length - 1]!;
  for (let i = 0; i < pool.length; i++) {
    r -= weights[i]!;
    if (r <= 0) {
      chosen = pool[i]!;
      break;
    }
  }

  const avgWidth = oppParams.reduce((a, o) => a + o.width, 0) / oppParams.length;
  const trace: EvTrace = {
    street: view.street,
    equity: eFull,
    potOdds: toCall > 0 ? toCall / (potNow + toCall) : null,
    rangeSummary: `${oppParams.length} opp · range ~${pct(avgWidth)}`,
    candidates: cands,
    chosen: chosen.label,
    foldEv: legal.canFold ? 0 : null,
  };

  return {
    action: clampToLegal(chosen.action, legal),
    confidence: Math.round(Math.abs(eFull - 0.5) * 200) / 100,
    perceivedEquity: eFull,
    reasoning: `EV ${chosen.label} (éq ${pct(eFull)}${trace.potOdds != null ? `, cotes ${pct(trace.potOdds)}` : ""}) · ${trace.rangeSummary}`,
    source: "ev",
    trace,
  };
}
