// The nightly sync: for each tracked character, fetch the profile and its
// sections from the Battle.net API and store them in KV for nerdz.cloud.
//
// KV layout:
//   index                      updatedAt plus one summary per character
//   character:{key}            the full record for one character
//   icon:{staticNamespace}:{id} an item's icon URL (icons never change, so
//                              these are fetched once and kept)
//
// A failed run never wipes good data: if the API errors, the previous record
// and summary stay, marked with status "error".

const SECTIONS = {
  equipment: "equipment",
  specializations: "specializations",
  professions: "professions",
  reputations: "reputations",
  media: "character-media",
  statistics: "statistics",
};

export async function syncAll({ client, kv, characters, now = () => new Date().toISOString() }) {
  const previous = (await kv.get("index", "json")) ?? { characters: [] };
  const previousByKey = new Map(previous.characters.map((s) => [s.key, s]));

  const summaries = [];
  for (const character of characters) {
    summaries.push(await syncCharacter({ client, kv, character, previous: previousByKey.get(character.key), now }));
  }

  await kv.put("index", JSON.stringify({ updatedAt: now(), characters: summaries }));
  return summaries;
}

async function syncCharacter({ client, kv, character, previous, now }) {
  const base = `/profile/wow/character/${character.path}`;
  const keep = (error) => ({ ...previous, key: character.key, game: character.game, status: "error", error });

  let profile;
  try {
    profile = await client.get(base, character.profileNamespace);
  } catch (err) {
    return keep(`profile request failed: ${err.message}`);
  }
  if (profile.status === 404) return { key: character.key, game: character.game, status: "not-listed" };
  if (profile.status !== 200) return keep(`profile HTTP ${profile.status}`);

  try {
    const sections = await fetchSections(client, base, character.profileNamespace);
    const itemIcons = await fetchItemIcons(client, kv, sections.equipment, character.staticNamespace);
    const fetchedAt = now();
    const record = { fetchedAt, profile: profile.data, ...sections, itemIcons };
    await kv.put(`character:${character.key}`, JSON.stringify(record));
    return summarise(character, profile.data, fetchedAt);
  } catch (err) {
    return keep(`sync failed: ${err.message}`);
  }
}

// Fetches every section in parallel. A section the API does not return is
// stored as null, so one missing section never fails the whole character.
async function fetchSections(client, base, namespace) {
  const entries = await Promise.all(
    Object.entries(SECTIONS).map(async ([field, endpoint]) => {
      const res = await client.get(`${base}/${endpoint}`, namespace);
      return [field, res.status === 200 ? res.data : null];
    }),
  );
  return Object.fromEntries(entries);
}

// Returns { itemId: iconUrl } for the equipped items, using the KV cache and
// fetching only the icons it has not seen before.
async function fetchItemIcons(client, kv, equipment, staticNamespace) {
  const ids = [...new Set((equipment?.equipped_items ?? []).map((i) => i.media?.id ?? i.item?.id).filter(Boolean))];
  const icons = {};
  await Promise.all(
    ids.map(async (id) => {
      const cacheKey = `icon:${staticNamespace}:${id}`;
      let url = await kv.get(cacheKey);
      if (!url) {
        const res = await client.get(`/data/wow/media/item/${id}`, staticNamespace);
        url = res.status === 200 ? res.data?.assets?.find((a) => a.key === "icon")?.value : null;
        if (url) await kv.put(cacheKey, url);
      }
      if (url) icons[id] = url;
    }),
  );
  return icons;
}

function summarise(character, p, fetchedAt) {
  return {
    key: character.key,
    game: character.game,
    status: "ok",
    name: p.name,
    realm: p.realm?.name ?? null,
    level: p.level,
    race: p.race?.name ?? null,
    characterClass: p.character_class?.name ?? null,
    spec: p.active_spec?.name ?? null,
    faction: p.faction?.name ?? null,
    itemLevel: p.equipped_item_level ?? null,
    lastSuccessAt: fetchedAt,
  };
}
