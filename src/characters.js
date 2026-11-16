// The characters the armory tracks. Retail characters are addressed by realm
// and name; Forever has no realms, so its characters are addressed by first
// name and surname. Names are lowercase, as the Battle.net API expects.
//
// Forever characters only appear in the API from level 10, after a logout.
// Until then the sync records them as "not-listed" and tries again next run.

export const REGION = "us";

export const RETAIL = [
  { realm: "barthilas", name: "cònsecrator" },
  { realm: "barthilas", name: "dìabolical" },
  { realm: "barthilas", name: "rècurve" },
  { realm: "barthilas", name: "soulmine" },
  { realm: "barthilas", name: "thùnderbuddy" },
  { realm: "barthilas", name: "valewarden" },
  { realm: "barthilas", name: "evòcator" },
  { realm: "barthilas", name: "magigasm" },
  { realm: "barthilas", name: "unbeàrable" },
  { realm: "barthilas", name: "vèngeance" },
  { realm: "nagrand", name: "malignant" },
  { realm: "nagrand", name: "nihilist" },
];

export const FOREVER = [
  { name: "consecrator", surname: "ravenholt" },
  { name: "recurve", surname: "ravenholt" },
  { name: "abracadaddy", surname: "ravenholt" },
  { name: "valewarden", surname: "ravenholt" },
  { name: "thunderbuddy", surname: "ravenholt" },
  { name: "soulmine", surname: "ravenholt" },
  { name: "nihilist", surname: "ravenholt" },
  { name: "eviscerator", surname: "ravenholt" },
  { name: "vengeance", surname: "ravenholt" },
];

const capitalise = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// One entry per tracked character, with everything the sync needs to address
// it in the API and in KV. `route` is the character's address for a site to
// use (unencoded, lowercase); the display names are for characters the API
// does not list yet, when there is no profile to take the real name from.
export function trackedCharacters(region = REGION) {
  return [
    ...RETAIL.map((c) => ({
      game: "retail",
      key: `retail:${region}:${c.realm}:${c.name}`,
      path: `${encodeURIComponent(c.realm)}/${encodeURIComponent(c.name)}`,
      route: ["retail", c.realm, c.name],
      displayName: capitalise(c.name),
      profileNamespace: `profile-${region}`,
      staticNamespace: `static-${region}`,
      // Mythic+ seasons live in the dynamic namespace.
      dynamicNamespace: `dynamic-${region}`,
    })),
    ...FOREVER.map((c) => ({
      game: "forever",
      key: `forever:${region}:${c.name}-${c.surname}`,
      path: encodeURIComponent(`${c.name}-${c.surname}`),
      route: ["forever", `${c.name}-${c.surname}`],
      displayName: capitalise(c.name),
      displaySurname: capitalise(c.surname),
      profileNamespace: `profile-forever-${region}`,
      staticNamespace: `static-forever-${region}`,
    })),
  ];
}
