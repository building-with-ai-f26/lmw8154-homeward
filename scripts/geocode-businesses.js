// One-time geocoder for the business recovery map.
//
// Reads docs/map-data/palisades-businesses.json (copied from research/ on first run),
// looks up missing coordinates with OpenStreetMap's Nominatim, and saves the
// results back into that file so they are never looked up again.
//
// Nominatim usage policy: https://operations.osmfoundation.org/policies/nominatim/
//   - at most 1 request per second
//   - identifying User-Agent
//   - cache results (we save after every lookup)
//
// Run: node scripts/geocode-businesses.js

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const SOURCE = path.join(ROOT, "research", "palisades-businesses.json");
const TARGET = path.join(ROOT, "docs", "map-data", "palisades-businesses.json");

const USER_AGENT =
  "Homeward-business-map/1.0 (+https://github.com/building-with-ai-f26/lmw8154-homeward)";
const ENDPOINT = "https://nominatim.openstreetmap.org/search";

// Rough box around Pacific Palisades and Santa Monica Canyon. Anything outside is rejected.
const BOX = { west: -118.6, east: -118.49, south: 34.02, north: 34.1 };

// Businesses in this area with a placeholder address go on one shared pin.
const SHARED = {
  id: "palisades_village",
  label: "Palisades Village shopping center",
  area: "Palisades Village",
  // Center's street address, confirmed by the project owner (name searches found nothing).
  address: "15225 Palisades Village Lane",
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let lastRequest = 0;

async function nominatim(params) {
  const wait = lastRequest + 1100 - Date.now(); // a little over 1s between requests
  if (wait > 0) await sleep(wait);
  lastRequest = Date.now();

  const url = new URL(ENDPOINT);
  const all = {
    ...params,
    format: "jsonv2",
    addressdetails: "1",
    limit: "1",
    countrycodes: "us",
    viewbox: `${BOX.west},${BOX.north},${BOX.east},${BOX.south}`,
    bounded: "1",
  };
  for (const [k, v] of Object.entries(all)) url.searchParams.set(k, v);

  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) throw new Error(`Nominatim HTTP ${res.status}`);
  const results = await res.json();
  return results[0] || null;
}

// "15130 Sunset Blvd" and "Sunset Boulevard" should compare equal.
const ABBREV = { blvd: "boulevard", dr: "drive", rd: "road", hwy: "highway", w: "west", e: "east", ave: "avenue", st: "street" };
function normStreet(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[.,]/g, "")
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => ABBREV[w] || w)
    .join(" ");
}

function inBox(lat, lon) {
  return lat >= BOX.south && lat <= BOX.north && lon >= BOX.west && lon <= BOX.east;
}

// Returns { latitude, longitude, geocode_status, geocode_note, geocode_match }.
async function geocodeAddress(address) {
  const m = address.match(/^(\d+)\s+(.+)$/);
  if (!m) return flagged("Address has no house number; not looked up.");
  const [, number, street] = m;

  const hit = await nominatim({ street: address, state: "California" });
  if (!hit) return flagged("Nominatim found no match inside the Palisades area.");

  const lat = Number(hit.lat);
  const lon = Number(hit.lon);
  const a = hit.address || {};
  const match = hit.display_name;

  if (!inBox(lat, lon)) return flagged("Match fell outside the Palisades area.", match);
  if (a.house_number !== number)
    return flagged(a.house_number
      ? `OpenStreetMap matched house number ${a.house_number}, not ${number}.`
      : `OpenStreetMap found the street but not house number ${number}.`, match);
  const want = normStreet(street);
  const got = normStreet(a.road);
  if (!got.includes(want.replace(/^west /, "")) && !want.includes(got))
    return flagged(`Match is on "${a.road || "unknown road"}", expected "${street}".`, match);

  return { latitude: lat, longitude: lon, geocode_status: "ok", geocode_note: "", geocode_match: match };
}

function flagged(note, match = "") {
  return { latitude: null, longitude: null, geocode_status: "flagged", geocode_note: note, geocode_match: match };
}

function save(data) {
  fs.writeFileSync(TARGET, JSON.stringify(data, null, 2) + "\n");
}

async function main() {
  if (!fs.existsSync(TARGET)) {
    fs.mkdirSync(path.dirname(TARGET), { recursive: true });
    fs.copyFileSync(SOURCE, TARGET);
    console.log(`Copied ${path.relative(ROOT, SOURCE)} -> ${path.relative(ROOT, TARGET)}`);
  }
  const data = JSON.parse(fs.readFileSync(TARGET, "utf8"));
  data.shared_pins = data.shared_pins || {};

  // 1. Shared pin for the shopping center.
  // Re-tried if missing or previously flagged. "manual" means coordinates were
  // entered by hand (Nominatim has no record of the center) and are never overwritten.
  if (!["ok", "manual"].includes(data.shared_pins[SHARED.id]?.geocode_status)) {
    data.shared_pins[SHARED.id] = {
      label: SHARED.label,
      address: SHARED.address,
      note: "Pin marks the shopping center, not each store's exact spot.",
      ...(await geocodeAddress(SHARED.address)),
    };
    save(data);
  }

  // 2. Each business. Repeated addresses are looked up once.
  const cache = new Map();
  for (const b of data.businesses) {
    if (b.geocode_status) continue; // already handled on an earlier run

    if (b.area === SHARED.area && /^palisades village\b/i.test(b.address)) {
      Object.assign(b, { latitude: null, longitude: null, geocode_status: "shared_pin", shared_pin: SHARED.id,
        geocode_note: "Exact unit not known; shown on the shopping center pin.", geocode_match: "" });
    } else if (/verify|not given/i.test(b.address)) {
      Object.assign(b, flagged("Address is not specific enough to place; not looked up."));
    } else {
      if (!cache.has(b.address)) cache.set(b.address, await geocodeAddress(b.address));
      Object.assign(b, cache.get(b.address));
    }
    save(data);
    console.log(`${b.geocode_status.padEnd(10)} ${b.name} — ${b.address}${b.geocode_note ? `  (${b.geocode_note})` : ""}`);
  }

  // 3. Summary.
  const count = (s) => data.businesses.filter((b) => b.geocode_status === s).length;
  const pin = data.shared_pins[SHARED.id];
  console.log(`\nShared pin "${pin.label}": ${pin.geocode_status} ${pin.geocode_match || pin.geocode_note}`);
  console.log(`Placed: ${count("ok")}  On shared pin: ${count("shared_pin")}  Flagged: ${count("flagged")}`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
