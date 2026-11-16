import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPvpView, bracketPaths } from "../src/views/pvp.js";

const NOW = "2026-11-16T14:17:00.000Z";
const LINK = (seg) => ({ href: `https://us.api.blizzard.com/profile/wow/character/barthilas/x/pvp-bracket/${seg}?namespace=profile-us` });

const SUMMARY = {
  honor_level: 2,
  honorable_kills: 5103,
  pvp_map_statistics: [
    { world_map: { name: "Eye of the Storm", id: 566 }, match_statistics: { played: 1, won: 0, lost: 1 } },
    { world_map: { name: "Alterac Valley", id: 30 }, match_statistics: { played: 6, won: 3, lost: 3 } },
    { world_map: { name: "Classic Warsong Gulch", id: 489 }, match_statistics: { played: 3, won: 1, lost: 2 } },
  ],
};

const build = (over = {}) => buildPvpView({ game: "retail", fetchedAt: NOW, summary: SUMMARY, brackets: {}, ...over });

test("carries schema version, game and fetch time", () => {
  const view = build();
  assert.equal(view.schemaVersion, 1);
  assert.equal(view.game, "retail");
  assert.equal(view.fetchedAt, NOW);
});

test("retail carries honour level and honourable kills, and no rank", () => {
  const view = build();
  assert.equal(view.honorLevel, 2);
  assert.equal(view.honorableKills, 5103);
  assert.equal(view.rank, null);
});

test("Forever carries its rank and honourable kills, and no honour level", () => {
  const view = build({ game: "forever", summary: { honorable_kills: 12, pvp_rank: 3 } });
  assert.equal(view.honorLevel, null);
  assert.equal(view.honorableKills, 12);
  assert.equal(view.rank, 3);
});

test("retail lists every bracket, unrated where the character has no rating", () => {
  assert.deepEqual(build().brackets, [
    { id: "2v2", name: "2v2 Arena", rating: null },
    { id: "3v3", name: "3v3 Arena", rating: null },
    { id: "rbg", name: "Rated Battlegrounds", rating: null },
    { id: "shuffle", name: "Solo Shuffle", rating: null },
    { id: "blitz", name: "Battleground Blitz", rating: null },
  ]);
});

test("a bracket's rating comes from its bracket response; per-spec brackets take the best", () => {
  const brackets = {
    "3v3": { rating: 1650 },
    "shuffle-paladin-holy": { rating: 1400 },
    "shuffle-paladin-retribution": { rating: 1720 },
  };
  const ratings = Object.fromEntries(build({ brackets }).brackets.map((b) => [b.id, b.rating]));
  assert.deepEqual(ratings, { "2v2": null, "3v3": 1650, rbg: null, shuffle: 1720, blitz: null });
});

test("Forever has no rated brackets", () => {
  assert.deepEqual(build({ game: "forever", summary: { honorable_kills: 0, pvp_rank: 0 } }).brackets, []);
});

test("battlegrounds are listed most played first, then by name", () => {
  assert.deepEqual(build().battlegrounds, [
    { name: "Alterac Valley", played: 6, won: 3, lost: 3 },
    { name: "Classic Warsong Gulch", played: 3, won: 1, lost: 2 },
    { name: "Eye of the Storm", played: 1, won: 0, lost: 1 },
  ]);
});

test("a missing summary gives zero kills and empty lists", () => {
  const view = build({ summary: null });
  assert.equal(view.honorableKills, 0);
  assert.equal(view.honorLevel, null);
  assert.deepEqual(view.battlegrounds, []);
});

test("bracketPaths takes the bracket segments the summary links to", () => {
  assert.deepEqual(bracketPaths({ brackets: [LINK("3v3"), LINK("shuffle-paladin-retribution")] }), ["3v3", "shuffle-paladin-retribution"]);
  assert.deepEqual(bracketPaths({ honorable_kills: 0 }), []);
  assert.deepEqual(bracketPaths(null), []);
});
