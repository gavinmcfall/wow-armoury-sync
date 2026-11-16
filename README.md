# nerdz-armory-sync

A Cloudflare Worker that copies Gavin's World of Warcraft characters (retail and WoW Forever) from the Battle.net API into Workers KV every night, for the armory pages on nerdz.cloud to read.

It has no public URL. It only runs on its cron trigger: 14:17 UTC, which is 03:17 in New Zealand during daylight saving time.

## What it stores

The KV namespace is `WOW_ARMORY`.

| Key | Holds |
| --- | --- |
| `index` | `updatedAt`, plus one summary per character: status, name, realm, level, race, class, spec, faction, item level, `lastSuccessAt` |
| `character:{key}` | The full record: profile, equipment, specializations, professions, reputations, character media, statistics, item icon URLs |
| `icon:{namespace}:{itemId}` | An item's icon URL. Icons never change, so each is fetched once and kept. |

Each character's status is one of:

- **`ok`**: synced this run.
- **`not-listed`**: the API doesn't list this character yet. WoW Forever characters appear only from level 10, after a logout.
- **`error`**: the API failed. The previous record and summary are kept and marked with the error.

## Characters

The tracked characters are listed in `src/characters.js`. Retail characters are addressed by realm and name. Forever has no realms, so Forever characters are addressed by `{name}-{surname}`.

## Secrets

`BNET_CLIENT_ID` and `BNET_CLIENT_SECRET` belong to a Battle.net API client. The sync uses an app token (client credentials), so no player login is involved.

- **Deployed:** set as Worker secrets.
- **Local:** set in `.dev.vars`, which git ignores.

## Commands

| Command | Does |
| --- | --- |
| `npm test` | Unit tests, using a fake Battle.net API and a fake KV |
| `npm run dev` | Runs the Worker locally against the **real** KV namespace. To trigger the sync, open `http://127.0.0.1:8787/cdn-cgi/local/scheduled`. |
| `npm run deploy` | Deploys the Worker |
| `node --env-file=.dev.vars scripts/forever-probe.mjs` | Checks which API endpoints answer for each character |

Wrangler needs a Cloudflare token for the nerdz account. In PowerShell:

```powershell
$env:CLOUDFLARE_API_TOKEN = $env:CLOUDFLARE_API_TOKEN_NERDZ
```
