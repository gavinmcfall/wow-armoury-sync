// The nightly sync: for each tracked character, fetch the profile and its
// sections from the Battle.net API, shape them into ready-to-render views,
// and store them in KV.
//
// KV layout (schema version 1):
//   index                         schemaVersion, updatedAt, one summary per character
//   view:v1:{key}:character       the Character tab view for one character
//   ref:{namespace}:…             cached reference data (see refs.js)
//
// A failed run never wipes good data: if the profile fetch fails, the
// previous view stays and the previous summary is kept, marked "error".
import { createRefs } from "./refs.js";
import { buildCharacterView, foreverActiveSpec } from "./views/character.js";
import { buildSummary, notListedSummary } from "./views/summary.js";

export const SCHEMA_VERSION = 1;

const SECTIONS = {
  equipment: "equipment",
  statistics: "statistics",
  specializations: "specializations",
  media: "character-media",
  pvp: "pvp-summary",
  raids: "encounters/raids",
};
const RETAIL_ONLY = { mythic: "mythic-keystone-profile" };
// Sections the Character view can't do without. A 404 on one means the API
// has nothing for this character (stored as empty); any other failure keeps
// the previous view.
const CORE_SECTIONS = ["equipment", "statistics", "specializations", "media"];

export async function syncAll({ client, kv, characters, now = () => new Date().toISOString(), maxNewLookups }) {
  const previous = (await kv.get("index", "json")) ?? { characters: [] };
  const previousByKey = new Map(previous.characters.map((s) => [s.key, s]));
  const refs = createRefs({ client, kv, maxNewLookups });

  const summaries = [];
  for (const character of characters) {
    summaries.push(await syncCharacter({ client, kv, refs, character, previous: previousByKey.get(character.key), now }));
  }

  await kv.put("index", JSON.stringify({ schemaVersion: SCHEMA_VERSION, updatedAt: now(), characters: summaries }));
  return { summaries, refs: refs.stats() };
}

async function syncCharacter({ client, kv, refs, character, previous, now }) {
  const base = `/profile/wow/character/${character.path}`;
  // The not-listed shape underneath supplies route and display names when the
  // previous summary lacks them (first run, or one written by v1.x).
  const keep = (error) => ({ ...notListedSummary(character), ...previous, route: character.route, status: "error", error });

  let profile;
  try {
    profile = await client.get(base, character.profileNamespace);
  } catch (err) {
    return keep(`profile request failed: ${err.message}`);
  }
  // A 404 for a character that has synced before is more likely a passing
  // API fault (or a rename) than the character vanishing: keep its data.
  if (profile.status === 404) return previous?.lastSuccessAt ? keep("profile HTTP 404") : notListedSummary(character);
  if (profile.status !== 200) return keep(`profile HTTP ${profile.status}`);

  try {
    const endpoints = character.game === "retail" ? { ...SECTIONS, ...RETAIL_ONLY } : SECTIONS;
    const { sections, failed } = await fetchSections(client, base, character.profileNamespace, endpoints);
    // A server error on a section the page is built around would write an
    // empty doll over good data; keep the previous view instead.
    const coreFailure = failed.find((f) => CORE_SECTIONS.includes(f.field));
    if (coreFailure) return keep(`${coreFailure.endpoint} HTTP ${coreFailure.status}`);
    const ns = character.staticNamespace;
    const classId = profile.data.character_class?.id;
    const [itemIcons, classSpecs] = await Promise.all([
      fetchItemIcons(refs, sections.equipment, ns),
      character.game === "retail" && classId ? refs.classSpecs(ns, classId) : null,
    ]);
    const fetchedAt = now();
    const view = buildCharacterView({ game: character.game, fetchedAt, ...sections, itemIcons, classSpecs });
    await kv.put(`view:v${SCHEMA_VERSION}:${character.key}:character`, JSON.stringify(view));
    const spec = character.game === "forever" ? foreverActiveSpec(sections.specializations) : null;
    return buildSummary(character, profile.data, sections.media, fetchedAt, spec);
  } catch (err) {
    return keep(`sync failed: ${err.message}`);
  }
}

// Fetches every section in parallel. A section the API does not return is
// null; `failed` lists the ones that answered with anything but 200 or 404.
async function fetchSections(client, base, namespace, endpoints) {
  const results = await Promise.all(
    Object.entries(endpoints).map(async ([field, endpoint]) => {
      const res = await client.get(`${base}/${endpoint}`, namespace);
      return { field, endpoint, status: res.status, data: res.status === 200 ? res.data : null };
    }),
  );
  return {
    sections: Object.fromEntries(results.map((r) => [r.field, r.data])),
    failed: results.filter((r) => r.status !== 200 && r.status !== 404),
  };
}

// Returns { itemId: iconUrl } for the equipped items that have an icon.
async function fetchItemIcons(refs, equipment, ns) {
  const ids = [...new Set((equipment?.equipped_items ?? []).map((i) => i.media?.id ?? i.item?.id).filter(Boolean))];
  const icons = {};
  await Promise.all(
    ids.map(async (id) => {
      const url = await refs.itemIcon(ns, id);
      if (url) icons[id] = url;
    }),
  );
  return icons;
}
