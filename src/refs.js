import { measureFigure } from "./portrait.js";

// Reference data that rarely or never changes (item icons, a class's spec
// list), cached in KV under ref:{namespace}:… so each value is fetched once.
// Portrait framing is cached too, under ref:portrait:{render path}.
//
// New lookups per run are capped: a first run with a large roster, or a
// season's worth of new gear, stays inside the Worker's subrequest limit.
// A lookup over the cap returns null; it is fetched on a later night.

// `fetchImage` fetches Blizzard's render images, which need no API token.
export function createRefs({ client, kv, maxNewLookups = 2000, fetchImage = (...args) => fetch(...args) }) {
  const counts = { hits: 0, fetched: 0, skipped: 0 };

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
    stats() {
      return { ...counts };
    },
  };
}
