import { describe, it, expect } from "vitest";
import {
  createProfileStore, memoryBackend, createProfile, accumulateHand, lifetimeBb100,
  type PlayerProfile,
} from "./profileStore.js";
import { emptyHumanStats, mergeHumanStats, readOf, type HumanStats } from "./humanModel.js";
import { exploitPlan } from "./exploitBot.js";
import type { Decision, DecisionView, OpponentView } from "@/bots/types.js";

function mkStats(p: Partial<HumanStats> = {}): HumanStats {
  return { ...emptyHumanStats(), ...p };
}

/** A flop spot where a bot can fire and the human (seat 0) is still in the hand. */
function botCanBetView(humanSeat = 0, botSeat = 3): DecisionView {
  const opponents: OpponentView[] = [
    { seat: humanSeat, position: "BB", stack: 200, committedThisStreet: 0, committedTotal: 0, folded: false, allIn: false },
  ];
  return {
    handId: 0, seat: botSeat, street: "flop", position: "button",
    holeCards: ["Ah", "Kd"], board: ["2c", "7d", "9s"],
    pot: 30, toCall: 0, myStack: 200, oppStack: 200,
    myCommittedThisStreet: 0, oppCommittedThisStreet: 0, bigBlind: 2,
    legal: {
      toAct: botSeat, toCall: 0, canFold: false, canCheck: true, canCall: false, callAmount: 0,
      canBet: true, canRaise: false, aggressiveType: "bet", minTo: 2, maxTo: 200, minRaiseAmount: 2, maxRaiseAmount: 200,
    },
    actionHistory: [], tablePosition: "BTN", opponents, numPlayers: 2, activePlayers: 2,
  };
}

const passiveBase: Decision = { action: { type: "check" }, perceivedEquity: 0.3 };

describe("profileStore — create / read / update", () => {
  it("round-trips a profile through save → load", async () => {
    const store = createProfileStore(memoryBackend());
    const p = createProfile("Baki", { id: "a", now: 1000 });
    await store.saveProfile(p);

    const loaded = await store.loadProfile("a");
    expect(loaded).not.toBeNull();
    expect(loaded!.name).toBe("Baki");
    expect(loaded!.lifetime.handsPlayed).toBe(0);
  });

  it("returns null for an unknown id", async () => {
    const store = createProfileStore(memoryBackend());
    expect(await store.loadProfile("nope")).toBeNull();
  });

  it("saveProfile overwrites (update) an existing profile", async () => {
    const store = createProfileStore(memoryBackend());
    const p = createProfile("Baki", { id: "a", now: 1000 });
    await store.saveProfile(p);
    await store.saveProfile({ ...p, name: "Baki2", lifetime: accumulateHand(p.lifetime, { net: 10, bigBlind: 2 }) });

    const loaded = (await store.loadProfile("a"))!;
    expect(loaded.name).toBe("Baki2");
    expect(loaded.lifetime.handsPlayed).toBe(1);
    expect(loaded.lifetime.netChips).toBe(10);
  });

  it("lists profiles (newest first) and deletes them", async () => {
    const store = createProfileStore(memoryBackend());
    await store.saveProfile(createProfile("Old", { id: "a", now: 1000 }));
    await store.saveProfile(createProfile("New", { id: "b", now: 2000 }));

    const list = await store.listProfiles();
    expect(list.map((p) => p.id)).toEqual(["b", "a"]);

    await store.deleteProfile("a");
    expect((await store.listProfiles()).map((p) => p.id)).toEqual(["b"]);
    expect(await store.loadProfile("a")).toBeNull();
  });

  it("tracks the active profile id and clears it on delete", async () => {
    const store = createProfileStore(memoryBackend());
    await store.saveProfile(createProfile("Baki", { id: "a" }));
    store.setActiveId("a");
    expect(store.getActiveId()).toBe("a");
    await store.deleteProfile("a");
    expect(store.getActiveId()).toBeNull();
  });

  it("ignores corrupted entries instead of throwing", async () => {
    const backend = memoryBackend({ "pokerbot:play:profile:bad": "{not json" });
    const store = createProfileStore(backend);
    expect(await store.listProfiles()).toEqual([]);
    expect(await store.loadProfile("bad")).toBeNull();
  });
});

describe("profileStore — lifetime accumulation across sessions", () => {
  it("accumulates results over several persisted sessions (winrate evolves)", async () => {
    const backend = memoryBackend(); // shared device storage across sessions

    // Session 1: a fresh store loads/creates the profile, plays 2 hands.
    const s1 = createProfileStore(backend);
    let p = createProfile("Baki", { id: "a" });
    await s1.saveProfile(p);
    p = { ...p, lifetime: accumulateHand(p.lifetime, { net: 20, bigBlind: 2 }) }; // win
    p = { ...p, lifetime: accumulateHand(p.lifetime, { net: -8, bigBlind: 2 }) }; // loss
    await s1.saveProfile(p);

    // Session 2: a brand-new store on the SAME backend continues the same profile.
    const s2 = createProfileStore(backend);
    const p2base = (await s2.loadProfile("a"))!;
    expect(p2base.lifetime.handsPlayed).toBe(2); // remembered across "sessions"
    const p2 = { ...p2base, lifetime: accumulateHand(p2base.lifetime, { net: 12, bigBlind: 2 }) }; // win
    await s2.saveProfile(p2);

    const final = (await createProfileStore(backend).loadProfile("a"))!;
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

describe("full cycle — quit & return: lifetime + bot exploitation persist", () => {
  const HUMAN = 0;

  it("the RELOADED humanModel is still read by the exploitation layer", () => {
    // Build a saved read of an over-folder (folds too much to c-bets).
    const stats = mkStats({ hands: 40, foldToCbet: { n: 30, d: 40 } });
    const reloadedRead = readOf(stats);
    expect(reloadedRead.foldToCbet).toBeGreaterThan(0.55);
    expect(reloadedRead.weight).toBe(1);

    // The exploit layer turns a passive bot line into a bluff vs that read.
    const plan = exploitPlan(botCanBetView(HUMAN), passiveBase, reloadedRead, HUMAN);
    expect(plan.kind).toBe("bluff");
    expect(plan.prob).toBeGreaterThan(0);
  });

  it("play → quit → return under the same pseudo keeps stats AND the bots' reads", async () => {
    const backend = memoryBackend(); // the device's localStorage, surviving sessions

    // --- Session 1: play under "Baki" ---
    const s1 = createProfileStore(backend);
    let p = createProfile("Baki", { id: "a" });
    await s1.saveProfile(p);
    s1.setActiveId("a");
    // lifetime results accumulate…
    p = { ...p, lifetime: accumulateHand(p.lifetime, { net: 20, bigBlind: 2 }) }; // win
    p = { ...p, lifetime: accumulateHand(p.lifetime, { net: -5, bigBlind: 2 }) }; // loss
    // …and so does the read the bots exploit (an over-folder).
    p = { ...p, stats: mkStats({ hands: 40, foldToCbet: { n: 30, d: 40 } }) };
    await s1.saveProfile(p);

    // While playing, the bots already exploit this leak.
    expect(exploitPlan(botCanBetView(HUMAN), passiveBase, readOf(p.stats), HUMAN).kind).toBe("bluff");

    // --- Quit (drop the store), then RETURN: a fresh store on the same device. ---
    const s2 = createProfileStore(backend);
    expect(s2.getActiveId()).toBe("a"); // remembers who was playing
    const reloaded = (await s2.loadProfile(s2.getActiveId()!))!;

    // Lifetime stats are intact — NOT reset.
    expect(reloaded.name).toBe("Baki");
    expect(reloaded.lifetime.handsPlayed).toBe(2);
    expect(reloaded.lifetime.handsWon).toBe(1);
    expect(reloaded.lifetime.netChips).toBe(15);
    expect(lifetimeBb100(reloaded.lifetime)).toBeCloseTo(375, 5); // (15/2)/2*100

    // The bots STILL exploit the reloaded read — explos survive the session.
    const plan = exploitPlan(botCanBetView(HUMAN), passiveBase, readOf(reloaded.stats), HUMAN);
    expect(plan.kind).toBe("bluff");
    expect(plan.prob).toBeGreaterThan(0);
  });
});
