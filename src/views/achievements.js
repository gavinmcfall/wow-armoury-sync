// Builds the Achievements tab view (schema version 1) from the character's
// achievements response, the top-level categories (refs.achievementCategories)
// and the details of the newest completions. Pure: no I/O.
//
// Category progress comes straight from the API's category_progress, whose
// top-level entries already count their subcategories. A category's total
// differs by faction, so the character's own faction picks it.

export const ACHIEVEMENTS_VIEW_VERSION = 1;
// How many of the newest completions get points, category and icon. Each
// one costs two lookups the first time it is seen.
export const RECENT_COUNT = 20;

export function buildAchievementsView({ game, fetchedAt, achievements, categories, faction, details = {} }) {
  const progress = new Map((achievements?.category_progress ?? []).map((c) => [c.category.id, c]));
  const completed = (achievements?.achievements ?? [])
    .filter((a) => a.completed_timestamp)
    .sort((a, b) => b.completed_timestamp - a.completed_timestamp)
    .map((a) => ({ id: a.id, name: a.achievement.name, completedAt: new Date(a.completed_timestamp).toISOString() }));
  return {
    schemaVersion: ACHIEVEMENTS_VIEW_VERSION,
    game,
    fetchedAt,
    total: { quantity: achievements?.total_quantity ?? 0, points: achievements?.total_points ?? 0 },
    categories: (categories?.roots ?? []).map((root) => ({
      id: root.id,
      name: root.name,
      quantity: progress.get(root.id)?.quantity ?? 0,
      points: progress.get(root.id)?.points ?? 0,
      total: root.total[faction] ?? root.total.alliance ?? null,
    })),
    recent: completed.slice(0, RECENT_COUNT).map((a) => ({
      ...a,
      points: details[a.id]?.points ?? null,
      category: details[a.id]?.category ?? null,
      icon: details[a.id]?.icon ?? null,
    })),
    completed,
  };
}

// The ids whose details the view wants, newest first.
export function recentIds(achievements) {
  return (achievements?.achievements ?? [])
    .filter((a) => a.completed_timestamp)
    .sort((a, b) => b.completed_timestamp - a.completed_timestamp)
    .slice(0, RECENT_COUNT)
    .map((a) => a.id);
}
