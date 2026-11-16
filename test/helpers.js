// Test stand-ins shared by the test files.
import { BlizzardClient } from "../src/blizzard.js";

// In-memory stand-in for a Workers KV namespace.
export function fakeKv(initial = {}) {
  const store = new Map(Object.entries(initial).map(([k, v]) => [k, typeof v === "string" ? v : JSON.stringify(v)]));
  return {
    store,
    async get(key, type) {
      const v = store.get(key);
      if (v === undefined) return null;
      return type === "json" ? JSON.parse(v) : v;
    },
    async put(key, value) {
      store.set(key, value);
    },
    json(key) {
      const v = store.get(key);
      return v === undefined ? undefined : JSON.parse(v);
    },
  };
}

// Builds a fetch stand-in from a function that maps a request path to
// [status, body]. Records every API path requested.
export function fakeFetch(route) {
  const calls = [];
  const impl = async (url) => {
    if (url === "https://oauth.battle.net/token") {
      return new Response(JSON.stringify({ access_token: "t" }), { status: 200 });
    }
    const u = new URL(url);
    const path = decodeURIComponent(u.pathname);
    calls.push(path);
    const [status, body] = route(path, u.searchParams.get("namespace"));
    return new Response(body === undefined ? null : JSON.stringify(body), { status });
  };
  impl.calls = calls;
  return impl;
}

export function client(fetchImpl) {
  return new BlizzardClient({ clientId: "id", clientSecret: "secret", region: "us", fetchImpl, retryDelayMs: 0 });
}
