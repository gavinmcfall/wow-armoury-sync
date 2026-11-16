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
