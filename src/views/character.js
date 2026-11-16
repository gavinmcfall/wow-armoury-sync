// Builds the Character tab view (schema version 1) from raw API responses.
// Pure: no I/O. Any section may be null when its fetch failed; the view is
// still complete, with that part empty.
//
// Display strings come from the API wherever it supplies them; numbers the
// API leaves unformatted get neutral formatting ("52,360", "18%").

export const CHARACTER_VIEW_VERSION = 1;

const number = (n) => (typeof n === "number" ? n.toLocaleString("en-US", { maximumFractionDigits: 0 }) : null);
const percent = (n, digits) => (typeof n === "number" ? `${n.toFixed(digits)}%` : null);

export function buildCharacterView({
  game,
  fetchedAt,
  equipment,
  statistics,
  specializations,
  media,
  pvp,
  mythic,
  raids,
  itemIcons = {},
  classSpecs = null,
}) {
  return {
    schemaVersion: CHARACTER_VIEW_VERSION,
    game,
    fetchedAt,
    render: mediaAsset(media, "main-raw"),
    equipment: (equipment?.equipped_items ?? []).map((item) => mapItem(item, itemIcons)),
    stats: game === "forever" ? foreverStats(statistics) : retailStats(statistics),
    specs: game === "forever" ? foreverSpecs(specializations) : retailSpecs(specializations, classSpecs),
    mythicPlus: game === "forever" ? null : { rating: roundOrNull(mythic?.current_mythic_rating?.rating) },
    raids: newestRaids(raids),
    pvp: {
      honorLevel: pvp?.honor_level ?? null,
      honorableKills: pvp?.honorable_kills ?? 0,
      rank: pvp?.pvp_rank ?? null,
    },
  };
}

export function mediaAsset(media, key) {
  return media?.assets?.find((a) => a.key === key)?.value ?? null;
}

const roundOrNull = (n) => (typeof n === "number" ? Math.round(n) : null);

function mapItem(item, itemIcons) {
  const iconId = item.media?.id ?? item.item?.id;
  return {
    slot: item.slot.type,
    slotName: item.slot.name,
    name: item.name,
    quality: item.quality?.type ?? "COMMON",
    itemLevel: item.level?.value ?? null,
    icon: itemIcons[iconId] ?? null,
    binding: item.binding?.name ?? null,
    inventoryType: item.inventory_type?.name ?? null,
    subclass: item.is_subclass_hidden ? null : (item.item_subclass?.name ?? null),
    armor: item.armor?.display?.display_string ?? null,
    stats: (item.stats ?? []).map((s) => ({
      text: s.display?.display_string ?? "",
      negated: s.is_negated === true,
      equipBonus: s.is_equip_bonus === true,
    })),
    enchantments: (item.enchantments ?? []).map((e) => e.display_string).filter(Boolean),
    sockets: (item.sockets ?? []).map((s) => s.display_string ?? s.socket_type?.name).filter(Boolean),
    spells: (item.spells ?? []).map((s) => s.description).filter(Boolean),
    set: item.set?.display_string ?? null,
    weapon: item.weapon
      ? {
          damage: item.weapon.damage?.display_string ?? null,
          speed: item.weapon.attack_speed?.display_string ?? null,
          dps: item.weapon.dps?.display_string ?? null,
        }
      : null,
    requirement: item.requirements?.level?.display_string ?? null,
    description: item.description ?? null,
    nameDescription: item.name_description?.display_string ?? null,
  };
}

// Health, power, the character's highest primary stat, then Stamina.
function coreStats(s) {
  const primaries = [
    ["Strength", s.strength?.effective],
    ["Agility", s.agility?.effective],
    ["Intellect", s.intellect?.effective],
  ].filter(([, v]) => typeof v === "number");
  const primary = primaries.sort((a, b) => b[1] - a[1])[0];
  return [
    { label: "Health", value: number(s.health) },
    { label: s.power_type?.name ?? "Power", value: number(s.power) },
    ...(primary ? [{ label: primary[0], value: number(primary[1]) }] : []),
    { label: "Stamina", value: number(s.stamina?.effective) },
  ];
}

function retailStats(s) {
  if (!s) return [];
  return [
    ...coreStats(s),
    { label: "Critical strike", value: percent(s.melee_crit?.value, 0) },
    { label: "Haste", value: percent(s.melee_haste?.value, 0) },
    { label: "Mastery", value: percent(s.mastery?.value, 0) },
    { label: "Versatility", value: percent(s.versatility_damage_done_bonus, 0) },
  ].filter((x) => x.value !== null);
}

function foreverStats(s) {
  if (!s) return [];
  return [
    ...coreStats(s),
    { label: "Critical strike", value: percent(s.melee_crit?.value, 1) },
    { label: "Armor", value: number(s.armor?.effective) },
  ].filter((x) => x.value !== null);
}

// Every spec of the class, in the class's order, with the active one marked.
// The API only lists specs the character has used, so the full list comes
// from the class reference data; without it, the API's list is used.
function retailSpecs(sp, classSpecs) {
  const listed = new Map((sp?.specializations ?? []).map((s) => [s.specialization?.name, s]));
  const activeName = sp?.active_specialization?.name ?? null;
  const names = classSpecs ?? [...listed.keys()];
  return names.map((name) => {
    const entry = listed.get(name);
    const active = name === activeName;
    const loadout = entry?.loadouts?.find((l) => l.is_active);
    return {
      name,
      active,
      heroTalent:
        loadout?.selected_hero_talent_tree?.name ?? (active ? (sp?.active_hero_talent_tree?.name ?? null) : null),
      pvpTalents: (entry?.pvp_talent_slots ?? []).map((t) => t.selected?.talent?.name).filter(Boolean),
      spentPoints: null,
    };
  });
}

// Forever reports talent points per tree rather than an active spec; the
// tree with the most points is the active one.
function foreverSpecs(sp) {
  const group = sp?.specialization_groups?.find((g) => g.is_active);
  const trees = group?.specializations ?? [];
  const top = Math.max(0, ...trees.map((t) => t.spent_points ?? 0));
  let marked = false;
  return trees.map((t) => {
    const active = !marked && top > 0 && (t.spent_points ?? 0) === top;
    if (active) marked = true;
    return { name: t.specialization_name, active, heroTalent: null, pvpTalents: [], spentPoints: t.spent_points ?? 0 };
  });
}

// The active Forever spec name, or null: shared with the index summary.
export function foreverActiveSpec(sp) {
  return foreverSpecs(sp).find((s) => s.active)?.name ?? null;
}

// The API lists expansions in no useful order; the newest has the highest id.
function newestRaids(raids) {
  const expansions = raids?.expansions ?? [];
  if (expansions.length === 0) return null;
  const newest = expansions.reduce((a, b) => (b.expansion.id > a.expansion.id ? b : a));
  return {
    expansion: newest.expansion.name,
    instances: (newest.instances ?? []).map((i) => ({
      name: i.instance?.name,
      modes: (i.modes ?? []).map((m) => ({
        difficulty: m.difficulty?.name,
        completed: m.progress?.completed_count ?? 0,
        total: m.progress?.total_count ?? 0,
      })),
    })),
  };
}
