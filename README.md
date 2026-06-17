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
| 4 | Reasoning-agent bots via the Anthropic API (per-decision JSON) | ⬜ needs API key |
| 5 | Post-session coach reflection → versioned playbooks | ⬜ |
| 6b | Learning-timeline view + playbook diffs (needs phases 4–5 data) | ⬜ |
| 7 | Replay scrubbing + CFR solver mode (stretch) | ⬜ |

## The viewer

```bash
npm run dev        # http://localhost:3000
```

Press **Play** and watch two bots play live: animated deals, chips to the pot,
each bot's inner-monologue reasoning + confidence, a perceived-vs-true equity
bar (the truth layer), live HUD stats, and an action log. Controls: play / pause
/ step / speed, plus a New Match bar to pick names and personalities. The whole
game loop runs client-side (heuristic bots are instant); the `Bot` interface is
async, so reasoning agents become a server round-trip with no refactor.

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
