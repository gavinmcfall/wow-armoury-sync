import { test } from "node:test";
import assert from "node:assert/strict";
import { buildAchievementsView, RECENT_COUNT } from "../src/views/achievements.js";

const NOW = "2026-11-16T14:17:00.000Z";
const T = (iso) => Date.parse(iso);

const ACHIEVEMENTS = {
  total_quantity: 3,
  total_points: 25,
  achievements: [
    { id: 6, achievement: { id: 6, name: "Level 10" }, completed_timestamp: T("2008-10-11T00:00:00Z") },
    { id: 7, achievement: { id: 7, name: "Level 20" }, completed_timestamp: T("2009-01-02T00:00:00Z") },
    { id: 8, achievement: { id: 8, name: "Level 30" } },
    { id: 545, achievement: { id: 545, name: "Shave and a Haircut" }, completed_timestamp: T("2024-05-05T00:00:00Z") },
  ],
  category_progress: [
    { category: { id: 92, name: "Characters" }, quantity: 3, points: 25 },
    { category: { id: 15428, name: "Shadowlands Dungeon" }, quantity: 0, points: 0 },
  ],
};

const CATEGORIES = {
  roots: [
    { id: 92, name: "Characters", total: { alliance: { quantity: 40, points: 495 }, horde: { quantity: 41, points: 500 } } },
    { id: 168, name: "Dungeons & Raids", total: { alliance: { quantity: 1589, points: 16875 }, horde: { quantity: 1589, points: 16875 } } },
  ],
};

const DETAILS = {
  6: { points: 10, category: "Characters", icon: "https://render/icons/6.jpg" },
  545: { points: 5, category: "Characters", icon: null },
};

const build = (over = {}) =>
  buildAchievementsView({
    game: "retail",
    fetchedAt: NOW,
    achievements: ACHIEVEMENTS,
    categories: CATEGORIES,
    faction: "alliance",
    details: DETAILS,
    ...over,
  });

test("carries the character's achievement totals", () => {
  const view = build();
  assert.equal(view.schemaVersion, 1);
  assert.equal(view.game, "retail");
  assert.equal(view.fetchedAt, NOW);
  assert.deepEqual(view.total, { quantity: 3, points: 25 });
});

test("lists every top-level category with the character's progress against its faction's total", () => {
  assert.deepEqual(build().categories, [
    { id: 92, name: "Characters", quantity: 3, points: 25, total: { quantity: 40, points: 495 } },
    { id: 168, name: "Dungeons & Raids", quantity: 0, points: 0, total: { quantity: 1589, points: 16875 } },
  ]);
  assert.deepEqual(build({ faction: "horde" }).categories[0].total, { quantity: 41, points: 500 });
});

test("a category with no total for the faction falls back to the Alliance total", () => {
  assert.deepEqual(build({ faction: null }).categories[0].total, { quantity: 40, points: 495 });
});

test("without the category tree there are no category cards", () => {
  assert.deepEqual(build({ categories: null }).categories, []);
});

test("lists completed achievements newest first and leaves out unfinished ones", () => {
  assert.deepEqual(build().completed, [
    { id: 545, name: "Shave and a Haircut", completedAt: "2024-05-05T00:00:00.000Z" },
    { id: 7, name: "Level 20", completedAt: "2009-01-02T00:00:00.000Z" },
    { id: 6, name: "Level 10", completedAt: "2008-10-11T00:00:00.000Z" },
  ]);
});

test("recent completions carry points, category and icon where the details are known", () => {
  assert.deepEqual(build().recent, [
    { id: 545, name: "Shave and a Haircut", completedAt: "2024-05-05T00:00:00.000Z", points: 5, category: "Characters", icon: null },
    { id: 7, name: "Level 20", completedAt: "2009-01-02T00:00:00.000Z", points: null, category: null, icon: null },
    { id: 6, name: "Level 10", completedAt: "2008-10-11T00:00:00.000Z", points: 10, category: "Characters", icon: "https://render/icons/6.jpg" },
  ]);
});

test("recent holds at most RECENT_COUNT achievements", () => {
  const many = Array.from({ length: RECENT_COUNT + 5 }, (_, i) => ({
    id: i + 1,
    achievement: { id: i + 1, name: `A${i + 1}` },
    completed_timestamp: T("2020-01-01T00:00:00Z") + i,
  }));
  const view = build({ achievements: { ...ACHIEVEMENTS, achievements: many } });
  assert.equal(view.recent.length, RECENT_COUNT);
  assert.equal(view.recent[0].id, RECENT_COUNT + 5);
  assert.equal(view.completed.length, RECENT_COUNT + 5);
});

test("a missing achievements response gives an empty view", () => {
  const view = build({ achievements: null });
  assert.deepEqual(view.total, { quantity: 0, points: 0 });
  assert.deepEqual(view.completed, []);
  assert.deepEqual(view.recent, []);
  assert.deepEqual(view.categories.map((c) => c.quantity), [0, 0]);
});

test("details holds points, category and icon for every completed achievement whose details are known", () => {
  assert.deepEqual(build().details, {
    545: { points: 5, category: "Characters", icon: null },
    6: { points: 10, category: "Characters", icon: "https://render/icons/6.jpg" },
  });
});

test("details leaves out achievements that are not completed", () => {
  const view = build({ details: { ...DETAILS, 8: { points: 10, category: "Characters", icon: null } } });
  assert.equal(view.details[8], undefined);
});
