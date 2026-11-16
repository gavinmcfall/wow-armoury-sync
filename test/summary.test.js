import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildSummary, notListedSummary } from "../src/views/summary.js";
import { trackedCharacters } from "../src/characters.js";

const load = (f) => JSON.parse(readFileSync(new URL(`./fixtures/${f}`, import.meta.url), "utf8"));
const RETAIL = load("retail-consecrator.json");
const FOREVER = load("forever-recurve.json");
const NOW = "2026-11-16T14:17:00.000Z";
const chars = trackedCharacters("us");
const byKey = (k) => chars.find((c) => c.key === k);

test("retail summary", () => {
  const s = buildSummary(byKey("retail:us:barthilas:cònsecrator"), RETAIL.profile, RETAIL.media, NOW, null);
  assert.deepEqual(s.route, ["retail", "barthilas", "cònsecrator"]);
  assert.equal(s.status, "ok");
  assert.equal(s.name, "Cònsecrator");
  assert.equal(s.surname, null);
  assert.equal(s.realm, "Barthilas");
  assert.equal(s.ruleset, null);
  assert.equal(s.title, "Vengeance Incarnate");
  assert.equal(s.guild, "Big Chur");
  assert.equal(s.achievementPoints, 11940);
  assert.equal(s.faction, "HORDE");
  assert.equal(s.spec, "Retribution");
  assert.equal(s.characterClass, "Paladin");
  assert.match(s.inset, /inset/);
  assert.equal(s.lastSuccessAt, NOW);
});

test("forever summary", () => {
  const s = buildSummary(byKey("forever:us:recurve-ravenholt"), FOREVER.profile, FOREVER.media, NOW, "Beast Mastery");
  assert.deepEqual(s.route, ["forever", "recurve-ravenholt"]);
  assert.equal(s.realm, null);
  assert.equal(s.ruleset, "Normal");
  assert.equal(s.name, "Recurve");
  assert.equal(s.surname, "Ravenholt");
  assert.equal(s.spec, "Beast Mastery");
  assert.equal(s.faction, "ALLIANCE");
  assert.equal(s.title, null);
  assert.equal(s.guild, null);
  // Forever media has no inset; the avatar stands in.
  assert.match(s.inset, /avatar/);
});

test("not-listed summary has display names", () => {
  assert.deepEqual(notListedSummary(byKey("forever:us:consecrator-ravenholt")), {
    key: "forever:us:consecrator-ravenholt",
    game: "forever",
    status: "not-listed",
    route: ["forever", "consecrator-ravenholt"],
    name: "Consecrator",
    surname: "Ravenholt",
  });
  assert.equal(notListedSummary(byKey("retail:us:barthilas:cònsecrator")).name, "Cònsecrator");
});

test("trackedCharacters routes", () => {
  for (const c of chars) {
    assert.equal(c.route[0], c.game);
    assert.equal(c.route.length, c.game === "retail" ? 3 : 2);
  }
});

test("summary carries the portrait it is given, or null", () => {
  const portrait = { url: "https://render/main-raw.png", focus: { x: 0.5, top: 0.3, height: 0.25 } };
  const c = byKey("retail:us:barthilas:cònsecrator");
  assert.deepEqual(buildSummary(c, RETAIL.profile, RETAIL.media, NOW, null, portrait).portrait, portrait);
  assert.equal(buildSummary(c, RETAIL.profile, RETAIL.media, NOW).portrait, null);
});

test("summary carries Blizzard's background for the character's class", () => {
  const retail = buildSummary(byKey("retail:us:barthilas:cònsecrator"), RETAIL.profile, RETAIL.media, NOW);
  assert.equal(retail.background, "https://render.worldofwarcraft.com/profile-backgrounds/v2/armory_bg_class_paladin.jpg");
  const forever = buildSummary(byKey("forever:us:recurve-ravenholt"), FOREVER.profile, FOREVER.media, NOW);
  assert.equal(forever.background, "https://render.worldofwarcraft.com/profile-backgrounds/v2/armory_bg_class_hunter.jpg");
});

test("summary background is null for a class it doesn't know", () => {
  const profile = { ...RETAIL.profile, character_class: { id: 99, name: "Tinker" } };
  assert.equal(buildSummary(byKey("retail:us:barthilas:cònsecrator"), profile, RETAIL.media, NOW).background, null);
});
