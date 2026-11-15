// Checks the AGENTS.md analytics rules. Free and instant; reads files only.
//   - every HTML page in docs/ and public/ includes the PostHog snippet (US host,
//     a real project key, inputs masked in session replay)
//   - the Conflict Tracker keeps ph-no-capture on the thread box and results,
//     and still sends the thread_analyzed and conflict_flagged events
//
// Run it with: npm test
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
let failures = 0;
function check(name, ok) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) failures++;
}

const pages = ["docs", "public"].flatMap((dir) =>
  fs.readdirSync(path.join(ROOT, dir))
    .filter((f) => f.endsWith(".html"))
    .map((f) => path.join(dir, f)));
check(`found pages to check (${pages.length})`, pages.length >= 4);

for (const page of pages) {
  const html = fs.readFileSync(path.join(ROOT, page), "utf8");
  check(`${page}: has the PostHog loader`, html.includes("e.__SV") && html.includes("/static/array.js"));
  check(`${page}: posthog.init with a real project key`, /posthog\.init\('phc_[A-Za-z0-9]{20,}'/.test(html) && !html.includes("phc_PASTE_HERE"));
  check(`${page}: US host`, html.includes("api_host: 'https://us.i.posthog.com'"));
  check(`${page}: session replay masks all inputs`, /session_recording:\s*\{\s*maskAllInputs:\s*true\s*\}/.test(html));
}

// Conflict Tracker: masking and custom events
const tracker = fs.readFileSync(path.join(ROOT, "public", "index.html"), "utf8");
for (const id of ["input", "totals", "claims", "conflicts", "questions"]) {
  const tag = tracker.match(new RegExp(`<[^>]*id="${id}"[^>]*>`));
  check(`tracker: #${id} has ph-no-capture`, !!tag && /class="[^"]*\bph-no-capture\b/.test(tag[0]));
}
check('tracker: sends "thread_analyzed" with conflict_count and duration_ms',
  /track\("thread_analyzed", \{ conflict_count: [^,]+, duration_ms: [^}]+\}\)/.test(tracker));
check('tracker: sends "conflict_flagged" with party_pair only',
  /track\("conflict_flagged", \{ party_pair: pair \}\)/.test(tracker));

console.log(failures ? `\n${failures} check(s) failed.` : "\nAll PostHog checks passed.");
process.exit(failures ? 1 : 0);
