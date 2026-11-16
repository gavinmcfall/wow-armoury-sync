// Builds the Player vs Player tab view (schema version 1) from the
// character's pvp-summary response and the bracket responses it links to.
// Pure: no I/O.
//
// Retail always lists the five rated brackets, unrated where the character
// has no rating. The summary links only to brackets the character has
// played: 2v2, 3v3 and rbg by name, and Solo Shuffle and Blitz once per
// spec (shuffle-{class}-{spec}), so those take the best spec's rating.
// Forever has no rated brackets; it has a rank instead of an honour level.

export const PVP_VIEW_VERSION = 1;

const BRACKETS = [
  { id: "2v2", name: "2v2 Arena" },
  { id: "3v3", name: "3v3 Arena" },
  { id: "rbg", name: "Rated Battlegrounds" },
  { id: "shuffle", name: "Solo Shuffle" },
  { id: "blitz", name: "Battleground Blitz" },
];

// `brackets` maps a bracket path segment ("3v3", "shuffle-paladin-holy")
// to that bracket's response.
export function buildPvpView({ game, fetchedAt, summary, brackets }) {
  const forever = game === "forever";
  return {
    schemaVersion: PVP_VIEW_VERSION,
    game,
    fetchedAt,
    honorLevel: forever ? null : (summary?.honor_level ?? null),
    honorableKills: summary?.honorable_kills ?? 0,
    rank: forever ? (summary?.pvp_rank ?? null) : null,
    brackets: forever ? [] : BRACKETS.map((b) => ({ ...b, rating: bestRating(brackets ?? {}, b.id) })),
    battlegrounds: (summary?.pvp_map_statistics ?? [])
      .map((m) => ({
        name: m.world_map.name,
        played: m.match_statistics?.played ?? 0,
        won: m.match_statistics?.won ?? 0,
        lost: m.match_statistics?.lost ?? 0,
      }))
      .sort((a, b) => b.played - a.played || a.name.localeCompare(b.name)),
  };
}

function bestRating(brackets, id) {
  const ratings = Object.entries(brackets)
    .filter(([segment]) => segment === id || segment.startsWith(`${id}-`))
    .map(([, res]) => res?.rating)
    .filter((r) => typeof r === "number");
  return ratings.length > 0 ? Math.max(...ratings) : null;
}

// The bracket path segments the summary links to, for the sync to fetch.
export function bracketPaths(summary) {
  return (summary?.brackets ?? []).flatMap((b) => {
    const match = b?.href?.match(/\/pvp-bracket\/([^/?]+)/);
    return match ? [decodeURIComponent(match[1])] : [];
  });
}
