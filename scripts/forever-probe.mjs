// forever-probe.mjs: checks which Battle.net character endpoints answer for
// Retail and WoW Forever using only an app (client credentials) token, so we
// know what the nightly sync can rely on. Prints status codes and a few
// summary fields, never the credentials or full payloads.
//
// Run from the repo root:  node --env-file=.dev.vars scripts/forever-probe.mjs

const REGION = "us";
const API = `https://${REGION}.api.blizzard.com`;
const LOCALE = "en_US";

const { BNET_CLIENT_ID, BNET_CLIENT_SECRET } = process.env;
if (!BNET_CLIENT_ID || !BNET_CLIENT_SECRET) {
  console.error("BNET_CLIENT_ID and BNET_CLIENT_SECRET must be set (see .dev.vars).");
  process.exit(1);
}

const SUB_ENDPOINTS = [
  "equipment",
  "specializations",
  "professions",
  "reputations",
  "character-media",
  "statistics",
];

// Forever: no realms. Characters are addressed as {name}-{surname}.
const FOREVER = [
  "consecrator",
  "recurve",
  "abracadaddy",
  "valewarden",
  "thunderbuddy",
  "soulmine",
  "nihilist",
  "eviscerator",
  "vengeance",
].map((name) => ({ label: `${name} ravenholt`, path: `${name}-ravenholt`, namespace: `profile-forever-${REGION}` }));

// Retail control: a known level 80 on Barthilas, to prove the token works.
const RETAIL = [
  { label: "cònsecrator @ barthilas (retail)", path: `barthilas/${encodeURIComponent("cònsecrator")}`, namespace: `profile-${REGION}` },
];

async function getToken() {
  const basic = Buffer.from(`${BNET_CLIENT_ID}:${BNET_CLIENT_SECRET}`).toString("base64");
  const res = await fetch("https://oauth.battle.net/token", {
    method: "POST",
    headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
  });
  if (!res.ok) throw new Error(`Token request failed: HTTP ${res.status}`);
  return (await res.json()).access_token;
}

async function get(token, path, namespace) {
  const url = `${API}/profile/wow/character/${path}?namespace=${namespace}&locale=${LOCALE}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const body = res.ok ? await res.json() : null;
  return { status: res.status, body };
}

function summary(p) {
  if (!p) return "";
  const parts = [
    `level ${p.level ?? "?"}`,
    p.race?.name,
    p.character_class?.name,
    p.active_spec?.name,
    p.faction?.name,
    p.realm?.name && `realm: ${p.realm.name}`,
    p.equipped_item_level != null && `ilvl ${p.equipped_item_level}`,
  ].filter(Boolean);
  return parts.join(" · ");
}

const token = await getToken();
console.log("Token: OK (client credentials)\n");

for (const c of [...RETAIL, ...FOREVER]) {
  const profile = await get(token, c.path, c.namespace);
  console.log(`${c.label}: profile ${profile.status}${profile.body ? "  " + summary(profile.body) : ""}`);
  if (profile.status !== 200) continue;
  const subs = [];
  for (const ep of SUB_ENDPOINTS) {
    const r = await get(token, `${c.path}/${ep}`, c.namespace);
    subs.push(`${ep} ${r.status}`);
  }
  console.log(`    ${subs.join(" | ")}`);
}
