import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCollectionsView } from "../src/views/collections.js";

const NOW = "2026-11-16T14:17:00.000Z";

const SECTIONS = {
  mounts: { mounts: [{ mount: { id: 6, name: "Brown Horse" } }, { mount: { id: 3111, name: "Cerulean Prideclaw" } }] },
  pets: {
    pets: [
      { species: { id: 41, name: "Cornish Rex Cat" }, level: 1, id: 1 },
      { species: { id: 39, name: "Mechanical Squirrel" }, level: 25, id: 2 },
      { species: { id: 41, name: "Cornish Rex Cat" }, level: 12, id: 3 },
    ],
  },
  toys: { toys: [{ toy: { id: 5, name: "Fishing Chair" } }] },
  heirlooms: { heirlooms: [{ heirloom: { id: 706, name: "Polished Helm of Valor" }, upgrade: { level: 3 } }] },
};

const ICONS = {
  mounts: { 6: "https://render/npcs/zoom/2404.jpg" },
  pets: { 41: "https://render/icons/41.jpg" },
  toys: {},
  heirlooms: { 706: "https://render/icons/706.jpg" },
};

const build = (over = {}) => buildCollectionsView({ game: "retail", fetchedAt: NOW, ...SECTIONS, icons: ICONS, ...over });

test("carries schema version, game and fetch time", () => {
  const view = build();
  assert.equal(view.schemaVersion, 1);
  assert.equal(view.game, "retail");
  assert.equal(view.fetchedAt, NOW);
});

test("mounts are sorted by name with their icons, null where unknown", () => {
  assert.deepEqual(build().mounts, [
    { id: 6, name: "Brown Horse", icon: "https://render/npcs/zoom/2404.jpg" },
    { id: 3111, name: "Cerulean Prideclaw", icon: null },
  ]);
});

test("pets are listed once per species, with how many are owned and the highest level", () => {
  assert.deepEqual(build().pets, [
    { id: 41, name: "Cornish Rex Cat", icon: "https://render/icons/41.jpg", owned: 2, level: 12 },
    { id: 39, name: "Mechanical Squirrel", icon: null, owned: 1, level: 25 },
  ]);
});

test("toys carry their icon and heirlooms their upgrade level", () => {
  const view = build();
  assert.deepEqual(view.toys, [{ id: 5, name: "Fishing Chair", icon: null }]);
  assert.deepEqual(view.heirlooms, [{ id: 706, name: "Polished Helm of Valor", icon: "https://render/icons/706.jpg", upgrade: 3 }]);
});

test("a collection the API returned nothing for is empty", () => {
  const view = build({ heirlooms: {}, toys: null });
  assert.deepEqual(view.heirlooms, []);
  assert.deepEqual(view.toys, []);
});
