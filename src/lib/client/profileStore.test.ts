import { describe, it, expect } from "vitest";
import {
  createProfileStore, memoryBackend, createProfile, accumulateHand, lifetimeBb100,
  type PlayerProfile,
} from "./profileStore.js";
import { emptyHumanStats, mergeHumanStats, readOf, type HumanStats } from "./humanModel.js";

function mkStats(p: Partial<HumanStats> = {}): HumanStats {
  return { ...emptyHumanStats(), ...p };
}

describe("profileStore — create / read / update", () => {
  it("round-trips a profile through save → load", () => {
    const store = createProfileStore(memoryBackend());
    const p = createProfile("Baki", { id: "a", now: 1000 });
    store.saveProfile(p);

    const loaded = store.loadProfile("a");
    expect(loaded).not.toBeNull();
    expect(loaded!.name).toBe("Baki");
    expect(loaded!.lifetime.handsPlayed).toBe(0);
  });

  it("returns null for an unknown id", () => {
    const store = createProfileStore(memoryBackend());
    expect(store.loadProfile("nope")).toBeNull();
  });

  it("saveProfile overwrites (update) an existing profile", () => {
    const store = createProfileStore(memoryBackend());
    const p = createProfile("Baki", { id: "a", now: 1000 });
    store.saveProfile(p);
    store.saveProfile({ ...p, name: "Baki2", lifetime: accumulateHand(p.lifetime, { net: 10, bigBlind: 2 }) });

    const loaded = store.loadProfile("a")!;
    expect(loaded.name).toBe("Baki2");
    expect(loaded.lifetime.handsPlayed).toBe(1);
    expect(loaded.lifetime.netChips).toBe(10);
  });

  it("lists profiles (newest first) and deletes them", () => {
    const store = createProfileStore(memoryBackend());
    store.saveProfile(createProfile("Old", { id: "a", now: 1000 }));
    store.saveProfile(createProfile("New", { id: "b", now: 2000 }));

    const list = store.listProfiles();
    expect(list.map((p) => p.id)).toEqual(["b", "a"]);

    store.deleteProfile("a");
    expect(store.listProfiles().map((p) => p.id)).toEqual(["b"]);
    expect(store.loadProfile("a")).toBeNull();
  });

  it("tracks the active profile id and clears it on delete", () => {
    const store = createProfileStore(memoryBackend());
    store.saveProfile(createProfile("Baki", { id: "a" }));
    store.setActiveId("a");
    expect(store.getActiveId()).toBe("a");
    store.deleteProfile("a");
    expect(store.getActiveId()).toBeNull();
  });

  it("ignores corrupted entries instead of throwing", () => {
    const backend = memoryBackend({ "pokerbot:play:profile:bad": "{not json" });
    const store = createProfileStore(backend);
    expect(store.listProfiles()).toEqual([]);
    expect(store.loadProfile("bad")).toBeNull();
  });
});

describe("profileStore — lifetime accumulation across sessions", () => {
  it("accumulates results over several persisted sessions (winrate evolves)", () => {
    const backend = memoryBackend(); // shared device storage across sessions

    // Session 1: a fresh store loads/creates the profile, plays 2 hands.
    const s1 = createProfileStore(backend);
    let p = createProfile("Baki", { id: "a" });
    s1.saveProfile(p);
    p = { ...p, lifetime: accumulateHand(p.lifetime, { net: 20, bigBlind: 2 }) }; // win
    p = { ...p, lifetime: accumulateHand(p.lifetime, { net: -8, bigBlind: 2 }) }; // loss
    s1.saveProfile(p);

    // Session 2: a brand-new store on the SAME backend continues the same profile.
    const s2 = createProfileStore(backend);
    let p2 = s2.loadProfile("a")!;
    expect(p2.lifetime.handsPlayed).toBe(2); // remembered across "sessions"
    p2 = { ...p2, lifetime: accumulateHand(p2.lifetime, { net: 12, bigBlind: 2 }) }; // win
    s2.saveProfile(p2);

    const final = createProfileStore(backend).loadProfile("a")!;
    expect(final.lifetime.handsPlayed).toBe(3);
    expect(final.lifetime.handsWon).toBe(2);
    expect(final.lifetime.handsLost).toBe(1);
    expect(final.lifetime.netChips).toBe(24); // 20 - 8 + 12
    // bb/100 = (netBb / hands) * 100; netBb = (20-8+12)/2 = 12 → 12/3*100 = 400
    expect(lifetimeBb100(final.lifetime)).toBeCloseTo(400, 5);
  });

  it("ties count as neither win nor loss", () => {
    const lt = accumulateHand(accumulateHand({ handsPlayed: 0, handsWon: 0, handsLost: 0, netChips: 0, netBb: 0 }, { net: 0, bigBlind: 2 }), { net: 5, bigBlind: 2 });
    expect(lt.handsPlayed).toBe(2);
    expect(lt.handsWon).toBe(1);
    expect(lt.handsLost).toBe(0);
  });
});

describe("humanModel — merge (lifetime base + session delta)", () => {
  it("sums counters and ratios so the combined read is correct", () => {
    const base = mkStats({
      hands: 10,
      vpip: { n: 3, d: 10 },
      pfr: { n: 2, d: 10 },
      aggr: { bets: 4, calls: 2 },
      wtsd: { n: 1, d: 5 },
    });
    const session = mkStats({
      hands: 10,
      vpip: { n: 5, d: 10 },
      pfr: { n: 3, d: 10 },
      aggr: { bets: 6, calls: 2 },
      wtsd: { n: 2, d: 5 },
    });

    const merged = mergeHumanStats(base, session);
    expect(merged.hands).toBe(20);
    expect(merged.vpip).toEqual({ n: 8, d: 20 });
    expect(merged.aggr).toEqual({ bets: 10, calls: 4 });

    const read = readOf(merged);
    expect(read.vpip).toBeCloseTo(0.4, 5); // 8/20
    expect(read.af).toBeCloseTo(2.5, 5); // 10/4
    expect(read.weight).toBe(1); // 20 hands ≥ confidence window → full weight
  });

  it("merging with an empty model is an identity", () => {
    const s = mkStats({ hands: 7, vpip: { n: 2, d: 7 } });
    expect(mergeHumanStats(s, emptyHumanStats())).toEqual(s);
    expect(mergeHumanStats(emptyHumanStats(), s)).toEqual(s);
  });

  it("a bigger merged sample yields a more confident read", () => {
    const small: PlayerProfile["stats"] = mkStats({ hands: 3 });
    const big = mkStats({ hands: 12 });
    expect(readOf(small).weight).toBeLessThan(readOf(mergeHumanStats(small, big)).weight);
  });
});
