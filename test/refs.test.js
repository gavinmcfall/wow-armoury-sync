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

test("portrait measures a new render and caches it under its ETag", async () => {
  const kv = fakeKv();
  const fetchImage = renderFetch(await encodePng(100, 200, figurePixel));
  const refs = createRefs({ client: client(fakeFetch(iconRoute)), kv, fetchImage });

  assert.deepEqual(await refs.portrait(RENDER), FOCUS);
  assert.deepEqual(kv.json("ref:portrait:/us/character/barthilas/196/202694596-main-raw.png"), { etag: '"v1"', focus: FOCUS });
  assert.deepEqual(refs.stats(), { hits: 0, fetched: 1, skipped: 0 });
});

test("portrait reuses the cached focus when the render hasn't changed", async () => {
  const kv = fakeKv({ "ref:portrait:/us/character/barthilas/196/202694596-main-raw.png": { etag: '"v1"', focus: FOCUS } });
  const fetchImage = renderFetch(new Uint8Array(), '"v1"');
  const refs = createRefs({ client: client(fakeFetch(iconRoute)), kv, fetchImage });

  assert.deepEqual(await refs.portrait(RENDER), FOCUS);
  assert.equal(fetchImage.calls[0].ifNoneMatch, '"v1"');
  assert.deepEqual(refs.stats(), { hits: 1, fetched: 0, skipped: 0 });
});

test("portrait measures again when the render has changed", async () => {
  const kv = fakeKv({ "ref:portrait:/us/character/barthilas/196/202694596-main-raw.png": { etag: '"old"', focus: { x: 0.1, top: 0.1, height: 0.1 } } });
  const fetchImage = renderFetch(await encodePng(100, 200, figurePixel), '"v2"');
  const refs = createRefs({ client: client(fakeFetch(iconRoute)), kv, fetchImage });

  assert.deepEqual(await refs.portrait(RENDER), FOCUS);
  assert.equal(kv.json("ref:portrait:/us/character/barthilas/196/202694596-main-raw.png").etag, '"v2"');
});

test("portrait falls back to the cached focus when the render server fails", async () => {
  const kv = fakeKv({ "ref:portrait:/us/character/barthilas/196/202694596-main-raw.png": { etag: '"v1"', focus: FOCUS } });
  const refs = createRefs({ client: client(fakeFetch(iconRoute)), kv, fetchImage: async () => new Response(null, { status: 503 }) });

  assert.deepEqual(await refs.portrait(RENDER), FOCUS);
});
