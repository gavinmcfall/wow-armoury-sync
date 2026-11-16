// One roster entry per character, stored in the index.
import { mediaAsset } from "./character.js";

// `spec` overrides the profile's active spec: Forever profiles report none,
// so the sync derives it from talent points and passes it in.
export function buildSummary(character, p, media, fetchedAt, spec = null) {
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
