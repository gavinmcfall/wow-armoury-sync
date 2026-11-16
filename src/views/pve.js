// Builds the Dungeons & Raids tab view (schema version 1) from the
// character's mythic-keystone-profile, its current-season detail
// (mythic-keystone-profile/season/{id}) and encounters/{raids,dungeons}
// responses. Pure: no I/O.
//
// Raids and dungeons are grouped by expansion, newest first. The API lists
// expansions in no useful order, but their ids rise with each release. The
// dungeon list also carries a "Current Season" group (this season's Mythic+
// pool), which goes first.

export const PVE_VIEW_VERSION = 1;
export const CURRENT_SEASON = "Current Season";

export function buildPveView({ game, fetchedAt, mythic, season = null, raids, dungeons }) {
  return {
    schemaVersion: PVE_VIEW_VERSION,
    game,
    fetchedAt,
    mythicPlus: game === "forever" ? null : { rating: roundOrNull(mythic?.current_mythic_rating?.rating) },
    mythicSeason: game === "forever" ? null : mythicSeason(mythic, season),
    raids: groupByExpansion(raids),
    dungeons: groupByExpansion(dungeons),
  };
}

const roundOrNull = (n) => (typeof n === "number" ? Math.round(n) : null);

// The rating's colour, as Blizzard shows it, and the best run in each
// dungeon this season. The API keeps a best run per dungeon per affix
// week; the one with the higher map score counts.
function mythicSeason(mythic, season) {
  const best = new Map();
  for (const run of season?.best_runs ?? []) {
    const name = run.dungeon?.name;
    if (!name) continue;
    const held = best.get(name);
    if (!held || (run.map_rating?.rating ?? 0) > (held.map_rating?.rating ?? 0)) best.set(name, run);
  }
  return {
    color: season ? hex(mythic?.current_mythic_rating?.color ?? season.mythic_rating?.color) : null,
    runs: [...best.values()]
      .map((run) => ({
        dungeon: run.dungeon.name,
        level: run.keystone_level,
        timed: Boolean(run.is_completed_within_time),
        duration: run.duration,
        completedAt: new Date(run.completed_timestamp).toISOString(),
        score: Math.round(run.map_rating?.rating ?? 0),
      }))
      .sort((a, b) => b.score - a.score || a.dungeon.localeCompare(b.dungeon)),
  };
}

function hex(color) {
  if (!color) return null;
  return `#${[color.r, color.g, color.b].map((c) => Math.round(c).toString(16).padStart(2, "0")).join("")}`;
}

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
