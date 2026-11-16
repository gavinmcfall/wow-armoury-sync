import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildReputationView } from "../src/views/reputation.js";

const load = (f) => JSON.parse(readFileSync(new URL(`./fixtures/${f}`, import.meta.url), "utf8"));
const RETAIL = load("retail-consecrator.json");
const FOREVER = load("forever-recurve.json");
const FETCHED = "2026-11-16T14:17:00.000Z";

// Forever's faction tree, as refs.factionGroups() returns it: the headers in
// the API's order, and the header each faction sits under.
const FOREVER_GROUPS = {
  order: ["Alliance", "Steamwheedle Cartel"],
  byFaction: { 47: "Alliance", 69: "Alliance", 72: "Alliance", 54: "Alliance", 369: "Steamwheedle Cartel" },
};

const forever = (groups = FOREVER_GROUPS) =>
  buildReputationView({ game: "forever", fetchedAt: FETCHED, reputations: FOREVER.reputations, groups });

test("reputation view groups factions under their header, in the API's header order", () => {
  const view = forever();
  assert.equal(view.schemaVersion, 1);
  assert.equal(view.game, "forever");
  assert.equal(view.fetchedAt, FETCHED);
  assert.deepEqual(
    view.groups.map((g) => [g.name, g.factions.map((f) => f.name)]),
    [
      ["Alliance", ["Darnassus", "Gnomeregan Exiles", "Ironforge", "Stormwind"]],
      ["Steamwheedle Cartel", ["Gadgetzan"]],
      ["Other", ["Darkmoon Faire", "High Order", "Kirin Tor", "Nightclaw Druids"]],
    ],
  );
});

test("a faction carries its standing name and progress through it", () => {
  const ironforge = forever().groups[0].factions.find((f) => f.name === "Ironforge");
  assert.deepEqual(ironforge, { id: 47, name: "Ironforge", standing: "Friendly", value: 1571, max: 6000, renown: null, paragon: null });
});

test("a renown faction carries its renown level", () => {
  const view = buildReputationView({ game: "retail", fetchedAt: FETCHED, reputations: RETAIL.reputations, groups: null });
  const maruuk = view.groups[0].factions.find((f) => f.name === "Maruuk Centaur");
  assert.deepEqual(maruuk, { id: 2503, name: "Maruuk Centaur", standing: "Renown 23", value: 513, max: 2500, renown: 23, paragon: null });
});

test("an exalted faction with paragon progress carries it", () => {
  const view = buildReputationView({ game: "retail", fetchedAt: FETCHED, reputations: RETAIL.reputations, groups: null });
  const nightfallen = view.groups[0].factions.find((f) => f.name === "The Nightfallen");
  assert.deepEqual(nightfallen.paragon, { value: 9137, max: 10000 });
  assert.equal(nightfallen.standing, "Exalted");
});

test("without a faction tree every faction is in one Other group", () => {
  const view = forever(null);
  assert.deepEqual(view.groups.map((g) => g.name), ["Other"]);
  assert.equal(view.groups[0].factions.length, 9);
});

test("a header the character has no standing with is left out", () => {
  const view = forever({ order: ["Horde", ...FOREVER_GROUPS.order], byFaction: FOREVER_GROUPS.byFaction });
  assert.deepEqual(view.groups.map((g) => g.name), ["Alliance", "Steamwheedle Cartel", "Other"]);
});

test("no reputations gives an empty view", () => {
  assert.deepEqual(buildReputationView({ game: "retail", fetchedAt: FETCHED, reputations: null, groups: null }).groups, []);
});
