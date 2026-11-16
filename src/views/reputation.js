// Builds the Reputation tab view (schema version 1) from the character's
// reputations response and the faction tree (refs.factionGroups). Pure: no
// I/O.
//
// Factions are grouped under the top-level header they sit in: on retail
// the expansion ("Midnight", "Classic"), on Forever headers such as
// "Alliance". Groups follow the API's header order; factions outside every
// header, or every faction when the tree is unavailable, go in "Other".

export const REPUTATION_VIEW_VERSION = 1;
export const OTHER_GROUP = "Other";

export function buildReputationView({ game, fetchedAt, reputations, groups }) {
  const byGroup = new Map();
  for (const r of reputations?.reputations ?? []) {
    const group = groups?.byFaction?.[r.faction.id] ?? OTHER_GROUP;
    if (!byGroup.has(group)) byGroup.set(group, []);
    byGroup.get(group).push(mapFaction(r));
  }
  const order = [...(groups?.order ?? []).filter((name) => name !== OTHER_GROUP), OTHER_GROUP];
  return {
    schemaVersion: REPUTATION_VIEW_VERSION,
    game,
    fetchedAt,
    groups: order
      .filter((name) => byGroup.has(name))
      .map((name) => ({ name, factions: byGroup.get(name).sort((a, b) => a.name.localeCompare(b.name)) })),
  };
}

// `value` of `max` is progress through the current standing; at the top
// standing (Exalted) the API reports 0 of 0.
function mapFaction({ faction, standing, paragon }) {
  return {
    id: faction.id,
    name: faction.name,
    standing: standing.name,
    value: standing.value,
    max: standing.max,
    renown: standing.renown_level ?? null,
    paragon: paragon ? { value: paragon.value, max: paragon.max } : null,
  };
}
