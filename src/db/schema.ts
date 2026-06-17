/** SQLite schema. Everything needed to replay hands and chart learning over time. */

export const SCHEMA = /* sql */ `
CREATE TABLE IF NOT EXISTS matches (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at    TEXT    NOT NULL,
  seed          TEXT    NOT NULL,
  small_blind   INTEGER NOT NULL,
  big_blind     INTEGER NOT NULL,
  starting_stack INTEGER NOT NULL,
  bot0_name     TEXT    NOT NULL,
  bot1_name     TEXT    NOT NULL,
  bot0_style    TEXT,
  bot1_style    TEXT,
  mode          TEXT    NOT NULL DEFAULT 'heuristic',
  config_json   TEXT
);

CREATE TABLE IF NOT EXISTS hands (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  match_id       INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  hand_index     INTEGER NOT NULL,
  session_index  INTEGER,
  seed           TEXT    NOT NULL,
  button         INTEGER NOT NULL,
  board          TEXT    NOT NULL,
  hole0          TEXT    NOT NULL,
  hole1          TEXT    NOT NULL,
  start_stack0   INTEGER NOT NULL,
  start_stack1   INTEGER NOT NULL,
  action_history TEXT    NOT NULL,
  decisions      TEXT    NOT NULL,
  result_json    TEXT    NOT NULL,
  net0           INTEGER NOT NULL,
  net1           INTEGER NOT NULL,
  showdown       INTEGER NOT NULL,
  created_at     TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_hands_match ON hands(match_id, hand_index);

CREATE TABLE IF NOT EXISTS playbook_versions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  match_id      INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  bot_seat      INTEGER NOT NULL,
  bot_name      TEXT    NOT NULL,
  version       INTEGER NOT NULL,
  session_index INTEGER,
  playbook_json TEXT    NOT NULL,
  diff_text     TEXT,
  created_at    TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_playbook_match ON playbook_versions(match_id, bot_seat, version);

CREATE TABLE IF NOT EXISTS session_stats (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  match_id      INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  session_index INTEGER NOT NULL,
  bot_seat      INTEGER NOT NULL,
  bot_name      TEXT    NOT NULL,
  hands         INTEGER NOT NULL,
  net_chips     INTEGER NOT NULL,
  bb_per_100    REAL,
  vpip          REAL,
  pfr           REAL,
  three_bet     REAL,
  af            REAL,
  fold_to_cbet  REAL,
  wtsd          REAL,
  won           REAL,
  stats_json    TEXT,
  created_at    TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_session_stats_match ON session_stats(match_id, session_index, bot_seat);
`;
