/** Normalize team text for alias comparison. */
export function normalizeMlbTeamKey(value = "") {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

/** MLB abbreviations → normalized alias keys (abbr, city, nickname). */
const MLB_TEAM_ALIASES = {
  ari: ["arizondiamondbacks", "diamondbacks", "dbacks", "ari"],
  atl: ["atlantabraves", "braves", "atl"],
  bal: ["baltimoreorioles", "orioles", "bal"],
  bos: ["bostonredsox", "redsox", "bos"],
  chc: ["chicagocubs", "cubs", "chc"],
  cin: ["cincinnatireds", "reds", "cin"],
  cle: ["clevelandguardians", "guardians", "indians", "cle"],
  col: ["coloradorockies", "rockies", "col"],
  cws: ["chicagowhitesox", "whitesox", "chw", "cws"],
  chw: ["chicagowhitesox", "whitesox", "chw", "cws"],
  det: ["detroittigers", "tigers", "det"],
  hou: ["houstonastros", "astros", "hou"],
  kc: ["kansascityroyals", "royals", "kc"],
  laa: ["losangelesangels", "angels", "laa", "ana"],
  lad: ["losangelesdodgers", "dodgers", "lad"],
  mia: ["miamimarlins", "marlins", "mia"],
  mil: ["milwaukeebrewers", "brewers", "mil"],
  min: ["minnesotatwins", "twins", "min"],
  nym: ["newyorkmets", "mets", "nym"],
  nyy: ["newyorkyankees", "yankees", "nyy"],
  oak: ["oaklandathletics", "athletics", "as", "oak"],
  phi: ["philadelphiaphillies", "phillies", "phi"],
  pit: ["pittsburghpirates", "pirates", "pit"],
  sd: ["sandiegopadres", "padres", "sd", "sdp"],
  sdp: ["sandiegopadres", "padres", "sd", "sdp"],
  sea: ["seattlemariners", "mariners", "sea"],
  sf: ["sanfranciscogiants", "giants", "sf", "sfg"],
  sfg: ["sanfranciscogiants", "giants", "sf", "sfg"],
  stl: ["stlouiscardinals", "cardinals", "stl"],
  tb: ["tampabayrays", "rays", "tb", "tbr"],
  tbr: ["tampabayrays", "rays", "tb", "tbr"],
  tex: ["texasrangers", "rangers", "tex"],
  tor: ["torontobluejays", "bluejays", "tor"],
  wsh: ["washingtonnationals", "nationals", "wsh", "was"],
  was: ["washingtonnationals", "nationals", "wsh", "was"],
};

function aliasKeysForTeam(value = "") {
  const needle = normalizeMlbTeamKey(value);
  if (!needle) return new Set();

  const keys = new Set([needle]);
  for (const [abbr, aliases] of Object.entries(MLB_TEAM_ALIASES)) {
    const group = new Set([abbr, ...aliases]);
    const hit = [...group].some((alias) => needle === alias || needle.includes(alias) || alias.includes(needle));
    if (hit) group.forEach((alias) => keys.add(alias));
  }
  return keys;
}

/** True when both sides refer to the same MLB team; empty side skips validation. */
export function mlbTeamsMatch(teamA = "", teamB = "") {
  const a = String(teamA || "").trim();
  const b = String(teamB || "").trim();
  if (!a || !b) return true;

  const keysA = aliasKeysForTeam(a);
  const keysB = aliasKeysForTeam(b);
  for (const left of keysA) {
    for (const right of keysB) {
      if (left === right || left.includes(right) || right.includes(left)) return true;
    }
  }
  return false;
}
