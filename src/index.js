// wow-armoury-sync: pulls WoW character data from the Battle.net API on a
// nightly schedule and stores ready-to-render views in KV (WOW_ARMORY).
// It serves no public pages.
import { BlizzardClient } from "./blizzard.js";
import { REGION, trackedCharacters } from "./characters.js";
import { syncAll } from "./sync.js";

export default {
  async fetch() {
    return new Response("Not found", { status: 404 });
  },

  async scheduled(controller, env, ctx) {
    const client = new BlizzardClient({
      clientId: env.BNET_CLIENT_ID,
      clientSecret: env.BNET_CLIENT_SECRET,
      region: REGION,
    });
    ctx.waitUntil(
      syncAll({ client, kv: env.WOW_ARMORY, characters: trackedCharacters(REGION) }).then(({ summaries, refs }) => {
        const counts = summaries.reduce((acc, s) => ({ ...acc, [s.status]: (acc[s.status] ?? 0) + 1 }), {});
        console.log(JSON.stringify({ event: "armory-sync", cron: controller.cron, counts, refs }));
      }),
    );
  },
};
