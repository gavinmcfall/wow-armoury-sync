// Builds the Collections view (schema version 1) from the character's
// mounts, pets, toys and heirlooms responses and their icons. Pure: no I/O.
//
// `icons` maps each collection to { id: iconUrl }, where id is the mount,
// pet species, toy or heirloom id. An icon not fetched yet is null.

export const COLLECTIONS_VIEW_VERSION = 1;

const byName = (a, b) => a.name.localeCompare(b.name);

export function buildCollectionsView({ game, fetchedAt, mounts, pets, toys, heirlooms, icons = {} }) {
  const icon = (kind, id) => icons[kind]?.[id] ?? null;
  return {
    schemaVersion: COLLECTIONS_VIEW_VERSION,
    game,
    fetchedAt,
    mounts: (mounts?.mounts ?? []).map(({ mount }) => ({ id: mount.id, name: mount.name, icon: icon("mounts", mount.id) })).sort(byName),
    pets: uniqueSpecies(pets?.pets ?? []).map((p) => ({ ...p, icon: icon("pets", p.id) })).sort(byName),
    toys: (toys?.toys ?? []).map(({ toy }) => ({ id: toy.id, name: toy.name, icon: icon("toys", toy.id) })).sort(byName),
    heirlooms: (heirlooms?.heirlooms ?? [])
      .map(({ heirloom, upgrade }) => ({ id: heirloom.id, name: heirloom.name, icon: icon("heirlooms", heirloom.id), upgrade: upgrade?.level ?? 0 }))
      .sort(byName),
  };
}

// A character can own several pets of one species: one entry per species,
// with how many are owned and the highest level among them.
function uniqueSpecies(pets) {
  const bySpecies = new Map();
  for (const pet of pets) {
    const seen = bySpecies.get(pet.species.id);
    if (seen) {
      seen.owned++;
      seen.level = Math.max(seen.level, pet.level ?? 0);
    } else {
      bySpecies.set(pet.species.id, { id: pet.species.id, name: pet.species.name, owned: 1, level: pet.level ?? 0 });
    }
  }
  return [...bySpecies.values()];
}

// The ids whose icons the view wants, per collection.
export function collectionIds({ mounts, pets, toys, heirlooms }) {
  return {
    mounts: (mounts?.mounts ?? []).map((m) => m.mount.id),
    pets: [...new Set((pets?.pets ?? []).map((p) => p.species.id))],
    toys: (toys?.toys ?? []).map((t) => t.toy.id),
    heirlooms: (heirlooms?.heirlooms ?? []).map((h) => h.heirloom.id),
  };
}
