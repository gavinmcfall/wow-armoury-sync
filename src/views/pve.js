// Builds the Dungeons & Raids tab view (schema version 1) from the
// character's mythic-keystone-profile and encounters/{raids,dungeons}
// responses. Pure: no I/O.
//
// Raids and dungeons are grouped by expansion, newest first. The API lists
// expansions in no useful order, but their ids rise with each release. The
// dungeon list also carries a "Current Season" group (this season's Mythic+
// pool), which goes first.

export const PVE_VIEW_VERSION = 1;
export const CURRENT_SEASON = "Current Season";

export function buildPveView({ game, fetchedAt, mythic, raids, dungeons }) {
  return {
    schemaVersion: PVE_VIEW_VERSION,
    game,
    fetchedAt,
    mythicPlus: game === "forever" ? null : { rating: roundOrNull(mythic?.current_mythic_rating?.rating) },
    raids: groupByExpansion(raids),
    dungeons: groupByExpansion(dungeons),
  };
}

const roundOrNull = (n) => (typeof n === "number" ? Math.round(n) : null);

const rank = (e) => (e.expansion.name === CURRENT_SEASON ? Infinity : e.expansion.id);

function groupByExpansion(section) {
  return [...(section?.expansions ?? [])]
    .sort((a, b) => rank(b) - rank(a))
    .map((e) => ({
      id: e.expansion.id,
      name: e.expansion.name,
      instances: (e.instances ?? []).map((i) => ({
        id: i.instance.id,
        name: i.instance.name,
        modes: (i.modes ?? []).map((m) => ({
          difficulty: m.difficulty?.name,
          completed: m.progress?.completed_count ?? 0,
          total: m.progress?.total_count ?? 0,
        })),
      })),
    }));
}
