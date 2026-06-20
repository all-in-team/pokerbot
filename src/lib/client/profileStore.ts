/**
 * Player profiles for /play — persisted in the browser via a small storage
 * boundary so a real backend (e.g. Supabase) can be plugged in later WITHOUT
 * touching callers. 100% client; no engine/equity/EV coupling.
 *
 * Architecture:
 *   - `ProfileStore` is the persistence interface (list/load/save/delete + active id).
 *   - `KeyValueStore` is a tiny localStorage-shaped backend the local store sits on.
 *   - `localStorageBackend()`/`memoryBackend()` (tests/SSR) feed `createProfileStore`.
 *   - `supabaseBackend()` is a cloud ProfileStore (used when env vars are present).
 *   - A profile stores LIFETIME results (cumulative across sessions) AND the
 *     human read model (`HumanStats`) the bots remember about this player.
 */

import { createClient } from "@supabase/supabase-js";
import { emptyHumanStats, type HumanStats } from "@/lib/client/humanModel.js";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "@/lib/supabaseConfig.js";

export interface ProfileLifetime {
  handsPlayed: number;
  handsWon: number;
  handsLost: number;
  netChips: number;
  /** Cumulative net measured in big blinds (stake-independent → robust bb/100). */
  netBb: number;
}

export interface PlayerProfile {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  lifetime: ProfileLifetime;
  /** Cumulative human read model — what the bots remember about this player. */
  stats: HumanStats;
}

/**
 * Persistence boundary. Swap the implementation (localStorage ↔ Supabase) without
 * touching callers. Data methods are ASYNC (a real backend is network-bound); the
 * active-profile id is a sync DEVICE preference (always local).
 */
export interface ProfileStore {
  listProfiles(): Promise<PlayerProfile[]>;
  loadProfile(id: string): Promise<PlayerProfile | null>;
  saveProfile(profile: PlayerProfile): Promise<void>;
  deleteProfile(id: string): Promise<void>;
  getActiveId(): string | null;
  setActiveId(id: string | null): void;
}

/** Minimal key/value backend (localStorage-shaped). */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  keys(): string[];
}

const PREFIX = "pokerbot:play:profile:";
const ACTIVE_KEY = "pokerbot:play:activeProfileId";
const keyOf = (id: string) => `${PREFIX}${id}`;

export function emptyLifetime(): ProfileLifetime {
  return { handsPlayed: 0, handsWon: 0, handsLost: 0, netChips: 0, netBb: 0 };
}

let idCounter = 0;
function newId(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  } catch {
    /* fall through */
  }
  idCounter += 1;
  return `p_${Date.now().toString(36)}_${idCounter}`;
}

/** A fresh, empty profile. `id`/`now` are injectable for deterministic tests. */
export function createProfile(name: string, opts: { id?: string; now?: number } = {}): PlayerProfile {
  const now = opts.now ?? Date.now();
  return {
    id: opts.id ?? newId(),
    name: name.trim() || "Joueur",
    createdAt: now,
    updatedAt: now,
    lifetime: emptyLifetime(),
    stats: emptyHumanStats(),
  };
}

/** Add one completed hand's result to a lifetime tally (pure, returns a new object). */
export function accumulateHand(lifetime: ProfileLifetime, hand: { net: number; bigBlind: number }): ProfileLifetime {
  const bb = hand.bigBlind > 0 ? hand.net / hand.bigBlind : 0;
  return {
    handsPlayed: lifetime.handsPlayed + 1,
    handsWon: lifetime.handsWon + (hand.net > 0 ? 1 : 0),
    handsLost: lifetime.handsLost + (hand.net < 0 ? 1 : 0),
    netChips: lifetime.netChips + hand.net,
    netBb: lifetime.netBb + bb,
  };
}

/** Lifetime bb/100 (0 when no hands yet). */
export function lifetimeBb100(lifetime: ProfileLifetime): number {
  return lifetime.handsPlayed > 0 ? (lifetime.netBb / lifetime.handsPlayed) * 100 : 0;
}

// ── Shape coercion (defensive against partial / corrupted stored data) ────────

function coerceLifetime(raw: unknown): ProfileLifetime {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  return {
    handsPlayed: num(o.handsPlayed),
    handsWon: num(o.handsWon),
    handsLost: num(o.handsLost),
    netChips: num(o.netChips),
    netBb: num(o.netBb),
  };
}

function coerceStats(raw: unknown): HumanStats {
  const e = emptyHumanStats();
  const o = raw as Record<string, unknown> | null;
  if (!o || typeof o !== "object" || typeof o.hands !== "number" || !o.vpip || !o.aggr || !o.wtsd) return e;
  return o as unknown as HumanStats;
}

function normalize(raw: unknown): PlayerProfile | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.id !== "string" || typeof o.name !== "string") return null;
  return {
    id: o.id,
    name: o.name,
    createdAt: typeof o.createdAt === "number" ? o.createdAt : 0,
    updatedAt: typeof o.updatedAt === "number" ? o.updatedAt : 0,
    lifetime: coerceLifetime(o.lifetime),
    stats: coerceStats(o.stats),
  };
}

function parse(raw: string | null): PlayerProfile | null {
  if (!raw) return null;
  try {
    return normalize(JSON.parse(raw));
  } catch {
    return null;
  }
}

// ── Store + backends ──────────────────────────────────────────────────────────

/** ProfileStore over a sync key/value backend (localStorage / memory). */
export function createProfileStore(backend: KeyValueStore): ProfileStore {
  return {
    async listProfiles() {
      return backend
        .keys()
        .filter((k) => k.startsWith(PREFIX))
        .map((k) => parse(backend.getItem(k)))
        .filter((p): p is PlayerProfile => p !== null)
        .sort((a, b) => b.updatedAt - a.updatedAt);
    },
    async loadProfile(id) {
      return parse(backend.getItem(keyOf(id)));
    },
    async saveProfile(profile) {
      backend.setItem(keyOf(profile.id), JSON.stringify(profile));
    },
    async deleteProfile(id) {
      backend.removeItem(keyOf(id));
      if (backend.getItem(ACTIVE_KEY) === id) backend.removeItem(ACTIVE_KEY);
    },
    getActiveId() {
      return backend.getItem(ACTIVE_KEY);
    },
    setActiveId(id) {
      if (id === null) backend.removeItem(ACTIVE_KEY);
      else backend.setItem(ACTIVE_KEY, id);
    },
  };
}

// Active-profile id is a DEVICE preference → always localStorage (guarded for SSR).
function deviceGetActiveId(): string | null {
  try {
    return typeof localStorage !== "undefined" ? localStorage.getItem(ACTIVE_KEY) : null;
  } catch {
    return null;
  }
}
function deviceSetActiveId(id: string | null): void {
  try {
    if (typeof localStorage === "undefined") return;
    if (id === null) localStorage.removeItem(ACTIVE_KEY);
    else localStorage.setItem(ACTIVE_KEY, id);
  } catch {
    /* ignore */
  }
}

/** Supabase table name + the row shape stored there. */
const SUPABASE_TABLE = "profiles";
interface ProfileRow {
  id: string;
  pseudo: string;
  data: PlayerProfile;
  updated_at: string;
}

/**
 * Cloud ProfileStore backed by Supabase. Every network call is wrapped: on
 * failure it LOGS and degrades gracefully (empty list / null / no-op) so the app
 * never crashes if Supabase is unreachable. Active id stays a local device pref.
 */
export function supabaseBackend(url: string, anonKey: string): ProfileStore {
  const client = createClient(url, anonKey);
  const warn = (op: string, e: unknown) => console.warn(`[profiles] Supabase ${op} failed → degrading gracefully:`, e);

  return {
    async listProfiles() {
      try {
        const { data, error } = await client.from(SUPABASE_TABLE).select("data").order("updated_at", { ascending: false });
        if (error) throw error;
        return (data ?? [])
          .map((row) => normalize((row as { data: unknown }).data))
          .filter((p): p is PlayerProfile => p !== null);
      } catch (e) {
        warn("listProfiles", e);
        return [];
      }
    },
    async loadProfile(id) {
      try {
        const { data, error } = await client.from(SUPABASE_TABLE).select("data").eq("id", id).maybeSingle();
        if (error) throw error;
        return data ? normalize((data as { data: unknown }).data) : null;
      } catch (e) {
        warn("loadProfile", e);
        return null;
      }
    },
    async saveProfile(profile) {
      try {
        const row: ProfileRow = {
          id: profile.id,
          pseudo: profile.name,
          data: profile,
          updated_at: new Date(profile.updatedAt || Date.now()).toISOString(),
        };
        const { error } = await client.from(SUPABASE_TABLE).upsert(row, { onConflict: "id" });
        if (error) throw error;
      } catch (e) {
        warn("saveProfile", e);
      }
    },
    async deleteProfile(id) {
      try {
        const { error } = await client.from(SUPABASE_TABLE).delete().eq("id", id);
        if (error) throw error;
      } catch (e) {
        warn("deleteProfile", e);
      }
      if (deviceGetActiveId() === id) deviceSetActiveId(null);
    },
    getActiveId: deviceGetActiveId,
    setActiveId: deviceSetActiveId,
  };
}

/** In-memory backend (tests, SSR fallback). */
export function memoryBackend(seed: Record<string, string> = {}): KeyValueStore {
  const m = new Map<string, string>(Object.entries(seed));
  return {
    getItem: (k) => (m.has(k) ? m.get(k)! : null),
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
    keys: () => [...m.keys()],
  };
}

/** Browser localStorage backend, or null when unavailable (SSR/headless). */
export function localStorageBackend(): KeyValueStore | null {
  try {
    if (typeof localStorage === "undefined") return null;
    return {
      getItem: (k) => localStorage.getItem(k),
      setItem: (k, v) => localStorage.setItem(k, v),
      removeItem: (k) => localStorage.removeItem(k),
      keys: () => Object.keys(localStorage),
    };
  } catch {
    return null;
  }
}

let defaultStore: ProfileStore | null = null;
/**
 * Process-wide store on the best available backend:
 *   Supabase URL + key available (env var OR hard-coded public default) →
 *   Supabase cloud (with graceful fallback); otherwise → localStorage, then memory.
 */
export function defaultProfileStore(): ProfileStore {
  if (defaultStore) return defaultStore;

  // Env vars take priority; otherwise the public defaults in supabaseConfig.ts.
  if (SUPABASE_URL && SUPABASE_ANON_KEY) {
    try {
      defaultStore = supabaseBackend(SUPABASE_URL, SUPABASE_ANON_KEY);
      console.info("[profiles] backend: Supabase cloud");
      return defaultStore;
    } catch (e) {
      console.warn("[profiles] Supabase init failed → localStorage fallback:", e);
    }
  }

  defaultStore = createProfileStore(localStorageBackend() ?? memoryBackend());
  return defaultStore;
}
