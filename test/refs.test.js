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
