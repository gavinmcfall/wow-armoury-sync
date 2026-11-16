// One roster entry per character, stored in the index.
import { mediaAsset } from "./character.js";

// The scene the Armory stands each class in, keyed by playable class id
// (the same ids on retail and Forever).
const CLASS_BACKGROUND_SLUGS = {
  1: "warrior",
  2: "paladin",
  3: "hunter",
  4: "rogue",
  5: "priest",
  6: "death_knight",
  7: "shaman",
  8: "mage",
  9: "warlock",
  10: "monk",
  11: "druid",
  12: "demon_hunter",
  13: "evoker",
};

export function classBackground(classId) {
  const slug = CLASS_BACKGROUND_SLUGS[classId];
  return slug ? `https://render.worldofwarcraft.com/profile-backgrounds/v2/armory_bg_class_${slug}.jpg` : null;
}

// The character's primary professions, as { id, name }, in the API's order.
// Skill levels aren't included: retail reports one per expansion, and their
// ids don't say which expansion is newest.
export function primaryProfessions(professions) {
  return (professions?.primaries ?? []).map((p) => ({ id: p.profession.id, name: p.profession.name }));
}

// `spec` overrides the profile's active spec: Forever profiles report none,
// so the sync derives it from talent points and passes it in. `portrait` is
// { url, focus, figure } for the full render (see portrait.js), or null.
// `professions` is primaryProfessions() of the professions response.
export function buildSummary(character, p, media, fetchedAt, spec = null, portrait = null, professions = []) {
  return {
    key: character.key,
    game: character.game,
    status: "ok",
    route: character.route,
    name: p.name,
    surname: p.surname ?? null,
    realm: p.realm?.name ?? null,
    ruleset: p.ruleset?.name ?? null,
    level: p.level,
    race: p.race?.name ?? null,
    characterClass: p.character_class?.name ?? null,
    spec: spec ?? p.active_spec?.name ?? null,
    faction: p.faction?.type ?? null,
    itemLevel: p.equipped_item_level ?? null,
    title: p.active_title?.name ?? null,
    guild: p.guild?.name ?? null,
    achievementPoints: p.achievement_points ?? 0,
    inset: mediaAsset(media, "inset") ?? mediaAsset(media, "avatar"),
    portrait,
    background: classBackground(p.character_class?.id),
    professions,
    lastSuccessAt: fetchedAt,
  };
}

export function notListedSummary(character) {
  return {
    key: character.key,
    game: character.game,
    status: "not-listed",
    route: character.route,
    name: character.displayName,
    surname: character.displaySurname ?? null,
  };
}
