/**
 * Fresh random seed for REAL play (no explicit seed supplied). Tests and replay
 * keep passing an explicit seed → deterministic; omit it → a new random seed each
 * time, so boards/hands differ every session. Prefers crypto, falls back to
 * Date.now()+counter.
 */
let counter = 0;

export function randomSeed(prefix = "live"): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
      const a = new Uint32Array(2);
      crypto.getRandomValues(a);
      return `${prefix}-${a[0]!.toString(36)}${a[1]!.toString(36)}`;
    }
  } catch {
    /* fall through to the time-based seed */
  }
  counter += 1;
  return `${prefix}-${Date.now().toString(36)}-${counter}`;
}
