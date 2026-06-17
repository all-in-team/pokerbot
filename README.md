# ♠ Heads-Up Poker AI Arena

Two AI bots play heads-up No-Limit Texas Hold'em against each other, think out loud,
and slowly improve through self-play — in a viewer built to make every decision legible
*and* gorgeous to watch.

This repo is built incrementally; each phase is runnable on its own.

## Status

| Phase | What | State |
|------|------|-------|
| 1 | Deterministic NLHE engine + exhaustive unit tests | ✅ done |
| 2 | Headless self-play, two heuristic bots, SQLite hand histories | ✅ done |
| 3 | Monte Carlo equity (truth layer) + live HUD stats | ✅ done |
| 6a | The viewer — table, animations, reasoning, equity bar, HUD, action log, controls | ✅ done |
| 4 | Reasoning-agent bots (per-decision JSON, playbook + opponent HUD context) | ✅ done (live + offline mock) |
| 5 | Post-session coach reflection → versioned playbooks | ✅ done |
| 6b | Learning-timeline view (win-rate charts + playbook version diffs) | ✅ done |
| 4b | Reasoning agents live at the table (decision API route + Heuristic/Reasoning toggle) | ✅ done |
| 7a | Replay scrubbing — reconstruct + scrub any past hand of the session | ✅ done |
| 7b | CFR solver mode (stretch) | ✅ done |

**All phases complete.**

## CFR solver

`npm run dev` → **http://localhost:3000/solver** (or "Solver ↗" from the table).
A self-play CFR engine on Kuhn Poker (a 3-card abstraction of NLHE) that
genuinely converges to a Nash equilibrium: watch **exploitability** (how much a
best-responding opponent could win) fall toward zero and **strategy entropy**
settle across iterations, with the converged strategy table showing the textbook
result — the King opens at ≈ 3× the Jack-bluff rate. Exact exploitability via
brute-force best response; convergence verified by tests.

## Replay scrubbing

Play some hands, then hit **Replay ⏮** in the header. The viewer reconstructs any
past hand of the session deterministically from its log — scrub the slider or
step action-by-action, jump between hands, and watch the table, reasoning, and
the true-equity bar at every point. Engine determinism makes every frame exact
(verified by tests).

## The learning timeline

`npm run dev` → **http://localhost:3000/learning** (or "Learning ↗" from the table).
Pick a match and watch each bot's win rate (bb/100) and cumulative chips chart
across sessions, their postflop tendencies shift version to version, and the full
playbook revision history with the coach's diffs ("villain over-folds → raise
c-bet 62% → 68%"). Reads straight from SQLite, so any `npm run reason` /
`npm run sim` match shows up.

## Reasoning agents + learning loop

```bash
# Offline (deterministic mock — no API key, used by tests):
npm run reason -- --sessions 4 --hands 60 --p0 TAG --p1 maniac --mock
# Live (set ANTHROPIC_API_KEY in .env first):
npm run reason -- --sessions 4 --hands 60 --p0 TAG --p1 LAG
```

Each bot carries a versioned **playbook** (preflop/postflop frequencies + a
free-text notes section). On every decision it gets its cards, the board, stacks,
position, the hand's action history, its playbook, and a HUD of the opponent's
tendencies, and returns `{ action, sizing, confidence, reasoning, perceivedEquity }`
via `claude-sonnet-4-6`. After each session the **coach** (`claude-opus-4-8`)
reviews the hands and emits a diff to the playbook ("villain over-folds to turn
barrels → raise double-barrel frequency"); versions are stored so the learning
timeline can chart strategy evolution. A deterministic mock client implements the
same contract so the whole loop runs and tests offline.

## The viewer

```bash
npm run dev        # http://localhost:3000
```

Press **Play** and watch two bots play live: animated deals, chips to the pot,
each bot's inner-monologue reasoning + confidence, a perceived-vs-true equity
bar (the truth layer), live HUD stats, and an action log. Controls: play / pause
/ step / speed, plus a New Match bar to pick names and personalities.

Toggle **Heuristic ⇄ Reasoning** in the setup bar: Heuristic bots decide
instantly client-side; Reasoning bots think via `/api/decide` (the offline mock
with no key, the live Anthropic API with `ANTHROPIC_API_KEY` set) — you watch
the LLM's reasoning land in the thought panels at the table.

## Quick start

> **Node:** use Node ≥ 20. (On this machine the default `node` in PATH is a
> corrupted v20 binary — use `nvm use 22` first.)

```bash
npm install
npm test                 # 46 unit/integration tests
npm run sim -- --hands 2000 --p0 TAG --p1 maniac --seed demo
```

`npm run sim` plays a session headless, verifies chip conservation, prints HUD
stats and a perceived-vs-true equity breakdown of a sample hand, and logs every
hand to `./data/poker.db`.

Self-play flags: `--hands N --seed S --p0 <TAG|LAG|nit|maniac> --p1 <...>
--stacks N --sb N --bb N --carry --no-db`.

## Architecture

```
src/
  engine/          Pure, deterministic NLHE engine (no UI, no I/O)
    rng.ts         Seeded PRNG (xmur3 + mulberry32) — reproducible shuffles
    cards.ts       52-card deck, card utils
    evaluator.ts   Hand ranking + showdown authority (pokersolver wrapper)
    state.ts       Serializable GameState types
    actions.ts     Legal-action generation + the action-input contract
    engine.ts      createHand / applyAction state machine, showdown, pots
    equity.ts      TRUTH LAYER: exact/Monte-Carlo all-in equity
  bots/
    types.ts       Bot / DecisionView / Decision contract (async-ready)
    heuristic.ts   Chen-formula + made-hand heuristic bots w/ personalities
    util.ts        Clamp any intended action to a legal one
  sim/
    match.ts       Drives bots through hands and sessions
    hud.ts         VPIP / PFR / 3-bet / AF / fold-to-cbet / WTSD / bb-100
    truth.ts       Per-decision perceived-vs-true equity
    selfplay.ts    Headless self-play CLI
  db/
    schema.ts      SQLite schema (matches, hands, playbooks, session_stats)
    db.ts          better-sqlite3 wrapper + insert/query helpers
```

### Design choices

- **Evaluator: pokersolver** (over poker-evaluator) — pure JS, no 120 MB data
  file, and human-readable hand descriptions for the UI. Hand-ranking rules are
  stable, so its maintenance cadence is a non-issue.
- **Determinism everywhere.** A hand is fully reproducible from its seed + action
  sequence; the engine is immutable (`applyAction` returns a new state).
- **Truth layer is exact postflop.** With ≤ 2 cards to come the engine enumerates
  every run-out (≤ ~990 combos) instead of sampling — only preflop uses Monte Carlo.

## Heads-up rules implemented

Button posts the small blind and acts first preflop; big blind acts first
postflop and keeps its option after a limp. Min-raise tracks the last full raise
increment; a short all-in does not reopen betting. Uncalled bets are returned;
split pots award the odd chip to the big blind (a no-op in pure HU, where the
contested pot is always even — kept for future antes).

## Tests

`npm test` covers blind posting, legal actions, min-raise wars, all-in/showdown,
uncalled-bet returns, split pots, hand-ranking edge cases, equity (exact +
Monte Carlo), HUD math, and **chip conservation across 1,000+ fuzzed hands** plus
deterministic replay.
