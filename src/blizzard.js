// Thin Battle.net API client. Uses an app (client credentials) token, so no
// player login is involved. `fetchImpl` is injectable for tests.

const LOCALE = "en_US";
const RETRY_STATUSES = new Set([429, 500, 502, 503, 504]);

export class BlizzardClient {
  // The default wraps the global fetch: Workers throws "Illegal invocation" if
  // fetch is stored on an object and called as that object's method.
  constructor({ clientId, clientSecret, region, fetchImpl = (...args) => fetch(...args), retryDelayMs = 1000 }) {
    if (!clientId || !clientSecret) {
      throw new Error("BNET_CLIENT_ID and BNET_CLIENT_SECRET are required");
    }
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.base = `https://${region}.api.blizzard.com`;
    this.fetch = fetchImpl;
    this.retryDelayMs = retryDelayMs;
    this.token = null;
  }

  async authenticate() {
    const basic = btoa(`${this.clientId}:${this.clientSecret}`);
    const res = await this.fetch("https://oauth.battle.net/token", {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
    });
    if (!res.ok) throw new Error(`Battle.net token request failed: HTTP ${res.status}`);
    this.token = (await res.json()).access_token;
  }

  // GET an API path. Returns { status, data }: data is the parsed JSON on 200,
  // otherwise null. Retries once on rate limiting or a server error.
  async get(path, namespace) {
    if (!this.token) await this.authenticate();
    const sep = path.includes("?") ? "&" : "?";
    const url = `${this.base}${path}${sep}namespace=${namespace}&locale=${LOCALE}`;
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await this.fetch(url, { headers: { Authorization: `Bearer ${this.token}` } });
      if (res.ok) return { status: res.status, data: await res.json() };
      if (attempt === 0 && RETRY_STATUSES.has(res.status)) {
        await new Promise((r) => setTimeout(r, this.retryDelayMs));
        continue;
      }
      return { status: res.status, data: null };
    }
  }
}
