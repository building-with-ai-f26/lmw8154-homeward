// Homeward web server: no dependencies, stores nothing.
// Locally: `npm start`, then open http://localhost:3000. On Render: started the same way.
//
// What it does:
//   - serves the app pages (public/) and an allowlist of shared files from docs/
//   - POST /api/summary: turns rounded numbers into a plain-language summary with the AI
// What it never does: save anything a visitor types, or serve any file not on the allowlist.
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { SYSTEM_PROMPT, RESPONSE_SCHEMA, validateNumbers, buildUserMessage, cleanAnswer } = require("./summary-prompt.js");

// Read OPENROUTER_API_KEY (and the optional OPENROUTER_MODEL) from .env when running locally.
// On Render these come from the service's Environment settings instead.
try {
  process.loadEnvFile(path.join(__dirname, ".env"));
} catch {
  // No .env file: fine on Render, and the summary route reports a clear error locally.
}

const MODEL = process.env.OPENROUTER_MODEL || "anthropic/claude-opus-5.5";
const PORT = Number(process.env.PORT) || 3000;
const ON_RENDER = !!process.env.RENDER;
const BIND = process.env.BIND_HOST || (ON_RENDER ? "0.0.0.0" : "127.0.0.1");
const FAKE_AI = process.env.HOMEWARD_FAKE_AI === "1"; // tests only: no network, no cost

// Only answer requests addressed to this app. This blocks DNS-rebinding tricks and
// other sites pointing their own domain at the server.
const ALLOWED_HOSTS = new Set([`localhost:${PORT}`, `127.0.0.1:${PORT}`]);
for (const h of [process.env.RENDER_EXTERNAL_HOSTNAME, process.env.PUBLIC_HOST]) if (h) ALLOWED_HOSTS.add(h.toLowerCase());

// ---------- Files we serve (nothing else is reachable) ----------
const PUBLIC = path.join(__dirname, "public");
const DOCS = path.join(__dirname, "docs");
const PAGES = new Map([
  ["/", path.join(PUBLIC, "index.html")],
  ["/decide", path.join(PUBLIC, "decide.html")],
  ["/pulse", path.join(PUBLIC, "pulse.html")],
]);
const FILES = new Map([
  ["/app.css", path.join(PUBLIC, "app.css")],
  ["/calc.js", path.join(PUBLIC, "calc.js")],
  ["/decide.js", path.join(PUBLIC, "decide.js")],
  ["/pulse.js", path.join(PUBLIC, "pulse.js")],
  ["/landing.js", path.join(PUBLIC, "landing.js")],
  ["/resources.html", path.join(DOCS, "resources.html")],
  ["/editorial.css", path.join(DOCS, "editorial.css")],
  ["/nav.js", path.join(DOCS, "nav.js")],
]);
const DOCS_FOLDERS = new Set(["images", "fonts", "market-data", "resources-data"]);
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/plain; charset=utf-8",
};
const FOLDER_FILE_TYPES = new Set([".jpg", ".webp", ".woff2", ".json", ".txt", ".md"]);

function fileFor(urlPath) {
  if (PAGES.has(urlPath)) return PAGES.get(urlPath);
  if (FILES.has(urlPath)) return FILES.get(urlPath);
  // One folder plus one plain file name, e.g. /images/coast-bluff-1536.webp. The pattern
  // rules out "..", extra slashes and %-encoded tricks, so a path can't leave its folder.
  const m = urlPath.match(/^\/([a-z-]+)\/([A-Za-z0-9][A-Za-z0-9._-]*)$/);
  if (!m || !DOCS_FOLDERS.has(m[1]) || !FOLDER_FILE_TYPES.has(path.extname(m[2]))) return null;
  const file = path.join(DOCS, m[1], m[2]);
  return file.startsWith(path.join(DOCS, m[1]) + path.sep) ? file : null; // belt and braces
}

// ---------- Security headers on every response ----------
// PostHog loads its script from us-assets.i.posthog.com and sends events to us.i.posthog.com.
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://us-assets.i.posthog.com",
  "connect-src 'self' https://us.i.posthog.com https://us-assets.i.posthog.com",
  "img-src 'self' data: https://us.i.posthog.com",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self'",
  "worker-src 'self' blob:",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

function baseHeaders(type) {
  const h = {
    "Content-Type": type,
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "X-Frame-Options": "DENY",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
    "Content-Security-Policy": CSP,
    "Cross-Origin-Opener-Policy": "same-origin",
  };
  if (ON_RENDER) h["Strict-Transport-Security"] = "max-age=31536000";
  return h;
}

function sendJson(res, status, data, extra = {}) {
  res.writeHead(status, Object.assign(baseHeaders("application/json; charset=utf-8"), { "Cache-Control": "no-store" }, extra));
  res.end(JSON.stringify(data));
}

async function sendFile(res, file) {
  let body;
  try {
    body = await fs.promises.readFile(file);
  } catch (err) {
    if (err.code === "ENOENT" || err.code === "EISDIR") return sendJson(res, 404, { error: "Not found" });
    throw err;
  }
  const type = TYPES[path.extname(file)] || "application/octet-stream";
  res.writeHead(200, Object.assign(baseHeaders(type), { "Cache-Control": type.startsWith("text/html") ? "no-cache" : "public, max-age=3600" }));
  res.end(body);
}

// ---------- Rate limits for the paid AI route ----------
// Per visitor: 5 summaries per 10 minutes and 20 per day.
// Whole app: 20 per 10 minutes and 200 per day, so even a visitor who fakes their
// address can't run up the bill. The OpenRouter key's $4 monthly cap is the final backstop.
// Kept in memory, so they reset if the server restarts (noted in SECURITY.md).
const LIMITS = {
  burst: { max: Number(process.env.RL_BURST || 5), windowMs: 10 * 60 * 1000 },
  daily: { max: Number(process.env.RL_DAILY || 20), windowMs: 24 * 60 * 60 * 1000 },
  global: { max: Number(process.env.RL_GLOBAL || 200), windowMs: 24 * 60 * 60 * 1000 },
  globalBurst: { max: Number(process.env.RL_GLOBAL_BURST || 20), windowMs: 10 * 60 * 1000 },
};
const hits = new Map(); // visitor -> timestamps
let globalHits = [];

function clientId(req) {
  // On Render the app sits behind Cloudflare and Render's own proxies. Cloudflare sets
  // CF-Connecting-IP to the visitor's real address and overwrites any value a visitor sends.
  // (The first live test showed the LAST X-Forwarded-For entry is a proxy address that
  // changes between requests, which split one visitor into several. Fixed here.)
  if (ON_RENDER || process.env.TRUST_PROXY === "1") {
    const cf = String(req.headers["cf-connecting-ip"] || req.headers["true-client-ip"] || "").trim();
    if (cf) return cf;
    const xff = String(req.headers["x-forwarded-for"] || "").split(",").map((s) => s.trim()).filter(Boolean);
    if (xff.length) return xff[0];
  }
  return req.socket.remoteAddress || "unknown";
}

function rateLimit(id, now = Date.now()) {
  const mine = (hits.get(id) || []).filter((t) => now - t < LIMITS.daily.windowMs);
  globalHits = globalHits.filter((t) => now - t < LIMITS.global.windowMs);
  const burst = mine.filter((t) => now - t < LIMITS.burst.windowMs).length;
  if (burst >= LIMITS.burst.max) return { ok: false, retry: 600, why: "You've asked for several summaries in a row. Try again in about 10 minutes." };
  if (mine.length >= LIMITS.daily.max) return { ok: false, retry: 3600, why: "You've reached today's limit for AI summaries. The calculator still works." };
  if (globalHits.filter((t) => now - t < LIMITS.globalBurst.windowMs).length >= LIMITS.globalBurst.max) return { ok: false, retry: 600, why: "Homeward is getting a lot of summary requests right now. Try again in about 10 minutes." };
  if (globalHits.length >= LIMITS.global.max) return { ok: false, retry: 3600, why: "Homeward has reached today's limit for AI summaries. The calculator still works." };
  mine.push(now); hits.set(id, mine); globalHits.push(now);
  return { ok: true };
}
// Forget old visitors now and then so memory can't grow without limit.
setInterval(() => {
  const now = Date.now();
  for (const [id, list] of hits) if (!list.some((t) => now - t < LIMITS.daily.windowMs)) hits.delete(id);
}, 60 * 60 * 1000).unref();

// ---------- The AI call ----------
async function callModel(numbers) {
  if (FAKE_AI) {
    return { answer: { summary: "Test summary.", questions: ["Test question?"] }, cost: 0 };
  }
  const key = process.env.OPENROUTER_API_KEY;
  if (!key || key.includes("replace-with-your-key")) throw Object.assign(new Error("The AI summary isn't set up on this server."), { status: 503 });
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "X-Title": "Homeward" },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1200,
      reasoning: { effort: "low" },
      response_format: { type: "json_schema", json_schema: { name: "homeward_summary", strict: true, schema: RESPONSE_SCHEMA } },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: buildUserMessage(numbers) },
      ],
      usage: { include: true },
    }),
    signal: AbortSignal.timeout(60_000),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok || body?.error) {
    console.error("OpenRouter error", res.status, body?.error?.message);
    throw Object.assign(new Error("The AI summary is unavailable right now. Try again later."), { status: 502 });
  }
  let answer;
  try { answer = cleanAnswer(JSON.parse(body?.choices?.[0]?.message?.content ?? "")); }
  catch { throw Object.assign(new Error("The AI's answer wasn't in the expected format. Try again."), { status: 502 }); }
  return { answer, cost: body.usage?.cost ?? null };
}

function readBody(req, limit = 4096) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) { reject(Object.assign(new Error("Request too large."), { status: 413 })); req.destroy(); }
      else chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

// ---------- Web server ----------
const server = http.createServer(async (req, res) => {
  try {
    const host = String(req.headers.host || "").toLowerCase();
    if (!ALLOWED_HOSTS.has(host)) return sendJson(res, 403, { error: "Forbidden" });
    const urlPath = String(req.url || "/").split("?")[0];

    if (req.method === "GET" && urlPath === "/healthz") return sendJson(res, 200, { ok: true });

    if (req.method === "POST" && urlPath === "/api/summary") {
      // Only this app's own pages may call the paid route: same-origin JSON requests.
      const origin = String(req.headers.origin || "");
      const okOrigin = [...ALLOWED_HOSTS].some((h) => origin === `https://${h}` || origin === `http://${h}`);
      if (!okOrigin) return sendJson(res, 403, { error: "Forbidden" });
      if (!String(req.headers["content-type"]).startsWith("application/json")) return sendJson(res, 415, { error: "Expected JSON" });

      const limit = rateLimit(clientId(req));
      if (!limit.ok) return sendJson(res, 429, { error: limit.why }, { "Retry-After": String(limit.retry) });

      let payload;
      try { payload = JSON.parse(await readBody(req)); } catch (err) {
        return sendJson(res, err.status || 400, { error: err.status === 413 ? "Request too large." : "Expected JSON" });
      }
      const numbers = validateNumbers(payload && payload.numbers);
      if (!numbers) return sendJson(res, 400, { error: "Those numbers don't look right. Reload the page and try again." });

      const started = Date.now();
      const { answer, cost } = await callModel(numbers);
      // Log the cost and timing only, never the numbers.
      console.log(`summary ok in ${Date.now() - started} ms, cost ${cost ?? "n/a"}`);
      return sendJson(res, 200, answer);
    }

    if (req.method === "GET" || req.method === "HEAD") {
      const file = fileFor(urlPath);
      if (file) return sendFile(res, file);
    }
    sendJson(res, 404, { error: "Not found" });
  } catch (err) {
    console.error(err);
    if (!res.headersSent) sendJson(res, err.status || 500, { error: err.status ? err.message : "Something went wrong." });
  }
});

if (require.main === module) {
  server.on("error", (err) => {
    if (err.code === "EADDRINUSE") console.error(`Port ${PORT} is already in use. Is Homeward already running in another terminal?`);
    else console.error(err);
    process.exit(1);
  });
  server.listen(PORT, BIND, () => {
    console.log(`Homeward is running at http://localhost:${PORT}  (model: ${MODEL})`);
    if (!ON_RENDER) console.log("Press Ctrl+C to stop.");
  });
}

module.exports = { server, PORT, LIMITS, rateLimit, fileFor, clientId };
