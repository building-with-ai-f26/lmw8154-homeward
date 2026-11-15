// Deterministic checks for server.js routes. No AI calls, no cost, runs in about a second.
// It starts the real server on a spare port with a throwaway data file, then checks:
//   - the app and the shared docs/ pages and files load, with the right types
//   - nothing outside the allowlist is reachable (.env, data/, private/, code, path tricks)
//   - the local-only checks still block other hosts and non-JSON posts
//
// Run it with: npm test
const http = require("node:http");
const net = require("node:net");
const os = require("node:os");
const fs = require("node:fs");
const path = require("node:path");

function freePort() {
  return new Promise((resolve) => {
    const s = net.createServer().listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

// node:http (not fetch) so the test can send any path as-is and set the Host header.
function request(port, urlPath, { method = "GET", host = `localhost:${port}`, headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, path: urlPath, method, headers: { Host: host, ...headers } }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

let failures = 0;
function check(name, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : "  -> " + detail}`);
  if (!ok) failures++;
}

async function main() {
  const port = await freePort();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "homeward-test-"));
  process.env.PORT = String(port);
  process.env.HOMEWARD_DATA_FILE = path.join(tmp, "claims.json"); // never touches your real data
  const { server } = require("../server.js");
  await new Promise((r) => server.listen(port, "127.0.0.1", r));

  try {
    // 1. Pages and shared files load with the right content type
    const ok = [
      ["/", "text/html", "Conflict Tracker"],
      ["/business-map.html", "text/html", "Palisades Business Directory"],
      ["/resources.html", "text/html", "Recovery Resources"],
      ["/editorial.css", "text/css", "--accent"],
      ["/nav.js", "text/javascript", "site-nav"],
      ["/images/coast-bluff-1536.jpg", "image/jpeg"],
      ["/images/coast-bluff-1536.webp", "image/webp"],
      ["/fonts/fraunces-latin.woff2", "font/woff2"],
      ["/fonts/OFL.txt", "text/plain", "Open Font License"],
      ["/map-data/palisades-businesses.json", "application/json", "businesses"],
      ["/resources-data/palisades-organizations.json", "application/json", "organizations"],
      ["/editorial.css?v=2", "text/css"],
      ["/theme.css", null, null, 404],
      ["/images/hero-coast.jpg", null, null, 404],
    ];
    for (const [url, type, text, expect] of ok) {
      const r = await request(port, url);
      if (expect === 404) { check(`GET ${url} -> 404 (removed file)`, r.status === 404, `status ${r.status}`); continue; }
      check(`GET ${url} -> 200 ${type}`, r.status === 200 && r.headers["content-type"].startsWith(type) && (!text || r.body.includes(text)),
        `status ${r.status}, type ${r.headers["content-type"]}`);
    }
    const css = await request(port, "/editorial.css");
    check("docs/ files are sent with nosniff", css.headers["x-content-type-options"] === "nosniff");

    // 2. Everything else is unreachable
    const blocked = [
      "/.env", "/.env.example", "/server.js", "/prompt.js", "/package.json", "/AGENTS.md",
      "/data/claims.json", "/private/anything.txt", "/research/palisades-businesses.json",
      "/docs/index.html", "/index.html", "/public/index.html", "/samples/README.md",
      "/images/", "/images/../../.env", "/images/..%2f..%2f.env", "/images/%2e%2e/%2e%2e/.env",
      "/fonts/../../server.js", "/map-data/..", "/images/.hidden.jpg", "/images/missing.jpg", "/images/x.webp.exe", "/images/coast-bluff-1536.WEBP",
      "/map-data/palisades-businesses.js", "/images/hero-coast.jpg/x", "//etc/passwd", "/theme.css/../server.js",
    ];
    for (const url of blocked) {
      const r = await request(port, url);
      check(`GET ${url} -> 404`, r.status === 404, `status ${r.status}`);
    }

    // 3. Local-only checks are unchanged
    for (const host of ["evil.example", "localhost", `localhost.evil.example:${port}`, "0.0.0.0:" + port]) {
      const r = await request(port, "/editorial.css", { host });
      check(`Host "${host}" -> 403`, r.status === 403, `status ${r.status}`);
    }
    const r127 = await request(port, "/editorial.css", { host: `127.0.0.1:${port}` });
    check(`Host "127.0.0.1:${port}" -> 200`, r127.status === 200, `status ${r127.status}`);
    const plain = await request(port, "/api/analyze", { method: "POST", headers: { "Content-Type": "text/plain" }, body: "hello" });
    check("POST /api/analyze as text/plain -> 415 (no AI call)", plain.status === 415, `status ${plain.status}`);
    const postFile = await request(port, "/editorial.css", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    check("POST to a docs/ file -> 404", postFile.status === 404, `status ${postFile.status}`);
  } finally {
    server.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  console.log(failures ? `\n${failures} check(s) failed.` : "\nAll checks passed.");
  process.exit(failures ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
