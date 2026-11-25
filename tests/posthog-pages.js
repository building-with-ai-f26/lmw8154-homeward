// Checks the AGENTS.md analytics rules. Free and instant; reads files only.
//   - every HTML page in docs/ and public/ includes the PostHog snippet (US host,
//     a real project key, inputs masked in session replay)
//   - the Decide page keeps ph-no-capture on everything a family types or sees,
//     wipes shared-link numbers before PostHog loads, and its events carry no numbers or names
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

// Decide page: nothing a family types or sees as a result reaches analytics.
const decide = fs.readFileSync(path.join(ROOT, "public", "decide.html"), "utf8");
const decideJs = fs.readFileSync(path.join(ROOT, "public", "decide.js"), "utf8");
for (const id of ["inputs", "results"]) {
  const tag = decide.match(new RegExp(`<[^>]*id="${id}"[^>]*>`));
  check(`decide: #${id} has ph-no-capture`, !!tag && /class="[^"]*\bph-no-capture\b/.test(tag[0]));
}
check("decide: shared-link numbers are wiped from the address bar before PostHog loads",
  decide.indexOf("history.replaceState") > -1 && decide.indexOf("history.replaceState") < decide.indexOf("posthog.init"));
for (const ev of ["scenario_changed", "summary_requested", "share_link_created", "print_clicked", "family_member_added", "rebuild_estimate_used"]) {
  check(`decide: sends "${ev}"`, decideJs.includes(`track("${ev}"`));
}
// Every event's properties are labels or counts only: never dollar amounts or names.
const calls = [...decideJs.matchAll(/track\("([a-z_]+)", (\{[^}]*\})\)/g)];
const allowed = /^\{\s*(?:(?:situation: state\.situation|speed: state\.speed|people: people\.length|pace: key|size: sizeKey)(?:,\s*)?)*\s*\}$/;
check("decide: the estimate's size label comes from a fixed list", /const SIZE_KEYS = \["all", "small", "medium", "large"\]/.test(decideJs) && /SIZE_KEYS\.includes\(/.test(decideJs));
check(`decide: ${calls.length} analytics calls found`, calls.length >= 5);
for (const [, ev, props] of calls) check(`decide: "${ev}" sends only labels or counts ${props}`, allowed.test(props));

console.log(failures ? `\n${failures} check(s) failed.` : "\nAll PostHog checks passed.");
process.exit(failures ? 1 : 0);
