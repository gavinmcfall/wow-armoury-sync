// Reference data that rarely or never changes (item icons, a class's spec
// list), cached in KV under ref:{namespace}:… so each value is fetched once.
//
// New lookups per run are capped: a first run with a large roster, or a
// season's worth of new gear, stays inside the Worker's subrequest limit.
// A lookup over the cap returns null; it is fetched on a later night.

export function createRefs({ client, kv, maxNewLookups = 2000 }) {
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
    stats() {
      return { ...counts };
    },
  };
}
