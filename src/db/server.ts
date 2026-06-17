/** Server-only cached SQLite handle for API routes (never import from client code). */

import { openDb, type DB } from "./db.js";

let cached: DB | null = null;

export function getDb(): DB {
  if (!cached) cached = openDb();
  return cached;
}
