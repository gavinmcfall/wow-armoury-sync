import { measureFigure } from "./portrait.js";

// Reference data that rarely or never changes (item icons, a class's spec
// list), cached in KV under ref:{namespace}:… so each value is fetched once.
// Portrait framing is cached too, under ref:portrait:{render path}.
//
// New lookups per run are capped: a first run with a large roster, or a
// season's worth of new gear, stays inside the Worker's subrequest limit.
// A lookup over the cap returns null; it is fetched on a later night.

// The faction tree changes only when Blizzard adds factions in a patch.
const FACTION_TREE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const FACTION_CHUNK = 20;

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

  // Reads key from KV; on a miss, and while under the cap, calls load() and
  // caches a non-null result. Strings are stored as-is, anything else as JSON.
  async function lookup(key, asJson, load) {
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

  // Fetches faction records a level at a time. Returns them in order, or
  // null when any request fails or the batch would pass the cap.
  async function fetchFactions(ns, ids) {
    if (counts.fetched + ids.length > maxNewLookups) {
      counts.skipped++;
      return null;
    }
    counts.fetched += ids.length;
    // In chunks, to stay under Blizzard's 100 requests per second.
    const records = [];
    for (let i = 0; i < ids.length; i += FACTION_CHUNK) {
      const chunk = ids.slice(i, i + FACTION_CHUNK);
      const results = await Promise.all(chunk.map((id) => client.get(`/data/wow/reputation-faction/${id}`, ns)));
      if (results.some((r) => r.status !== 200)) return null;
      records.push(...results.map((r) => r.data));
    }
    return records;
  }

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

  return {
    itemIcon(ns, itemId) {
      return lookup(`ref:${ns}:item-icon:${itemId}`, false, async () => {
        const res = await client.get(`/data/wow/media/item/${itemId}`, ns);
        if (res.status !== 200) return null;
        return res.data?.assets?.find((a) => a.key === "icon")?.value ?? null;
      });
    },
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
      if (!factionTrees.has(ns)) factionTrees.set(ns, loadFactionGroups(ns));
      return factionTrees.get(ns);
    },
    stats() {
      return { ...counts };
    },
  };

  async function loadFactionGroups(ns) {
    const key = `ref:${ns}:faction-groups`;
    const cached = await kv.get(key, "json");
    const previous = cached ? { order: cached.order, byFaction: cached.byFaction } : null;
    if (cached && now() - cached.builtAt < FACTION_TREE_MAX_AGE_MS) {
      counts.hits++;
      return previous;
    }
    const walked = await walkFactionTree(ns);
    if (!walked) return previous;
    await kv.put(key, JSON.stringify({ builtAt: now(), ...walked }));
    return walked;
  }
}
