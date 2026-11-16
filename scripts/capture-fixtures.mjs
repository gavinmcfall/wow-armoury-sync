// Captures real API responses for one retail and one Forever character into
// test/fixtures/, trimmed so they stay small. Re-run to refresh the fixtures:
//
//   node --env-file=.dev.vars scripts/capture-fixtures.mjs
import { writeFile, mkdir } from "node:fs/promises";
import { BlizzardClient } from "../src/blizzard.js";

const client = new BlizzardClient({
  clientId: process.env.BNET_CLIENT_ID,
  clientSecret: process.env.BNET_CLIENT_SECRET,
  region: "us",
});

const SECTIONS = {
  equipment: "equipment",
  statistics: "statistics",
  specializations: "specializations",
  media: "character-media",
  pvp: "pvp-summary",
  mythic: "mythic-keystone-profile",
  raids: "encounters/raids",
  reputations: "reputations",
  professions: "professions",
};

const CHARACTERS = [
  { file: "retail-consecrator.json", path: `barthilas/${encodeURIComponent("cònsecrator")}`, ns: "profile-us" },
  { file: "forever-recurve.json", path: "recurve-ravenholt", ns: "profile-forever-us" },
];

// Drops API hyperlinks: every _links field, and every "key" that is a link
// object ({ href }). String keys, such as media asset names, are kept.
function strip(value) {
  if (Array.isArray(value)) return value.map(strip);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([k, v]) => k !== "_links" && !(k === "key" && v && typeof v === "object" && "href" in v))
        .map(([k, v]) => [k, strip(v)]),
    );
  }
  return value;
}

await mkdir(new URL("../test/fixtures/", import.meta.url), { recursive: true });
for (const c of CHARACTERS) {
  const base = `/profile/wow/character/${c.path}`;
  const out = { profile: (await client.get(base, c.ns)).data };
  for (const [field, endpoint] of Object.entries(SECTIONS)) {
    const res = await client.get(`${base}/${endpoint}`, c.ns);
    out[field] = res.status === 200 ? res.data : null;
  }
  // Keep the three newest expansions: the view only uses the newest.
  if (out.raids?.expansions) {
    out.raids.expansions = [...out.raids.expansions].sort((a, b) => b.expansion.id - a.expansion.id).slice(0, 3);
  }
  // Recipe lists are long and nothing reads them.
  for (const prof of [...(out.professions?.primaries ?? []), ...(out.professions?.secondaries ?? [])]) {
    for (const tier of prof.tiers ?? []) delete tier.known_recipes;
  }
  const json = JSON.stringify(strip(out), null, 1);
  await writeFile(new URL(`../test/fixtures/${c.file}`, import.meta.url), json);
  console.log(`${c.file}: ${(json.length / 1024).toFixed(0)} KB`);
}
