import { test } from "node:test";
import assert from "node:assert/strict";
import { createRefs } from "../src/refs.js";
import { fakeKv, fakeFetch, client } from "./helpers.js";
import { encodePng, figurePixel } from "./png.js";

const NS = "static-us";

function iconRoute(path) {
  const icon = path.match(/^\/data\/wow\/media\/item\/(\d+)$/);
  if (icon) return [200, { assets: [{ key: "icon", value: `https://render/icons/${icon[1]}.jpg` }] }];
  if (path === "/data/wow/playable-class/2") {
    return [200, { specializations: [{ name: "Holy" }, { name: "Protection" }, { name: "Retribution" }] }];
  }
  return [404, undefined];
}

test("itemIcon returns the cached url without an API call", async () => {
  const kv = fakeKv({ "ref:static-us:item-icon:100": "https://cached/100.jpg" });
  const fetchImpl = fakeFetch(iconRoute);
  const refs = createRefs({ client: client(fetchImpl), kv });

  assert.equal(await refs.itemIcon(NS, 100), "https://cached/100.jpg");
  assert.ok(!fetchImpl.calls.includes("/data/wow/media/item/100"));
  assert.deepEqual(refs.stats(), { hits: 1, fetched: 0, skipped: 0 });
});

// Counts KV reads: every read is a subrequest, and a run may make 10,000.
function countingKv(initial) {
  const kv = fakeKv(initial);
  const get = kv.get;
  kv.reads = 0;
  kv.get = (...args) => {
    kv.reads++;
    return get(...args);
  };
  return kv;
}

test("a reference looked up again in the same run is not read from KV again", async () => {
  const kv = countingKv({ "ref:static-us:item-icon:100": "https://cached/100.jpg" });
  const refs = createRefs({ client: client(fakeFetch(iconRoute)), kv });

  assert.equal(await refs.itemIcon(NS, 100), "https://cached/100.jpg");
  assert.equal(await refs.itemIcon(NS, 100), "https://cached/100.jpg");
  assert.equal(kv.reads, 1);
  assert.deepEqual(refs.stats(), { hits: 2, fetched: 0, skipped: 0 });
});

test("a reference fetched once in a run is not fetched again", async () => {
  const kv = countingKv();
  const fetchImpl = fakeFetch(iconRoute);
  const refs = createRefs({ client: client(fetchImpl), kv });

  await Promise.all([refs.itemIcon(NS, 200), refs.itemIcon(NS, 200)]);
  assert.equal(await refs.itemIcon(NS, 200), "https://render/icons/200.jpg");
  assert.equal(fetchImpl.calls.filter((p) => p === "/data/wow/media/item/200").length, 1);
  assert.equal(kv.reads, 1);
});

test("itemIcon fetches, caches and returns the icon asset on a miss", async () => {
  const kv = fakeKv();
  const refs = createRefs({ client: client(fakeFetch(iconRoute)), kv });

  assert.equal(await refs.itemIcon(NS, 200), "https://render/icons/200.jpg");
  assert.equal(kv.store.get("ref:static-us:item-icon:200"), "https://render/icons/200.jpg");
});

test("itemIcon returns null and caches nothing when the API 404s", async () => {
  const kv = fakeKv();
  const refs = createRefs({ client: client(fakeFetch(() => [404, undefined])), kv });

  assert.equal(await refs.itemIcon(NS, 300), null);
  assert.equal(kv.store.size, 0);
});

test("classSpecs caches the spec names for a class", async () => {
  const kv = fakeKv();
  const refs = createRefs({ client: client(fakeFetch(iconRoute)), kv });

  assert.deepEqual(await refs.classSpecs(NS, 2), ["Holy", "Protection", "Retribution"]);
  assert.deepEqual(kv.json("ref:static-us:class-specs:2"), ["Holy", "Protection", "Retribution"]);
});

test("stops fetching new references after maxNewLookups", async () => {
  const kv = fakeKv();
  const fetchImpl = fakeFetch(iconRoute);
  const refs = createRefs({ client: client(fetchImpl), kv, maxNewLookups: 1 });

  assert.equal(await refs.itemIcon(NS, 1), "https://render/icons/1.jpg");
  assert.equal(await refs.itemIcon(NS, 2), null);
  assert.ok(!fetchImpl.calls.includes("/data/wow/media/item/2"));
  assert.deepEqual(refs.stats(), { hits: 0, fetched: 1, skipped: 1 });
});

test("cached hits do not count against the cap", async () => {
  const kv = fakeKv({ "ref:static-us:item-icon:1": "https://cached/1.jpg" });
  const refs = createRefs({ client: client(fakeFetch(iconRoute)), kv, maxNewLookups: 1 });

  assert.equal(await refs.itemIcon(NS, 1), "https://cached/1.jpg");
  assert.equal(await refs.itemIcon(NS, 2), "https://render/icons/2.jpg");
  assert.deepEqual(refs.stats(), { hits: 1, fetched: 1, skipped: 0 });
});

// A render server stand-in: serves `png` with an ETag and honours If-None-Match.
function renderFetch(png, etag = '"v1"') {
  const calls = [];
  const impl = async (url, init = {}) => {
    calls.push({ url, ifNoneMatch: init.headers?.["If-None-Match"] ?? null });
    if (init.headers?.["If-None-Match"] === etag) return new Response(null, { status: 304 });
    return new Response(png, { status: 200, headers: { ETag: etag } });
  };
  impl.calls = calls;
  return impl;
}

const RENDER = "https://render.worldofwarcraft.com/us/character/barthilas/196/202694596-main-raw.png";
const FOCUS = { x: 0.5, top: 0.085, height: 0.27 };
const FRAMES = { focus: FOCUS, figure: { x: 0.5, top: 0.085, height: 0.53 } };
const KEY = "ref:portrait:/us/character/barthilas/196/202694596-main-raw.png";

test("portrait measures a new render and caches it under its ETag", async () => {
  const kv = fakeKv();
  const fetchImage = renderFetch(await encodePng(100, 200, figurePixel));
  const refs = createRefs({ client: client(fakeFetch(iconRoute)), kv, fetchImage });

  assert.deepEqual(await refs.portrait(RENDER), FRAMES);
  assert.deepEqual(kv.json(KEY), { etag: '"v1"', ...FRAMES });
  assert.deepEqual(refs.stats(), { hits: 0, fetched: 1, skipped: 0 });
});

test("portrait reuses the cached frames when the render hasn't changed", async () => {
  const kv = fakeKv({ [KEY]: { etag: '"v1"', ...FRAMES } });
  const fetchImage = renderFetch(new Uint8Array(), '"v1"');
  const refs = createRefs({ client: client(fakeFetch(iconRoute)), kv, fetchImage });

  assert.deepEqual(await refs.portrait(RENDER), FRAMES);
  assert.equal(fetchImage.calls[0].ifNoneMatch, '"v1"');
  assert.deepEqual(refs.stats(), { hits: 1, fetched: 0, skipped: 0 });
});

test("portrait measures again when the render has changed", async () => {
  const kv = fakeKv({ [KEY]: { etag: '"old"', focus: { x: 0.1, top: 0.1, height: 0.1 }, figure: { x: 0.1, top: 0.1, height: 0.2 } } });
  const fetchImage = renderFetch(await encodePng(100, 200, figurePixel), '"v2"');
  const refs = createRefs({ client: client(fakeFetch(iconRoute)), kv, fetchImage });

  assert.deepEqual(await refs.portrait(RENDER), FRAMES);
  assert.equal(kv.json(KEY).etag, '"v2"');
});

test("portrait measures again when the cache predates the figure frame", async () => {
  // Written by 2.1.x: focus only. The render hasn't changed, but the entry
  // can't answer, so it is fetched in full rather than revalidated.
  const kv = fakeKv({ [KEY]: { etag: '"v1"', focus: FOCUS } });
  const fetchImage = renderFetch(await encodePng(100, 200, figurePixel), '"v1"');
  const refs = createRefs({ client: client(fakeFetch(iconRoute)), kv, fetchImage });

  assert.deepEqual(await refs.portrait(RENDER), FRAMES);
  assert.equal(fetchImage.calls[0].ifNoneMatch, null);
  assert.deepEqual(kv.json(KEY), { etag: '"v1"', ...FRAMES });
});

test("portrait falls back to the cached frames when the render server fails", async () => {
  const kv = fakeKv({ [KEY]: { etag: '"v1"', ...FRAMES } });
  const refs = createRefs({ client: client(fakeFetch(iconRoute)), kv, fetchImage: async () => new Response(null, { status: 503 }) });

  assert.deepEqual(await refs.portrait(RENDER), FRAMES);
});

// A small faction tree: Classic holds a nested header (Horde) and a faction;
// Midnight holds one faction; Darkmoon Faire is a root that isn't a header.
const FACTIONS = {
  index: { root_factions: [{ id: 1, name: "Classic" }, { id: 2, name: "Midnight" }, { id: 3, name: "Darkmoon Faire" }] },
  1: { id: 1, name: "Classic", is_header: true, factions: [{ id: 10, name: "Horde" }, { id: 11, name: "Argent Dawn" }] },
  10: { id: 10, name: "Horde", is_header: true, factions: [{ id: 100, name: "Orgrimmar" }] },
  11: { id: 11, name: "Argent Dawn" },
  100: { id: 100, name: "Orgrimmar" },
  2: { id: 2, name: "Midnight", is_header: true, factions: [{ id: 20, name: "Amani Tribe" }] },
  20: { id: 20, name: "Amani Tribe" },
  3: { id: 3, name: "Darkmoon Faire" },
};
const GROUPS = { order: ["Classic", "Midnight"], byFaction: { 10: "Classic", 11: "Classic", 100: "Classic", 20: "Midnight" } };
const GROUPS_KEY = "ref:static-us:faction-groups";
const DAY = 24 * 60 * 60 * 1000;
const T0 = Date.parse("2026-11-16T14:17:00.000Z");

function factionRoute(path) {
  if (path === "/data/wow/reputation-faction/index") return [200, FACTIONS.index];
  const m = path.match(/^\/data\/wow\/reputation-faction\/(\d+)$/);
  return m && FACTIONS[m[1]] ? [200, FACTIONS[m[1]]] : [404, undefined];
}

test("factionGroups walks the faction tree and caches which header each faction is under", async () => {
  const kv = fakeKv();
  const refs = createRefs({ client: client(fakeFetch(factionRoute)), kv, now: () => T0 });

  assert.deepEqual(await refs.factionGroups(NS), GROUPS);
  assert.deepEqual(kv.json(GROUPS_KEY), { builtAt: T0, ...GROUPS });
  // The index, three roots, and the four factions under the two headers.
  assert.deepEqual(refs.stats(), { hits: 0, fetched: 8, skipped: 0 });
});

test("factionGroups uses a cached tree younger than 30 days without calling the API", async () => {
  const kv = fakeKv({ [GROUPS_KEY]: { builtAt: T0 - 29 * DAY, ...GROUPS } });
  const fetchImpl = fakeFetch(factionRoute);
  const refs = createRefs({ client: client(fetchImpl), kv, now: () => T0 });

  assert.deepEqual(await refs.factionGroups(NS), GROUPS);
  assert.deepEqual(fetchImpl.calls, []);
  assert.deepEqual(refs.stats(), { hits: 1, fetched: 0, skipped: 0 });
});

test("factionGroups walks the tree again once the cached one is 30 days old", async () => {
  const stale = { builtAt: T0 - 30 * DAY, order: ["Classic"], byFaction: { 11: "Classic" } };
  const kv = fakeKv({ [GROUPS_KEY]: stale });
  const refs = createRefs({ client: client(fakeFetch(factionRoute)), kv, now: () => T0 });

  assert.deepEqual(await refs.factionGroups(NS), GROUPS);
  assert.equal(kv.json(GROUPS_KEY).builtAt, T0);
});

test("factionGroups keeps the old tree when a request fails during the walk", async () => {
  const stale = { builtAt: T0 - 40 * DAY, order: ["Classic"], byFaction: { 11: "Classic" } };
  const kv = fakeKv({ [GROUPS_KEY]: stale });
  const failing = (path) => (path.endsWith("/100") ? [503, undefined] : factionRoute(path));
  const refs = createRefs({ client: client(fakeFetch(failing)), kv, now: () => T0 });

  assert.deepEqual(await refs.factionGroups(NS), { order: ["Classic"], byFaction: { 11: "Classic" } });
  assert.deepEqual(kv.json(GROUPS_KEY), stale);
});

test("factionGroups returns null when the walk fails and nothing is cached", async () => {
  const kv = fakeKv();
  const refs = createRefs({ client: client(fakeFetch(() => [503, undefined])), kv, now: () => T0 });

  assert.equal(await refs.factionGroups(NS), null);
  assert.equal(kv.store.size, 0);
});

test("factionGroups stops a walk that would pass the lookup cap and keeps nothing from it", async () => {
  const kv = fakeKv();
  const fetchImpl = fakeFetch(factionRoute);
  const refs = createRefs({ client: client(fetchImpl), kv, maxNewLookups: 5, now: () => T0 });

  assert.equal(await refs.factionGroups(NS), null);
  assert.equal(kv.store.size, 0);
  assert.equal(refs.stats().skipped, 1);
});

// Three roots: Characters and Dungeons & Raids show, Guild is a guild
// category and Do Not Display is Blizzard's hidden bucket.
const ACH_CATEGORIES = {
  index: { root_categories: [{ id: 15076 }, { id: 168 }, { id: 92 }, { id: 15425 }] },
  15076: { id: 15076, name: "Guild", is_guild_category: true, display_order: 0, aggregates_by_faction: {} },
  168: {
    id: 168,
    name: "Dungeons & Raids",
    display_order: 7,
    aggregates_by_faction: { alliance: { quantity: 1589, points: 16875 }, horde: { quantity: 1589, points: 16875 } },
  },
  92: {
    id: 92,
    name: "Characters",
    display_order: 1,
    aggregates_by_faction: { alliance: { quantity: 40, points: 495 }, horde: { quantity: 40, points: 495 } },
  },
  15425: { id: 15425, name: "Do Not Display", display_order: 99, aggregates_by_faction: {} },
};
const ACH_ROOTS = {
  roots: [
    { id: 92, name: "Characters", total: ACH_CATEGORIES[92].aggregates_by_faction },
    { id: 168, name: "Dungeons & Raids", total: ACH_CATEGORIES[168].aggregates_by_faction },
  ],
};
const ACH_KEY = "ref:static-us:achievement-categories";

function achievementRoute(path) {
  if (path === "/data/wow/achievement-category/index") return [200, ACH_CATEGORIES.index];
  const cat = path.match(/^\/data\/wow\/achievement-category\/(\d+)$/);
  if (cat) return ACH_CATEGORIES[cat[1]] ? [200, ACH_CATEGORIES[cat[1]]] : [404, undefined];
  if (path === "/data/wow/achievement/6") return [200, { id: 6, name: "Level 10", points: 10, category: { id: 92, name: "Characters" } }];
  if (path === "/data/wow/media/achievement/6") return [200, { assets: [{ key: "icon", value: "https://render/icons/236562.jpg" }] }];
  return [404, undefined];
}

test("achievementCategories lists the shown top-level categories in display order and caches them", async () => {
  const kv = fakeKv();
  const refs = createRefs({ client: client(fakeFetch(achievementRoute)), kv, now: () => T0 });

  assert.deepEqual(await refs.achievementCategories(NS), ACH_ROOTS);
  assert.deepEqual(kv.json(ACH_KEY), { builtAt: T0, ...ACH_ROOTS });
  // The index and the four roots.
  assert.deepEqual(refs.stats(), { hits: 0, fetched: 5, skipped: 0 });
});

test("achievementCategories uses a cached list younger than 30 days without calling the API", async () => {
  const kv = fakeKv({ [ACH_KEY]: { builtAt: T0 - 29 * DAY, ...ACH_ROOTS } });
  const fetchImpl = fakeFetch(achievementRoute);
  const refs = createRefs({ client: client(fetchImpl), kv, now: () => T0 });

  assert.deepEqual(await refs.achievementCategories(NS), ACH_ROOTS);
  assert.deepEqual(fetchImpl.calls, []);
});

test("achievementCategories keeps the old list when a request fails", async () => {
  const stale = { builtAt: T0 - 40 * DAY, roots: [ACH_ROOTS.roots[0]] };
  const kv = fakeKv({ [ACH_KEY]: stale });
  const failing = (path) => (path.endsWith("/168") ? [503, undefined] : achievementRoute(path));
  const refs = createRefs({ client: client(fakeFetch(failing)), kv, now: () => T0 });

  assert.deepEqual(await refs.achievementCategories(NS), { roots: stale.roots });
  assert.deepEqual(kv.json(ACH_KEY), stale);
});

test("achievementCategories is fetched once per namespace per run", async () => {
  const fetchImpl = fakeFetch(achievementRoute);
  const refs = createRefs({ client: client(fetchImpl), kv: fakeKv(), now: () => T0 });
  await Promise.all([refs.achievementCategories(NS), refs.achievementCategories(NS)]);
  assert.equal(fetchImpl.calls.filter((p) => p === "/data/wow/achievement-category/index").length, 1);
});

const DETAILS_KEY = "ref:static-us:achievement-details";

test("achievementDetails fetches points, category and icon, and caches them all under one key", async () => {
  const kv = fakeKv();
  const refs = createRefs({ client: client(fakeFetch(achievementRoute)), kv });

  const details = await refs.achievementDetails(NS, [6, 7]);
  assert.deepEqual(details, { 6: { points: 10, category: "Characters", icon: "https://render/icons/236562.jpg" } });
  assert.deepEqual(kv.json(DETAILS_KEY), details);
  // Each achievement is one lookup (two requests); 7 is unknown to the API.
  assert.deepEqual(refs.stats(), { hits: 0, fetched: 2, skipped: 0 });
});

test("achievementDetails reads the cached map once a run and fetches only what it lacks", async () => {
  const cached = { 9: { points: 5, category: "Quests", icon: null } };
  const kv = countingKv({ [DETAILS_KEY]: cached });
  const fetchImpl = fakeFetch(achievementRoute);
  const refs = createRefs({ client: client(fetchImpl), kv });

  assert.deepEqual(await refs.achievementDetails(NS, [9]), cached);
  const both = await refs.achievementDetails(NS, [9, 6]);
  assert.deepEqual(Object.keys(both).sort(), ["6", "9"]);
  assert.ok(!fetchImpl.calls.includes("/data/wow/achievement/9"));
  assert.equal(kv.reads, 1);
  assert.deepEqual(Object.keys(kv.json(DETAILS_KEY)).sort(), ["6", "9"]);
});

test("achievementDetails fetches in the order given and stops at the lookup cap", async () => {
  const route = (path) => {
    const m = path.match(/^\/data\/wow\/achievement\/(\d+)$/);
    if (m) return [200, { points: Number(m[1]), category: { name: "C" } }];
    return [404, undefined];
  };
  const kv = fakeKv();
  const refs = createRefs({ client: client(fakeFetch(route)), kv, maxNewLookups: 2 });

  assert.deepEqual(Object.keys(await refs.achievementDetails(NS, [30, 20, 10])).sort(), ["20", "30"]);
  assert.equal(refs.stats().skipped, 1);
});

test("achievementDetails writes nothing when there is nothing new", async () => {
  const kv = fakeKv({ [DETAILS_KEY]: { 6: { points: 10, category: "Characters", icon: null } } });
  let puts = 0;
  const put = kv.put;
  kv.put = (...args) => {
    puts++;
    return put(...args);
  };
  const refs = createRefs({ client: client(fakeFetch(achievementRoute)), kv });
  await refs.achievementDetails(NS, [6]);
  assert.equal(puts, 0);
});

function collectionRoute(path) {
  const routes = {
    "/data/wow/pet/39": { id: 39, icon: "https://render/icons/pet-39.jpg" },
    "/data/wow/mount/6": { id: 6, creature_displays: [{ id: 2404 }] },
    "/data/wow/media/creature-display/2404": { assets: [{ key: "zoom", value: "https://render/npcs/zoom/2404.jpg" }] },
    "/data/wow/mount/7": { id: 7, creature_displays: [] },
    "/data/wow/toy/5": { id: 5, media: { id: 187344 } },
    "/data/wow/heirloom/706": { id: 706, media: { id: 122353 } },
  };
  if (routes[path]) return [200, routes[path]];
  return iconRoute(path);
}

test("petIcon reads the species' icon and caches it", async () => {
  const kv = fakeKv();
  const refs = createRefs({ client: client(fakeFetch(collectionRoute)), kv });
  assert.equal(await refs.petIcon(NS, 39), "https://render/icons/pet-39.jpg");
  assert.equal(kv.store.get("ref:static-us:pet-icon:39"), "https://render/icons/pet-39.jpg");
});

test("mountIcon uses the mount's first creature display's zoom image", async () => {
  const kv = fakeKv();
  const refs = createRefs({ client: client(fakeFetch(collectionRoute)), kv });
  assert.equal(await refs.mountIcon(NS, 6), "https://render/npcs/zoom/2404.jpg");
  assert.equal(kv.store.get("ref:static-us:mount-icon:6"), "https://render/npcs/zoom/2404.jpg");
  assert.equal(await refs.mountIcon(NS, 7), null);
});

test("toyIcon and heirloomIcon resolve their item and use the item icon cache", async () => {
  const kv = fakeKv();
  const refs = createRefs({ client: client(fakeFetch(collectionRoute)), kv });
  assert.equal(await refs.toyIcon(NS, 5), "https://render/icons/187344.jpg");
  assert.equal(await refs.heirloomIcon(NS, 706), "https://render/icons/122353.jpg");
  assert.equal(kv.json("ref:static-us:toy-item:5"), 187344);
  assert.equal(kv.store.get("ref:static-us:item-icon:122353"), "https://render/icons/122353.jpg");
});
