import { test } from "node:test";
import assert from "node:assert/strict";
import { createRefs } from "../src/refs.js";
import { fakeKv, fakeFetch, client } from "./helpers.js";

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
