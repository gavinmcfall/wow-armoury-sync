import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPveView } from "../src/views/pve.js";

const NOW = "2026-11-16T14:17:00.000Z";

const mode = (type, name, completed, total) => ({
  difficulty: { type, name },
  status: { type: completed === total ? "COMPLETE" : "IN_PROGRESS" },
  progress: { completed_count: completed, total_count: total, encounters: [] },
});

const RAIDS = {
  expansions: [
    {
      expansion: { name: "Legion", id: 395 },
      instances: [
        { instance: { name: "The Emerald Nightmare", id: 768 }, modes: [mode("LFR", "Raid Finder", 7, 7), mode("NORMAL", "Normal", 3, 7)] },
      ],
    },
    {
      expansion: { name: "Classic", id: 68 },
      instances: [{ instance: { name: "Molten Core", id: 741 }, modes: [mode("NORMAL", "Normal", 10, 10)] }],
    },
    {
      expansion: { name: "The War Within", id: 514 },
      instances: [{ instance: { name: "Nerub-ar Palace", id: 1273 }, modes: [mode("NORMAL", "Normal", 1, 8)] }],
    },
  ],
};

const DUNGEONS = {
  expansions: [
    {
      expansion: { name: "Wrath of the Lich King", id: 72 },
      instances: [
        { instance: { name: "Utgarde Keep", id: 285 }, modes: [mode("NORMAL", "Normal", 3, 3)] },
        { instance: { name: "Ahn'kahet: The Old Kingdom", id: 271 }, modes: [mode("HEROIC", "Heroic", 5, 5)] },
      ],
    },
    {
      expansion: { name: "Current Season", id: 505 },
      instances: [{ instance: { name: "Pit of Saron", id: 278 }, modes: [mode("MYTHIC_KEYSTONE", "Mythic+ Dungeons", 1, 1)] }],
    },
    {
      expansion: { name: "Dragonflight", id: 503 },
      instances: [{ instance: { name: "Ruby Life Pools", id: 1202 }, modes: [mode("NORMAL", "Normal", 3, 3)] }],
    },
  ],
};

const build = (over = {}) =>
  buildPveView({ game: "retail", fetchedAt: NOW, mythic: { current_mythic_rating: { rating: 1834.6 } }, raids: RAIDS, dungeons: DUNGEONS, ...over });

test("carries schema version, game and fetch time", () => {
  const view = build();
  assert.equal(view.schemaVersion, 1);
  assert.equal(view.game, "retail");
  assert.equal(view.fetchedAt, NOW);
});

test("raids are grouped by expansion, newest first, with kills per difficulty", () => {
  assert.deepEqual(build().raids, [
    { id: 514, name: "The War Within", instances: [{ id: 1273, name: "Nerub-ar Palace", modes: [{ difficulty: "Normal", completed: 1, total: 8 }] }] },
    {
      id: 395,
      name: "Legion",
      instances: [
        {
          id: 768,
          name: "The Emerald Nightmare",
          modes: [
            { difficulty: "Raid Finder", completed: 7, total: 7 },
            { difficulty: "Normal", completed: 3, total: 7 },
          ],
        },
      ],
    },
    { id: 68, name: "Classic", instances: [{ id: 741, name: "Molten Core", modes: [{ difficulty: "Normal", completed: 10, total: 10 }] }] },
  ]);
});

test("the current season's dungeons come first, then expansions newest first", () => {
  assert.deepEqual(
    build().dungeons.map((g) => g.name),
    ["Current Season", "Dragonflight", "Wrath of the Lich King"],
  );
});

test("instances keep the API's order within an expansion", () => {
  assert.deepEqual(
    build().dungeons[2].instances.map((i) => i.name),
    ["Utgarde Keep", "Ahn'kahet: The Old Kingdom"],
  );
});

test("retail carries the Mythic+ rating, rounded", () => {
  assert.deepEqual(build().mythicPlus, { rating: 1835 });
});

test("a retail character with no rating this season has a null rating", () => {
  assert.deepEqual(build({ mythic: { current_period: { period: { id: 1051 } } } }).mythicPlus, { rating: null });
});

test("Forever has no Mythic+ section", () => {
  assert.equal(build({ game: "forever", mythic: null }).mythicPlus, null);
});

test("no kills, or a section the API did not return, gives empty lists", () => {
  const view = build({ raids: {}, dungeons: null });
  assert.deepEqual(view.raids, []);
  assert.deepEqual(view.dungeons, []);
});

const run = (dungeon, level, timed, mapRating, ts) => ({
  completed_timestamp: ts,
  duration: 1_800_000,
  keystone_level: level,
  dungeon: { name: dungeon, id: dungeon.length },
  is_completed_within_time: timed,
  mythic_rating: { rating: mapRating / 2 },
  map_rating: { rating: mapRating },
});

const SEASON = {
  mythic_rating: { color: { r: 255, g: 128, b: 0, a: 1 }, rating: 1834.6 },
  best_runs: [
    run("Kings' Rest", 22, false, 480.2, Date.UTC(2026, 10, 2)),
    run("Kings' Rest", 21, true, 495.7, Date.UTC(2026, 10, 3)),
    run("Murder Row", 20, true, 470, Date.UTC(2026, 10, 4)),
  ],
};

test("mythicSeason carries the rating colour and the best run in each dungeon, highest score first", () => {
  const view = build({ mythic: { current_mythic_rating: { rating: 1834.6, color: { r: 255, g: 128, b: 0, a: 1 } } }, season: SEASON });
  assert.equal(view.mythicSeason.color, "#ff8000");
  assert.deepEqual(view.mythicSeason.runs, [
    { dungeon: "Kings' Rest", level: 21, timed: true, duration: 1_800_000, completedAt: "2026-11-03T00:00:00.000Z", score: 496 },
    { dungeon: "Murder Row", level: 20, timed: true, duration: 1_800_000, completedAt: "2026-11-04T00:00:00.000Z", score: 470 },
  ]);
});

test("without a run this season, mythicSeason has no runs and no colour", () => {
  assert.deepEqual(build({ season: null }).mythicSeason, { color: null, runs: [] });
});

test("Forever has no mythicSeason", () => {
  assert.equal(build({ game: "forever", mythic: null, season: null }).mythicSeason, null);
});
