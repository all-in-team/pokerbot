/**
 * SQLite persistence wrapper (better-sqlite3).
 *
 * Everything the viewer and learning timeline need is replayable from here:
 * matches, full hand histories (seeded for exact replay), versioned playbooks,
 * and per-session stats.
 */

import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { SCHEMA } from "./schema.js";
import type { HandLog } from "../sim/match.js";

export type DB = Database.Database;

export function openDb(path = process.env.DATABASE_PATH ?? "./data/poker.db"): DB {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA);
  return db;
}

const now = () => new Date().toISOString();

export interface MatchRow {
  seed: string;
  smallBlind: number;
  bigBlind: number;
  startingStack: number;
  bot0Name: string;
  bot1Name: string;
  bot0Style?: string;
  bot1Style?: string;
  mode?: string;
  config?: unknown;
}

export function insertMatch(db: DB, m: MatchRow): number {
  const stmt = db.prepare(`
    INSERT INTO matches
      (created_at, seed, small_blind, big_blind, starting_stack,
       bot0_name, bot1_name, bot0_style, bot1_style, mode, config_json)
    VALUES (@created_at, @seed, @small_blind, @big_blind, @starting_stack,
       @bot0_name, @bot1_name, @bot0_style, @bot1_style, @mode, @config_json)
  `);
  const info = stmt.run({
    created_at: now(),
    seed: m.seed,
    small_blind: m.smallBlind,
    big_blind: m.bigBlind,
    starting_stack: m.startingStack,
    bot0_name: m.bot0Name,
    bot1_name: m.bot1Name,
    bot0_style: m.bot0Style ?? null,
    bot1_style: m.bot1Style ?? null,
    mode: m.mode ?? "heuristic",
    config_json: m.config ? JSON.stringify(m.config) : null,
  });
  return Number(info.lastInsertRowid);
}

export function insertHand(
  db: DB,
  matchId: number,
  log: HandLog,
  sessionIndex: number | null = null,
): number {
  const s = log.state;
  const result = s.result!;
  const stmt = db.prepare(`
    INSERT INTO hands
      (match_id, hand_index, session_index, seed, button, board, hole0, hole1,
       start_stack0, start_stack1, action_history, decisions, result_json,
       net0, net1, showdown, created_at)
    VALUES (@match_id, @hand_index, @session_index, @seed, @button, @board, @hole0, @hole1,
       @start_stack0, @start_stack1, @action_history, @decisions, @result_json,
       @net0, @net1, @showdown, @created_at)
  `);
  const info = stmt.run({
    match_id: matchId,
    hand_index: log.config.handId,
    session_index: sessionIndex,
    seed: log.config.seed,
    button: log.config.button,
    board: JSON.stringify(s.board),
    hole0: JSON.stringify(log.holeCards[0]),
    hole1: JSON.stringify(log.holeCards[1]),
    start_stack0: log.config.players[0].stack,
    start_stack1: log.config.players[1].stack,
    action_history: JSON.stringify(s.actionHistory),
    decisions: JSON.stringify(log.decisions),
    result_json: JSON.stringify(result),
    net0: result.net[0],
    net1: result.net[1],
    showdown: result.showdown ? 1 : 0,
    created_at: now(),
  });
  return Number(info.lastInsertRowid);
}

/** Insert many hands in one transaction (fast for batch self-play). */
export function insertHands(
  db: DB,
  matchId: number,
  logs: HandLog[],
  sessionIndex: number | null = null,
): void {
  const tx = db.transaction((batch: HandLog[]) => {
    for (const log of batch) insertHand(db, matchId, log, sessionIndex);
  });
  tx(logs);
}

export function countHands(db: DB, matchId: number): number {
  const row = db.prepare("SELECT COUNT(*) AS n FROM hands WHERE match_id = ?").get(matchId) as { n: number };
  return row.n;
}
