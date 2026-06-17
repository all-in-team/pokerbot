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

// --- Playbook versions (the learning timeline) ---

export interface PlaybookVersionRow {
  matchId: number;
  botSeat: number;
  botName: string;
  version: number;
  sessionIndex: number | null;
  playbook: unknown;
  diffText?: string | null;
}

export function insertPlaybookVersion(db: DB, row: PlaybookVersionRow): number {
  const stmt = db.prepare(`
    INSERT INTO playbook_versions
      (match_id, bot_seat, bot_name, version, session_index, playbook_json, diff_text, created_at)
    VALUES (@match_id, @bot_seat, @bot_name, @version, @session_index, @playbook_json, @diff_text, @created_at)
  `);
  const info = stmt.run({
    match_id: row.matchId,
    bot_seat: row.botSeat,
    bot_name: row.botName,
    version: row.version,
    session_index: row.sessionIndex,
    playbook_json: JSON.stringify(row.playbook),
    diff_text: row.diffText ?? null,
    created_at: now(),
  });
  return Number(info.lastInsertRowid);
}

export interface StoredPlaybookVersion {
  version: number;
  sessionIndex: number | null;
  playbook: unknown;
  diffText: string | null;
  createdAt: string;
}

export function getPlaybookVersions(db: DB, matchId: number, botSeat: number): StoredPlaybookVersion[] {
  const rows = db
    .prepare(
      `SELECT version, session_index, playbook_json, diff_text, created_at
       FROM playbook_versions WHERE match_id = ? AND bot_seat = ? ORDER BY version ASC`,
    )
    .all(matchId, botSeat) as {
    version: number;
    session_index: number | null;
    playbook_json: string;
    diff_text: string | null;
    created_at: string;
  }[];
  return rows.map((r) => ({
    version: r.version,
    sessionIndex: r.session_index,
    playbook: JSON.parse(r.playbook_json),
    diffText: r.diff_text,
    createdAt: r.created_at,
  }));
}

// --- Per-session stats (learning timeline win-rate chart) ---

export interface SessionStatsRow {
  matchId: number;
  sessionIndex: number;
  botSeat: number;
  botName: string;
  hands: number;
  netChips: number;
  bbPer100: number;
  stats: unknown;
}

export interface MatchSummary {
  id: number;
  createdAt: string;
  seed: string;
  smallBlind: number;
  bigBlind: number;
  startingStack: number;
  bot0Name: string;
  bot1Name: string;
  bot0Style: string | null;
  bot1Style: string | null;
  mode: string;
  hands: number;
  sessions: number;
}

/** All matches, newest first, with hand/session counts (for the timeline picker). */
export function getMatches(db: DB): MatchSummary[] {
  const rows = db
    .prepare(
      `SELECT m.*,
        (SELECT COUNT(*) FROM hands h WHERE h.match_id = m.id) AS hand_count,
        (SELECT COUNT(DISTINCT s.session_index) FROM session_stats s WHERE s.match_id = m.id) AS session_count
       FROM matches m ORDER BY m.id DESC`,
    )
    .all() as Record<string, unknown>[];
  return rows.map((r) => ({
    id: r.id as number,
    createdAt: r.created_at as string,
    seed: r.seed as string,
    smallBlind: r.small_blind as number,
    bigBlind: r.big_blind as number,
    startingStack: r.starting_stack as number,
    bot0Name: r.bot0_name as string,
    bot1Name: r.bot1_name as string,
    bot0Style: (r.bot0_style as string) ?? null,
    bot1Style: (r.bot1_style as string) ?? null,
    mode: r.mode as string,
    hands: r.hand_count as number,
    sessions: r.session_count as number,
  }));
}

export interface StoredSessionStats {
  sessionIndex: number;
  botSeat: number;
  botName: string;
  hands: number;
  netChips: number;
  bbPer100: number;
  stats: unknown;
}

export function getSessionStats(db: DB, matchId: number): StoredSessionStats[] {
  const rows = db
    .prepare(
      `SELECT session_index, bot_seat, bot_name, hands, net_chips, bb_per_100, stats_json
       FROM session_stats WHERE match_id = ? ORDER BY session_index ASC, bot_seat ASC`,
    )
    .all(matchId) as {
    session_index: number;
    bot_seat: number;
    bot_name: string;
    hands: number;
    net_chips: number;
    bb_per_100: number;
    stats_json: string;
  }[];
  return rows.map((r) => ({
    sessionIndex: r.session_index,
    botSeat: r.bot_seat,
    botName: r.bot_name,
    hands: r.hands,
    netChips: r.net_chips,
    bbPer100: r.bb_per_100,
    stats: r.stats_json ? JSON.parse(r.stats_json) : null,
  }));
}

export function insertSessionStats(db: DB, row: SessionStatsRow): number {
  const stmt = db.prepare(`
    INSERT INTO session_stats
      (match_id, session_index, bot_seat, bot_name, hands, net_chips, bb_per_100, stats_json, created_at)
    VALUES (@match_id, @session_index, @bot_seat, @bot_name, @hands, @net_chips, @bb_per_100, @stats_json, @created_at)
  `);
  const info = stmt.run({
    match_id: row.matchId,
    session_index: row.sessionIndex,
    bot_seat: row.botSeat,
    bot_name: row.botName,
    hands: row.hands,
    net_chips: row.netChips,
    bb_per_100: row.bbPer100,
    stats_json: JSON.stringify(row.stats),
    created_at: now(),
  });
  return Number(info.lastInsertRowid);
}
