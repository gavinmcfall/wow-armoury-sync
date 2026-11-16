import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { syncAll, SCHEMA_VERSION } from "../src/sync.js";
import { trackedCharacters } from "../src/characters.js";
import { fakeKv, fakeFetch, client } from "./helpers.js";
import { encodePng, figurePixel } from "./png.js";

const load = (f) => JSON.parse(readFileSync(new URL(`./fixtures/${f}`, import.meta.url), "utf8"));
const FOREVER = load("forever-recurve.json");
const RETAIL = load("retail-consecrator.json");
const NOW = "2026-11-16T14:17:00.000Z";
const chars = trackedCharacters("us");
const RECURVE = chars.find((c) => c.key === "forever:us:recurve-ravenholt");
const CONSECRATOR = chars.find((c) => c.key === "retail:us:barthilas:cònsecrator");
const VIEW_KEY = "view:v1:forever:us:recurve-ravenholt:character";

const ENDPOINTS = {
  "": "profile",
  "/equipment": "equipment",
  "/statistics": "statistics",
  "/specializations": "specializations",
  "/character-media": "media",
  "/pvp-summary": "pvp",
  "/mythic-keystone-profile": "mythic",
  "/encounters/raids": "raids",
  "/reputations": "reputations",
  "/professions": "professions",
  "/achievements": "achievements",
  "/collections/mounts": "mounts",
  "/collections/pets": "pets",
  "/collections/toys": "toys",
  "/collections/heirlooms": "heirlooms",
};

// Serves the fixtures for both characters, item icons and the Paladin class.
function fixtureRoute(path) {
  for (const [base, fixture] of [
    ["/profile/wow/character/recurve-ravenholt", FOREVER],
    ["/profile/wow/character/barthilas/cònsecrator", RETAIL],
  ]) {
    if (path.startsWith(base)) {
      const field = ENDPOINTS[path.slice(base.length)];
      return field && fixture[field] ? [200, fixture[field]] : [404, undefined];
    }
  }
  const icon = path.match(/^\/data\/wow\/media\/item\/(\d+)$/);
  if (icon) return [200, { assets: [{ key: "icon", value: `https://render/icons/${icon[1]}.jpg` }] }];
  if (path === "/data/wow/playable-class/2") {
    return [200, { specializations: [{ name: "Holy" }, { name: "Protection" }, { name: "Retribution" }] }];
  }
  return [404, undefined];
}

// Renders 404 unless a test serves one, so no test reaches the network.
const noRenders = async () => new Response(null, { status: 404 });

const run = (kv, route = fixtureRoute, characters = [RECURVE], fetchImage = noRenders) =>
  syncAll({ client: client(fakeFetch(route)), kv, characters, now: () => NOW, fetchImage });

test("writes index v1 and a character view for a listed character", async () => {
  const kv = fakeKv();
  await run(kv);

  const index = kv.json("index");
  assert.equal(SCHEMA_VERSION, 1);
  assert.equal(index.schemaVersion, 1);
  assert.equal(index.updatedAt, NOW);
  assert.equal(index.characters[0].status, "ok");
  assert.equal(index.characters[0].spec, "Beast Mastery");
  assert.deepEqual(index.characters[0].route, ["forever", "recurve-ravenholt"]);

  const view = kv.json(VIEW_KEY);
  assert.equal(view.schemaVersion, 1);
  assert.equal(view.fetchedAt, NOW);
  assert.equal(view.equipment.length, 13);
  assert.ok(view.equipment.every((i) => i.icon?.startsWith("https://render/icons/")));
});

test("retail view lists every class spec from the class reference data", async () => {
  const kv = fakeKv();
  await run(kv, fixtureRoute, [CONSECRATOR]);
  const view = kv.json("view:v1:retail:us:barthilas:cònsecrator:character");
  assert.deepEqual(view.specs.map((s) => s.name), ["Holy", "Protection", "Retribution"]);
  assert.deepEqual(kv.json("ref:static-us:class-specs:2"), ["Holy", "Protection", "Retribution"]);
});

test("not-listed writes no view", async () => {
  const kv = fakeKv();
  await run(kv, () => [404, undefined]);
  assert.equal(kv.json(VIEW_KEY), undefined);
  assert.equal(kv.json("index").characters[0].status, "not-listed");
  assert.equal(kv.json("index").characters[0].name, "Recurve");
});

test("profile failure keeps the previous view and marks the summary error", async () => {
  const oldView = { schemaVersion: 1, fetchedAt: "2026-11-15T14:17:00.000Z", equipment: [] };
  const oldSummary = { key: RECURVE.key, game: "forever", status: "ok", name: "Recurve", lastSuccessAt: "2026-11-15T14:17:00.000Z" };
  const kv = fakeKv({ [VIEW_KEY]: oldView, index: { schemaVersion: 1, updatedAt: "x", characters: [oldSummary] } });

  await run(kv, () => [503, undefined]);

  assert.deepEqual(kv.json(VIEW_KEY), oldView);
  assert.deepEqual(kv.json("index").characters[0], {
    ...oldSummary,
    route: ["forever", "recurve-ravenholt"],
    surname: "Ravenholt",
    status: "error",
    error: "profile HTTP 503",
  });
});

test("a failure with no previous summary still gives a named summary", async () => {
  const kv = fakeKv();
  await run(kv, () => [503, undefined]);
  const s = kv.json("index").characters[0];
  assert.equal(s.status, "error");
  assert.equal(s.name, "Recurve");
  assert.deepEqual(s.route, ["forever", "recurve-ravenholt"]);
});

test("a failed section does not stop the view", async () => {
  const kv = fakeKv();
  await run(kv, (path) => (path.endsWith("/equipment") ? [404, undefined] : fixtureRoute(path)));
  assert.deepEqual(kv.json(VIEW_KEY).equipment, []);
  assert.equal(kv.json("index").characters[0].status, "ok");
});

test("a core section server error keeps the previous view and marks the summary error", async () => {
  const oldView = { schemaVersion: 1, fetchedAt: "2026-11-15T14:17:00.000Z", equipment: [{ slot: "HEAD" }] };
  const oldSummary = { key: RECURVE.key, game: "forever", status: "ok", name: "Recurve", lastSuccessAt: "2026-11-15T14:17:00.000Z" };
  const kv = fakeKv({ [VIEW_KEY]: oldView, index: { schemaVersion: 1, updatedAt: "x", characters: [oldSummary] } });

  await run(kv, (path) => (path.endsWith("/equipment") ? [503, undefined] : fixtureRoute(path)));

  assert.deepEqual(kv.json(VIEW_KEY), oldView);
  const s = kv.json("index").characters[0];
  assert.equal(s.status, "error");
  assert.equal(s.error, "equipment HTTP 503");
  assert.equal(s.lastSuccessAt, "2026-11-15T14:17:00.000Z");
});

test("a profile 404 for a character that was synced before keeps its data", async () => {
  const oldView = { schemaVersion: 1, fetchedAt: "2026-11-15T14:17:00.000Z", equipment: [] };
  const oldSummary = { key: RECURVE.key, game: "forever", status: "ok", name: "Recurve", level: 23, lastSuccessAt: "2026-11-15T14:17:00.000Z" };
  const kv = fakeKv({ [VIEW_KEY]: oldView, index: { schemaVersion: 1, updatedAt: "x", characters: [oldSummary] } });

  await run(kv, () => [404, undefined]);

  assert.deepEqual(kv.json(VIEW_KEY), oldView);
  const s = kv.json("index").characters[0];
  assert.equal(s.status, "error");
  assert.equal(s.error, "profile HTTP 404");
  assert.equal(s.level, 23);
});

test("writes no legacy keys", async () => {
  const kv = fakeKv();
  await run(kv, fixtureRoute, [RECURVE, CONSECRATOR]);
  const legacy = [...kv.store.keys()].filter((k) => k.startsWith("character:") || k.startsWith("icon:"));
  assert.deepEqual(legacy, []);
});

test("returns ref lookup stats alongside the summaries", async () => {
  const kv = fakeKv();
  const result = await run(kv);
  assert.equal(result.summaries.length, 1);
  // 13 item icons, plus three lookups the fixtures don't serve: the faction
  // tree's index, the achievement categories' index, and the details of
  // Recurve's one completed achievement (points and icon count as two), and
  // an icon for each of 2 mounts, 5 pet species and 2 toys.
  assert.equal(result.refs.fetched, 26);
  assert.equal(result.refs.skipped, 0);
});

test("the summary carries a portrait measured from the character's render", async () => {
  const kv = fakeKv();
  const png = await encodePng(100, 200, figurePixel);
  const requested = [];
  await run(kv, fixtureRoute, [RECURVE], async (url) => {
    requested.push(url);
    return new Response(png, { status: 200, headers: { ETag: '"a"' } });
  });

  const render = FOREVER.media.assets.find((a) => a.key === "main-raw").value;
  assert.deepEqual(requested, [render]);
  assert.deepEqual(kv.json("index").characters[0].portrait, {
    url: render,
    focus: { x: 0.5, top: 0.085, height: 0.27 },
    figure: { x: 0.5, top: 0.085, height: 0.53 },
  });
});

test("a render that can't be fetched leaves the portrait null and the character ok", async () => {
  const kv = fakeKv();
  await run(kv, fixtureRoute, [RECURVE], async () => {
    throw new Error("connection reset");
  });

  const s = kv.json("index").characters[0];
  assert.equal(s.status, "ok");
  assert.equal(s.portrait, null);
});

const REP_KEY = "view:v1:forever:us:recurve-ravenholt:reputation";

test("writes a reputation view for a listed character", async () => {
  const kv = fakeKv();
  await run(kv);

  const view = kv.json(REP_KEY);
  assert.equal(view.schemaVersion, 1);
  assert.equal(view.fetchedAt, NOW);
  // The fixtures serve no faction tree, so every faction is in Other.
  assert.deepEqual(view.groups.map((g) => [g.name, g.factions.length]), [["Other", 9]]);
});

test("groups reputations by the faction tree", async () => {
  const kv = fakeKv();
  const tree = (path) => {
    if (path === "/data/wow/reputation-faction/index") return [200, { root_factions: [{ id: 469, name: "Alliance" }] }];
    if (path === "/data/wow/reputation-faction/469") return [200, { id: 469, name: "Alliance", is_header: true, factions: [{ id: 47 }, { id: 72 }] }];
    if (path === "/data/wow/reputation-faction/47") return [200, { id: 47, name: "Ironforge" }];
    if (path === "/data/wow/reputation-faction/72") return [200, { id: 72, name: "Stormwind" }];
    return fixtureRoute(path);
  };
  await run(kv, tree);

  assert.deepEqual(kv.json(REP_KEY).groups.map((g) => [g.name, g.factions.length]), [["Alliance", 2], ["Other", 7]]);
});

test("a reputations server error keeps the previous reputation view", async () => {
  const oldView = { schemaVersion: 1, fetchedAt: "2026-11-15T14:17:00.000Z", groups: [] };
  const kv = fakeKv({ [REP_KEY]: oldView });
  await run(kv, (path) => (path.endsWith("/reputations") ? [503, undefined] : fixtureRoute(path)));

  assert.deepEqual(kv.json(REP_KEY), oldView);
  assert.equal(kv.json("index").characters[0].status, "ok");
});

test("the summary lists the character's primary professions", async () => {
  const kv = fakeKv();
  await run(kv);
  assert.deepEqual(kv.json("index").characters[0].professions, [
    { id: 165, name: "Leatherworking" },
    { id: 393, name: "Skinning" },
  ]);
});

test("a professions server error keeps the previous professions", async () => {
  const kv = fakeKv();
  await run(kv);
  await run(kv, (path) => (path.endsWith("/professions") ? [503, undefined] : fixtureRoute(path)));
  assert.deepEqual(kv.json("index").characters[0].professions.map((p) => p.name), ["Leatherworking", "Skinning"]);
});

test("the faction tree is walked once per run, not once per character", async () => {
  const kv = fakeKv();
  const fetchImpl = fakeFetch(fixtureRoute);
  const both = [RECURVE, { ...RECURVE, key: "forever:us:recurve-copy" }];
  await syncAll({ client: client(fetchImpl), kv, characters: both, now: () => NOW, fetchImage: noRenders });
  assert.equal(fetchImpl.calls.filter((p) => p === "/data/wow/reputation-faction/index").length, 1);
});


const ACH_KEY = "view:v1:forever:us:recurve-ravenholt:achievements";

test("writes an achievements view for a listed character", async () => {
  const kv = fakeKv();
  await run(kv);

  const view = kv.json(ACH_KEY);
  assert.equal(view.schemaVersion, 1);
  assert.equal(view.fetchedAt, NOW);
  assert.deepEqual(view.total, { quantity: 1, points: 0 });
  assert.deepEqual(view.completed.map((a) => a.name), [FOREVER.achievements.achievements.find((a) => a.completed_timestamp).achievement.name]);
  // The fixtures serve no category tree.
  assert.deepEqual(view.categories, []);
});

test("achievement categories and recent details come from the reference data", async () => {
  const kv = fakeKv();
  const done = FOREVER.achievements.achievements.find((a) => a.completed_timestamp);
  const route = (path) => {
    if (path === "/data/wow/achievement-category/index") return [200, { root_categories: [{ id: 15596 }] }];
    if (path === "/data/wow/achievement-category/15596") {
      return [200, { id: 15596, name: "Adventure", display_order: 1, aggregates_by_faction: { alliance: { quantity: 120, points: 0 } } }];
    }
    if (path === `/data/wow/achievement/${done.id}`) return [200, { points: 0, category: { name: "Eastern Kingdoms" } }];
    if (path === `/data/wow/media/achievement/${done.id}`) return [200, { assets: [{ key: "icon", value: "https://render/icons/a.jpg" }] }];
    return fixtureRoute(path);
  };
  await run(kv, route);

  const view = kv.json(ACH_KEY);
  assert.deepEqual(view.categories, [{ id: 15596, name: "Adventure", quantity: 1, points: 0, total: { quantity: 120, points: 0 } }]);
  assert.equal(view.recent[0].category, "Eastern Kingdoms");
  assert.equal(view.recent[0].icon, "https://render/icons/a.jpg");
});

test("an achievements server error keeps the previous achievements view", async () => {
  const oldView = { schemaVersion: 1, fetchedAt: "2026-11-15T14:17:00.000Z", completed: [] };
  const kv = fakeKv({ [ACH_KEY]: oldView });
  await run(kv, (path) => (path.endsWith("/achievements") ? [503, undefined] : fixtureRoute(path)));

  assert.deepEqual(kv.json(ACH_KEY), oldView);
  assert.equal(kv.json("index").characters[0].status, "ok");
});

const COL_KEY = "view:v1:forever:us:recurve-ravenholt:collections";

test("writes a collections view for a listed character", async () => {
  const kv = fakeKv();
  await run(kv);

  const view = kv.json(COL_KEY);
  assert.equal(view.schemaVersion, 1);
  assert.equal(view.fetchedAt, NOW);
  assert.deepEqual(view.mounts.map((m) => m.name), FOREVER.mounts.mounts.map((m) => m.mount.name).sort());
  assert.equal(view.toys.length, FOREVER.toys.toys.length);
  assert.deepEqual(view.heirlooms, []);
  // The fixtures serve no icons.
  assert.ok(view.mounts.every((m) => m.icon === null));
});

test("collection icons come from the reference data", async () => {
  const kv = fakeKv();
  const pet = FOREVER.pets.pets[0].species;
  const mount = FOREVER.mounts.mounts[0].mount;
  const route = (path) => {
    if (path === `/data/wow/pet/${pet.id}`) return [200, { icon: "https://render/icons/pet.jpg" }];
    if (path === `/data/wow/mount/${mount.id}`) return [200, { creature_displays: [{ id: 99 }] }];
    if (path === "/data/wow/media/creature-display/99") return [200, { assets: [{ key: "zoom", value: "https://render/zoom/99.jpg" }] }];
    return fixtureRoute(path);
  };
  await run(kv, route);

  const view = kv.json(COL_KEY);
  assert.equal(view.pets.find((p) => p.id === pet.id).icon, "https://render/icons/pet.jpg");
  assert.equal(view.mounts.find((m) => m.id === mount.id).icon, "https://render/zoom/99.jpg");
});

test("a server error on any collection keeps the previous collections view", async () => {
  const oldView = { schemaVersion: 1, fetchedAt: "2026-11-15T14:17:00.000Z", mounts: [], pets: [], toys: [], heirlooms: [] };
  const kv = fakeKv({ [COL_KEY]: oldView });
  await run(kv, (path) => (path.endsWith("/collections/toys") ? [503, undefined] : fixtureRoute(path)));

  assert.deepEqual(kv.json(COL_KEY), oldView);
  assert.equal(kv.json("index").characters[0].status, "ok");
});
