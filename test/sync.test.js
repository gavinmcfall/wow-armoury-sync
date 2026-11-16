import { test } from "node:test";
import assert from "node:assert/strict";
import { syncAll } from "../src/sync.js";
import { BlizzardClient } from "../src/blizzard.js";

// In-memory stand-in for a Workers KV namespace.
function fakeKv(initial = {}) {
  const store = new Map(Object.entries(initial).map(([k, v]) => [k, JSON.stringify(v)]));
  return {
    store,
    async get(key, type) {
      const v = store.get(key);
      if (v === undefined) return null;
      return type === "json" ? JSON.parse(v) : v;
    },
    async put(key, value) {
      store.set(key, value);
    },
    json(key) {
      const v = store.get(key);
      return v === undefined ? undefined : JSON.parse(v);
    },
  };
}

const PROFILE = {
  name: "Recurve",
  level: 23,
  race: { name: "High Order Skyborne" },
  character_class: { name: "Hunter" },
  active_spec: { name: "Beast Mastery" },
  faction: { name: "Alliance" },
  equipped_item_level: 11,
};

const EQUIPMENT = {
  equipped_items: [
    { slot: { type: "HEAD" }, item: { id: 100 }, media: { id: 100 } },
    { slot: { type: "CHEST" }, item: { id: 200 }, media: { id: 200 } },
  ],
};

const CHARACTER = {
  game: "forever",
  key: "forever:us:recurve-ravenholt",
  path: "recurve-ravenholt",
  profileNamespace: "profile-forever-us",
  staticNamespace: "static-forever-us",
};

// Builds a fetch stand-in from a function that maps a request path to
// [status, body]. Records every API path requested.
function fakeFetch(route) {
  const calls = [];
  const impl = async (url) => {
    if (url === "https://oauth.battle.net/token") {
      return new Response(JSON.stringify({ access_token: "t" }), { status: 200 });
    }
    const u = new URL(url);
    calls.push(u.pathname);
    const [status, body] = route(u.pathname, u.searchParams.get("namespace"));
    return new Response(body === undefined ? null : JSON.stringify(body), { status });
  };
  impl.calls = calls;
  return impl;
}

function client(fetchImpl) {
  return new BlizzardClient({ clientId: "id", clientSecret: "secret", region: "us", fetchImpl, retryDelayMs: 0 });
}

const NOW = "2026-11-16T14:17:00.000Z";

function happyRoute(path) {
  const base = "/profile/wow/character/recurve-ravenholt";
  if (path === base) return [200, PROFILE];
  if (path === `${base}/equipment`) return [200, EQUIPMENT];
  if (path.startsWith(base + "/")) return [200, { ok: true }];
  const icon = path.match(/^\/data\/wow\/media\/item\/(\d+)$/);
  if (icon) return [200, { assets: [{ key: "icon", value: `https://render/icons/${icon[1]}.jpg` }] }];
  return [404, undefined];
}

test("stores a listed character with its sections, icons and an index summary", async () => {
  const kv = fakeKv();
  await syncAll({ client: client(fakeFetch(happyRoute)), kv, characters: [CHARACTER], now: () => NOW });

  const record = kv.json("character:forever:us:recurve-ravenholt");
  assert.equal(record.profile.name, "Recurve");
  assert.deepEqual(record.equipment, EQUIPMENT);
  assert.deepEqual(record.reputations, { ok: true });
  assert.deepEqual(record.itemIcons, {
    100: "https://render/icons/100.jpg",
    200: "https://render/icons/200.jpg",
  });
  assert.equal(record.fetchedAt, NOW);

  const index = kv.json("index");
  assert.equal(index.updatedAt, NOW);
  assert.deepEqual(index.characters[0], {
    key: CHARACTER.key,
    game: "forever",
    status: "ok",
    name: "Recurve",
    realm: null,
    level: 23,
    race: "High Order Skyborne",
    characterClass: "Hunter",
    spec: "Beast Mastery",
    faction: "Alliance",
    itemLevel: 11,
    lastSuccessAt: NOW,
  });
});

test("records a character the API does not list yet as not-listed and writes no record", async () => {
  const kv = fakeKv();
  await syncAll({ client: client(fakeFetch(() => [404, undefined])), kv, characters: [CHARACTER], now: () => NOW });

  assert.equal(kv.json("character:forever:us:recurve-ravenholt"), undefined);
  assert.deepEqual(kv.json("index").characters[0], { key: CHARACTER.key, game: "forever", status: "not-listed" });
});

test("keeps the previous record and summary when the API fails", async () => {
  const previousSummary = {
    key: CHARACTER.key,
    game: "forever",
    status: "ok",
    name: "Recurve",
    realm: null,
    level: 22,
    race: "High Order Skyborne",
    characterClass: "Hunter",
    spec: "Beast Mastery",
    faction: "Alliance",
    itemLevel: 10,
    lastSuccessAt: "2026-11-15T14:17:00.000Z",
  };
  const previousRecord = { profile: { name: "Recurve", level: 22 }, fetchedAt: "2026-11-15T14:17:00.000Z" };
  const kv = fakeKv({
    "character:forever:us:recurve-ravenholt": previousRecord,
    index: { updatedAt: "2026-11-15T14:17:00.000Z", characters: [previousSummary] },
  });

  await syncAll({ client: client(fakeFetch(() => [503, undefined])), kv, characters: [CHARACTER], now: () => NOW });

  assert.deepEqual(kv.json("character:forever:us:recurve-ravenholt"), previousRecord);
  assert.deepEqual(kv.json("index").characters[0], { ...previousSummary, status: "error", error: "profile HTTP 503" });
});

test("reuses cached item icons instead of fetching them again", async () => {
  const kv = fakeKv({ "icon:static-forever-us:100": "https://render/icons/100.jpg" });
  const fetchImpl = fakeFetch(happyRoute);
  await syncAll({ client: client(fetchImpl), kv, characters: [CHARACTER], now: () => NOW });

  const iconCalls = fetchImpl.calls.filter((p) => p.startsWith("/data/wow/media/item/"));
  assert.deepEqual(iconCalls, ["/data/wow/media/item/200"]);
  assert.equal(kv.store.get("icon:static-forever-us:200"), "https://render/icons/200.jpg");
});

test("stores a missing section as null without failing the character", async () => {
  const kv = fakeKv();
  const route = (path) => (path.endsWith("/professions") ? [404, undefined] : happyRoute(path));
  await syncAll({ client: client(fakeFetch(route)), kv, characters: [CHARACTER], now: () => NOW });

  assert.equal(kv.json("character:forever:us:recurve-ravenholt").professions, null);
  assert.equal(kv.json("index").characters[0].status, "ok");
});
