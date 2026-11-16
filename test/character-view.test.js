import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildCharacterView } from "../src/views/character.js";

// Real API responses captured 2026-11-16 by scripts/capture-fixtures.mjs.
// If a refreshed fixture changes a value, update the assertion to match.
const load = (f) => JSON.parse(readFileSync(new URL(`./fixtures/${f}`, import.meta.url), "utf8"));
const RETAIL = load("retail-consecrator.json");
const FOREVER = load("forever-recurve.json");
const FETCHED = "2026-11-16T14:17:00.000Z";
const PALADIN_SPECS = ["Holy", "Protection", "Retribution"];

function retail(overrides = {}) {
  return buildCharacterView({
    game: "retail",
    fetchedAt: FETCHED,
    ...RETAIL,
    itemIcons: { 221242: "https://render/icons/helm.jpg" },
    classSpecs: PALADIN_SPECS,
    ...overrides,
  });
}

function forever(overrides = {}) {
  return buildCharacterView({ game: "forever", fetchedAt: FETCHED, ...FOREVER, itemIcons: {}, classSpecs: null, ...overrides });
}

test("retail: maps equipment with quality, icon and negated stats", () => {
  const view = retail();
  assert.equal(view.schemaVersion, 1);
  assert.equal(view.equipment.length, 15);
  const head = view.equipment.find((i) => i.slot === "HEAD");
  assert.equal(head.name, "Forgeborn Helm");
  assert.equal(head.quality, "RARE");
  assert.equal(head.itemLevel, 80);
  assert.equal(head.icon, "https://render/icons/helm.jpg");
  assert.deepEqual(
    head.stats.find((s) => s.text === "+18 Intellect"),
    { text: "+18 Intellect", negated: true, equipBonus: false },
  );
});

test("retail: weapon tooltip fields come through as display strings", () => {
  const axe = retail().equipment.find((i) => i.slot === "MAIN_HAND");
  assert.deepEqual(axe.weapon, { damage: "31 - 65 Damage", speed: "Speed 3.60", dps: "(13.3 damage per second)" });
  assert.equal(axe.inventoryType, "Two-Hand");
  assert.equal(axe.requirement, "Requires Level 80");
  assert.deepEqual(axe.stats.find((s) => s.text === "+25 Critical Strike"), { text: "+25 Critical Strike", negated: false, equipBonus: true });
});

test("retail: item without an icon gets icon null", () => {
  const neck = retail().equipment.find((i) => i.slot === "NECK");
  assert.equal(neck.icon, null);
});

test("retail: stats strip", () => {
  const { stats } = retail();
  assert.deepEqual(
    stats.map((s) => s.label),
    ["Health", "Mana", "Strength", "Stamina", "Critical strike", "Haste", "Mastery", "Versatility"],
  );
  assert.equal(stats[0].value, "52,360");
  assert.equal(stats[4].value, "18%");
});

test("retail: specs list every class spec with the active one marked", () => {
  const { specs } = retail();
  assert.deepEqual(specs.map((s) => s.name), PALADIN_SPECS);
  assert.deepEqual(specs.filter((s) => s.active).map((s) => s.name), ["Retribution"]);
  const ret = specs.find((s) => s.name === "Retribution");
  assert.equal(ret.heroTalent, "Templar");
  assert.equal(ret.pvpTalents.length, 3);
  assert.deepEqual(specs.find((s) => s.name === "Holy"), { name: "Holy", active: false, heroTalent: null, pvpTalents: [], spentPoints: null });
});

test("retail: without the class spec list, falls back to the specs the API lists", () => {
  assert.deepEqual(retail({ classSpecs: null }).specs.map((s) => s.name), ["Retribution"]);
});

test("retail: raids come from the newest expansion", () => {
  const { raids } = retail();
  assert.equal(raids.expansion, "Legion");
  assert.ok(raids.instances.length > 0);
  const mode = raids.instances[0].modes[0];
  assert.equal(typeof mode.difficulty, "string");
  assert.equal(typeof mode.completed, "number");
  assert.equal(typeof mode.total, "number");
});

test("retail: pvp and mythic", () => {
  const view = retail();
  assert.deepEqual(view.pvp, { honorLevel: 2, honorableKills: 5103, rank: null });
  assert.deepEqual(view.mythicPlus, { rating: null });
});

test("retail: render is the main-raw media asset", () => {
  assert.match(retail().render, /^https:\/\/.*main-raw/);
});

test("forever: specs come from the active group", () => {
  assert.deepEqual(forever().specs, [{ name: "Beast Mastery", active: true, heroTalent: null, pvpTalents: [], spentPoints: 14 }]);
});

test("forever: no spec is active when no points are spent", () => {
  const specializations = {
    specialization_groups: [{ is_active: true, specializations: [{ specialization_name: "Marksmanship", spent_points: 0 }] }],
  };
  assert.equal(forever({ specializations }).specs[0].active, false);
});

test("forever: mythicPlus is null and raids is null when there are no expansions", () => {
  const view = forever();
  assert.equal(view.mythicPlus, null);
  assert.equal(view.raids, null);
});

test("forever: stats strip", () => {
  const { stats } = forever();
  assert.deepEqual(stats, [
    { label: "Health", value: "545" },
    { label: "Mana", value: "801" },
    { label: "Agility", value: "86" },
    { label: "Stamina", value: "47" },
    { label: "Critical strike", value: "4.6%" },
    { label: "Armor", value: "528" },
  ]);
});

test("forever: pvp uses the rank", () => {
  assert.deepEqual(forever().pvp, { honorLevel: null, honorableKills: 0, rank: 0 });
});

test("forever: equipment includes RANGED and AMMO; the set string and enchantments come through", () => {
  const { equipment } = forever();
  assert.equal(equipment.length, 13);
  assert.ok(equipment.some((i) => i.slot === "RANGED"));
  assert.ok(equipment.some((i) => i.slot === "AMMO"));
  const waist = equipment.find((i) => i.slot === "WAIST");
  assert.equal(waist.set, "Defias Leather (1/5)");
  assert.equal(waist.armor, "50 Armor");
  assert.ok(equipment.flatMap((i) => i.enchantments).includes("Enchanted: Agility +3"));
});

test("hidden subclasses are null", () => {
  const view = forever();
  const hidden = FOREVER.equipment.equipped_items.find((i) => i.is_subclass_hidden);
  assert.equal(view.equipment.find((i) => i.slot === hidden.slot.type).subclass, null);
});

test("sockets fall back to the socket type name", () => {
  const all = [...retail().equipment, ...forever().equipment];
  assert.ok(all.flatMap((i) => i.sockets).includes("Prismatic Socket"));
});

test("a null section gives an empty but valid view", () => {
  const view = retail({ statistics: null, equipment: null, specializations: null, media: null, pvp: null, mythic: null, raids: null });
  assert.deepEqual(view.stats, []);
  assert.deepEqual(view.equipment, []);
  assert.equal(view.render, null);
  assert.deepEqual(view.specs.map((s) => s.active), [false, false, false]);
  assert.deepEqual(view.pvp, { honorLevel: null, honorableKills: 0, rank: null });
  assert.deepEqual(view.mythicPlus, { rating: null });
  assert.equal(view.raids, null);
});
