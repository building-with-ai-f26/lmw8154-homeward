// Security test for the live app (Build 3): calls the AI summary route 30 times in a row
// and shows the rate limit kicking in with 429. Also confirms the page code holds no secret key.
//
// Run: npm run check:live -- https://your-app.onrender.com
// Cost: only the first few calls reach the AI (a few cents); the rest are refused.
const C = require("../public/calc.js");

const base = (process.argv[2] || "").replace(/\/$/, "");
if (!/^https:\/\//.test(base)) {
  console.error("Usage: npm run check:live -- https://your-app.onrender.com");
  process.exit(1);
}

(async () => {
  // 1. The site's own code must not contain any secret key.
  const files = ["/", "/decide", "/pulse", "/calc.js", "/decide.js", "/pulse.js", "/landing.js", "/nav.js", "/resources.html"];
  const secret = /(sk-or-|sk-ant-|sk-proj-|sk_live_|sb_secret_|service_role)/;
  let found = 0;
  for (const f of files) {
    const text = await (await fetch(base + f)).text();
    if (secret.test(text)) { console.log(`KEY FOUND in ${f}`); found++; }
  }
  console.log(found ? `Secret key search: ${found} file(s) need attention.` : `Secret key search: clean (${files.length} files checked).`);

  // 2. 30 calls in a row to the AI route.
  const body = JSON.stringify({ numbers: C.roundedForSummary(C.run({})) });
  const counts = {};
  for (let i = 1; i <= 30; i++) {
    const res = await fetch(base + "/api/summary", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: base },
      body,
    });
    const text = await res.text();
    counts[res.status] = (counts[res.status] || 0) + 1;
    console.log(`call ${String(i).padStart(2)} -> ${res.status}${res.status === 429 ? "  " + JSON.parse(text).error : ""}`);
  }
  console.log("\nSummary:", Object.entries(counts).map(([s, n]) => `${n} x ${s}`).join(", "));
  console.log(counts[429] ? "Rate limit works: calls were refused with 429." : "WARNING: no call was refused.");
})().catch((e) => { console.error(e); process.exit(1); });
