import { measureFigure } from "./portrait.js";

// Reference data that rarely or never changes (item icons, a class's spec
// list), cached in KV under ref:{namespace}:… so each value is fetched once.
// Portrait framing is cached too, under ref:portrait:{render path}.
//
// New lookups per run are capped: a first run with a large roster, or a
// season's worth of new gear, stays inside the Worker's subrequest limit.
// A lookup over the cap returns null; it is fetched on a later night.

// The faction tree and the achievement categories change only when Blizzard
// adds to them in a patch.
const TREE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const CHUNK = 20;
// Achievement categories Blizzard keeps out of the character's view.
const HIDDEN_ACHIEVEMENT_CATEGORIES = ["Do Not Display"];

// `fetchImage` fetches Blizzard's render images, which need no API token.
export function createRefs({
  client,
  kv,
  maxNewLookups = 2000,
  fetchImage = (...args) => fetch(...args),
  now = () => Date.now(),
}) {
  const counts = { hits: 0, fetched: 0, skipped: 0 };
  const factionTrees = new Map();
  const achievementTrees = new Map();
  const detailMaps = new Map();
  const mythicSeasons = new Map();

  // Lookups already made this run, by key. Characters share most reference
  // data (retail collections are account-wide), and every KV read is a
  // subrequest, so each key is read or fetched at most once per run.
  const seen = new Map();

  // Reads key from KV; on a miss, and while under the cap, calls load() and
  // caches a non-null result. Strings are stored as-is, anything else as JSON.
  function lookup(key, asJson, load) {
    if (seen.has(key)) {
      counts.hits++;
      return seen.get(key);
    }
    const result = readOrLoad(key, asJson, load);
    seen.set(key, result);
    return result;
  }

  async function readOrLoad(key, asJson, load) {
    const cached = await kv.get(key, asJson ? "json" : undefined);
    if (cached !== null) {
      counts.hits++;
      return cached;
    }
    if (counts.fetched >= maxNewLookups) {
      counts.skipped++;
      return null;
    }
    counts.fetched++;
    const value = await load();
    if (value !== null) await kv.put(key, asJson ? JSON.stringify(value) : value);
    return value;
  }

  // Fetches a batch of reference records (one request per path). Returns
  // them in order, or null when any request fails or the batch would pass
  // the cap.
  async function fetchRecords(ns, paths) {
    if (counts.fetched + paths.length > maxNewLookups) {
      counts.skipped++;
      return null;
    }
    counts.fetched += paths.length;
    // In chunks, to stay under Blizzard's 100 requests per second.
    const records = [];
    for (let i = 0; i < paths.length; i += CHUNK) {
      const results = await Promise.all(paths.slice(i, i + CHUNK).map((path) => client.get(path, ns)));
      if (results.some((r) => r.status !== 200)) return null;
      records.push(...results.map((r) => r.data));
    }
    return records;
  }

  const fetchFactions = (ns, ids) => fetchRecords(ns, ids.map((id) => `/data/wow/reputation-faction/${id}`));

  async function walkFactionTree(ns) {
    const [index] = (await fetchFactions(ns, ["index"])) ?? [];
    if (!index) return null;
    const roots = await fetchFactions(ns, (index.root_factions ?? []).map((f) => f.id));
    if (!roots) return null;
    const order = [];
    const byFaction = {};
    // Children waiting to be fetched, each with the header they sit under.
    let level = [];
    for (const root of roots.filter((r) => r.is_header)) {
      order.push(root.name);
      level.push(...(root.factions ?? []).map((f) => ({ id: f.id, header: root.name })));
    }
    while (level.length > 0) {
      const records = await fetchFactions(ns, level.map((c) => c.id));
      if (!records) return null;
      const next = [];
      records.forEach((record, i) => {
        byFaction[record.id] = level[i].header;
        if (record.is_header) next.push(...(record.factions ?? []).map((f) => ({ id: f.id, header: level[i].header })));
      });
      level = next;
    }
    return { order, byFaction };
  }

  async function walkAchievementCategories(ns) {
    const [index] = (await fetchRecords(ns, ["/data/wow/achievement-category/index"])) ?? [];
    if (!index) return null;
    const ids = (index.root_categories ?? []).map((c) => c.id);
    const records = await fetchRecords(ns, ids.map((id) => `/data/wow/achievement-category/${id}`));
    if (!records) return null;
    const roots = records
      .filter((r) => !r.is_guild_category && !HIDDEN_ACHIEVEMENT_CATEGORIES.includes(r.name))
      .sort((a, b) => (a.display_order ?? 0) - (b.display_order ?? 0))
      .map((r) => ({ id: r.id, name: r.name, total: r.aggregates_by_faction ?? {} }));
    return { roots };
  }

  function itemIcon(ns, itemId) {
    return lookup(`ref:${ns}:item-icon:${itemId}`, false, async () => {
      const res = await client.get(`/data/wow/media/item/${itemId}`, ns);
      if (res.status !== 200) return null;
      return res.data?.assets?.find((a) => a.key === "icon")?.value ?? null;
    });
  }

  // Toys and heirlooms are items: their record names the item (as its media
  // id), cached at ref:{ns}:{kind}-item:{id}, and the icon comes from the
  // item icon cache.
  async function itemOf(ns, kind, id) {
    const itemId = await lookup(`ref:${ns}:${kind}-item:${id}`, true, async () => {
      const res = await client.get(`/data/wow/${kind}/${id}`, ns);
      return res.status === 200 ? (res.data?.media?.id ?? null) : null;
    });
    return itemId ? itemIcon(ns, itemId) : null;
  }

  return {
    itemIcon,
    classSpecs(ns, classId) {
      return lookup(`ref:${ns}:class-specs:${classId}`, true, async () => {
        const res = await client.get(`/data/wow/playable-class/${classId}`, ns);
        if (res.status !== 200) return null;
        return (res.data?.specializations ?? []).map((s) => s.name);
      });
    },
    // Where the character stands in its render: { focus, figure } (see
    // portrait.js). A render changes when the character's gear does, so the
    // frames are kept under the image's ETag and checked with a conditional
    // request. An entry from before the figure frame existed is measured again.
    async portrait(url) {
      const key = `ref:portrait:${new URL(url).pathname}`;
      const stored = await kv.get(key, "json");
      const cached = stored?.figure ? stored : null;
      if (!cached && counts.fetched >= maxNewLookups) {
        counts.skipped++;
        return null;
      }
      const frames = (entry) => ({ focus: entry.focus, figure: entry.figure });
      const res = await fetchImage(url, { headers: cached?.etag ? { "If-None-Match": cached.etag } : {} });
      if (res.status === 304 && cached) {
        counts.hits++;
        return frames(cached);
      }
      if (!res.ok) return cached ? frames(cached) : null;
      counts.fetched++;
      const measured = await measureFigure(new Uint8Array(await res.arrayBuffer()));
      if (measured) await kv.put(key, JSON.stringify({ etag: res.headers.get("ETag"), ...measured }));
      return measured;
    },
    // Which top-level header each faction sits under: { order, byFaction }.
    // order lists the headers as the API does (retail: newest expansion
    // first); byFaction maps faction id to header name. Walking the tree is a
    // request per faction, so the result is cached for 30 days. A walk that
    // fails or would pass the lookup cap keeps nothing and returns the
    // previous tree, or null.
    factionGroups(ns) {
      // Once per namespace per run: every character asks, and a failed walk
      // must not be repeated for each of them.
      if (!factionTrees.has(ns)) factionTrees.set(ns, loadTree(ns, "faction-groups", walkFactionTree, (c) => ({ order: c.order, byFaction: c.byFaction })));
      return factionTrees.get(ns);
    },
    // The top-level achievement categories a character sees: { roots },
    // each { id, name, total: { alliance, horde } } with the category's
    // achievement count and points (including subcategories) per faction.
    // Cached for 30 days, like the faction tree.
    achievementCategories(ns) {
      if (!achievementTrees.has(ns)) {
        achievementTrees.set(ns, loadTree(ns, "achievement-categories", walkAchievementCategories, (c) => ({ roots: c.roots })));
      }
      return achievementTrees.get(ns);
    },
    // { id: { points, category, icon } } for the achievements asked for,
    // where known; category is the achievement's own (possibly sub-)
    // category name. A character completes well over a thousand, so the
    // details live in one map per namespace (ref:{ns}:achievement-details),
    // read once a run and written when it grows. Missing ones are fetched in
    // the order given (newest first, from the sync), each one lookup of two
    // requests, until the cap.
    achievementDetails(ns, ids) {
      const base = detailMaps.get(ns) ?? readAchievementDetails(ns);
      const result = base.then((map) => addAchievementDetails(ns, map, ids));
      // Chained, so callers never fetch or write the map at once; a failed
      // call leaves the map as it was for the next.
      detailMaps.set(ns, result.catch(() => base));
      return result;
    },
    // The current Mythic+ season's id, or null: one request per namespace
    // per run (ns is a dynamic namespace).
    currentMythicSeason(ns) {
      if (!mythicSeasons.has(ns)) {
        mythicSeasons.set(
          ns,
          client.get("/data/wow/mythic-keystone/season/index", ns).then((res) => (res.status === 200 ? (res.data?.current_season?.id ?? null) : null)),
        );
      }
      return mythicSeasons.get(ns);
    },
    petIcon(ns, speciesId) {
      return lookup(`ref:${ns}:pet-icon:${speciesId}`, false, async () => {
        const res = await client.get(`/data/wow/pet/${speciesId}`, ns);
        return res.status === 200 ? (res.data?.icon ?? null) : null;
      });
    },
    // Mounts have no icon in the API: this is the zoomed render of the
    // mount's first creature display. Two requests, counted as one lookup.
    mountIcon(ns, mountId) {
      return lookup(`ref:${ns}:mount-icon:${mountId}`, false, async () => {
        const res = await client.get(`/data/wow/mount/${mountId}`, ns);
        const displayId = res.status === 200 ? res.data?.creature_displays?.[0]?.id : null;
        if (!displayId) return null;
        const media = await client.get(`/data/wow/media/creature-display/${displayId}`, ns);
        if (media.status !== 200) return null;
        return media.data?.assets?.find((a) => a.key === "zoom")?.value ?? null;
      });
    },
    toyIcon(ns, toyId) {
      return itemOf(ns, "toy", toyId);
    },
    heirloomIcon(ns, heirloomId) {
      return itemOf(ns, "heirloom", heirloomId);
    },
    stats() {
      return { ...counts };
    },
  };

  async function readAchievementDetails(ns) {
    const cached = await kv.get(`ref:${ns}:achievement-details`, "json");
    if (cached) counts.hits++;
    return cached ?? {};
  }

  // Adds the missing ids to the map, in order, while under the cap, and
  // stores the map if it grew. Returns the whole map.
  async function addAchievementDetails(ns, map, ids) {
    const missing = [...new Set(ids)].filter((id) => !(id in map));
    let grew = false;
    for (let i = 0; i < missing.length; i += CHUNK) {
      const chunk = missing.slice(i, i + CHUNK);
      const batch = chunk.slice(0, Math.max(0, maxNewLookups - counts.fetched));
      counts.fetched += batch.length;
      const found = await Promise.all(batch.map((id) => fetchAchievementDetail(ns, id)));
      batch.forEach((id, j) => {
        if (found[j]) {
          map[id] = found[j];
          grew = true;
        }
      });
      if (batch.length < chunk.length) {
        counts.skipped++;
        break;
      }
    }
    if (grew) await kv.put(`ref:${ns}:achievement-details`, JSON.stringify(map));
    return map;
  }

  async function fetchAchievementDetail(ns, id) {
    const [info, media] = await Promise.all([client.get(`/data/wow/achievement/${id}`, ns), client.get(`/data/wow/media/achievement/${id}`, ns)]);
    if (info.status !== 200) return null;
    return {
      points: info.data?.points ?? 0,
      category: info.data?.category?.name ?? null,
      icon: media.status === 200 ? (media.data?.assets?.find((a) => a.key === "icon")?.value ?? null) : null,
    };
  }

  // Reads a cached tree from ref:{ns}:{name}, walking it again once it is
  // 30 days old. A walk that fails or would pass the cap keeps nothing and
  // returns the previous tree, or null.
  async function loadTree(ns, name, walk, pick) {
    const key = `ref:${ns}:${name}`;
    const cached = await kv.get(key, "json");
    const previous = cached ? pick(cached) : null;
    if (cached && now() - cached.builtAt < TREE_MAX_AGE_MS) {
      counts.hits++;
      return previous;
    }
    const walked = await walk(ns);
    if (!walked) return previous;
    await kv.put(key, JSON.stringify({ builtAt: now(), ...walked }));
    return walked;
  }
}
