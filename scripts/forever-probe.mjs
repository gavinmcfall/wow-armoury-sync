// forever-probe.mjs: checks which Battle.net character endpoints answer for
// each character in src/characters.js, using the same app (client
// credentials) token as the Worker. Prints status codes and a few summary
// fields, never the credentials or full payloads.
//
// Run from the repo root:  node --env-file=.dev.vars scripts/forever-probe.mjs

import { BlizzardClient } from "../src/blizzard.js";
import { REGION, trackedCharacters } from "../src/characters.js";

const SUB_ENDPOINTS = ["equipment", "specializations", "professions", "reputations", "character-media", "statistics"];

const { BNET_CLIENT_ID, BNET_CLIENT_SECRET } = process.env;
if (!BNET_CLIENT_ID || !BNET_CLIENT_SECRET) {
  console.error("BNET_CLIENT_ID and BNET_CLIENT_SECRET must be set (see .dev.vars).");
  process.exit(1);
}

const client = new BlizzardClient({ clientId: BNET_CLIENT_ID, clientSecret: BNET_CLIENT_SECRET, region: REGION });

function summary(p) {
  return [
    `level ${p.level ?? "?"}`,
    p.race?.name,
    p.character_class?.name,
    p.active_spec?.name,
    p.faction?.name,
    p.realm?.name && `realm: ${p.realm.name}`,
    p.equipped_item_level != null && `ilvl ${p.equipped_item_level}`,
  ]
    .filter(Boolean)
    .join(" · ");
}

for (const c of trackedCharacters(REGION)) {
  const base = `/profile/wow/character/${c.path}`;
  const profile = await client.get(base, c.profileNamespace);
  console.log(`${c.key}: profile ${profile.status}${profile.data ? "  " + summary(profile.data) : ""}`);
  if (profile.status !== 200) continue;
  const subs = [];
  for (const ep of SUB_ENDPOINTS) {
    const r = await client.get(`${base}/${ep}`, c.profileNamespace);
    subs.push(`${ep} ${r.status}`);
  }
  console.log(`    ${subs.join(" | ")}`);
}
