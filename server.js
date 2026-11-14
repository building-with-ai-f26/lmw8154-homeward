// Homeward Build 1 prototype: a small local web server with no dependencies.
// Start it with `npm start`, then open http://localhost:3000.
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { SYSTEM_PROMPT, RESPONSE_SCHEMA, buildUserMessage } = require("./prompt.js");

// Read OPENROUTER_API_KEY (and the optional OPENROUTER_MODEL) from .env.
try {
  process.loadEnvFile(path.join(__dirname, ".env"));
} catch {
  // No .env file. callModel() reports a clear error instead of crashing here.
}

const MODEL = process.env.OPENROUTER_MODEL || "anthropic/claude-opus-5.5";
const PORT = Number(process.env.PORT) || 3000;
// Saved claims live in data/, which git ignores. The sample test uses its own file.
const DATA_FILE = process.env.HOMEWARD_DATA_FILE || path.join(__dirname, "data", "claims.json");
const PAGE = path.join(__dirname, "public", "index.html");

// ---------- Shared pages and files from docs/ ----------
// The Business Directory and Recovery Resources pages (and the theme, fonts, photos and
// data they use) are served straight from docs/, the same files GitHub Pages
// publishes, so there is one copy of each. Only what's listed here can be served:
// nothing else in the repo (data/, private/, .env, server code) is reachable.
const DOCS = path.join(__dirname, "docs");
const DOCS_FILES = new Map([
  ["/business-map.html", "business-map.html"],
  ["/resources.html", "resources.html"],
  ["/theme.css", "theme.css"],
  ["/nav.js", "nav.js"],
]);
const DOCS_FOLDERS = new Set(["images", "fonts", "map-data", "resources-data"]);
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".jpg": "image/jpeg",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
};
const FOLDER_FILE_TYPES = new Set([".jpg", ".woff2", ".json", ".txt"]);

// Returns the docs/ file for a URL path, or null if it isn't one we serve.
function docsFileFor(urlPath) {
  if (DOCS_FILES.has(urlPath)) return path.join(DOCS, DOCS_FILES.get(urlPath));
  // One folder plus one plain file name, e.g. /images/hero-coast.jpg. The pattern
  // rules out "..", slashes and %-encoded tricks, so a path can't leave its folder.
  const m = urlPath.match(/^\/([a-z-]+)\/([A-Za-z0-9][A-Za-z0-9._-]*)$/);
  if (!m || !DOCS_FOLDERS.has(m[1]) || !FOLDER_FILE_TYPES.has(path.extname(m[2]))) return null;
  const file = path.join(DOCS, m[1], m[2]);
  return file.startsWith(path.join(DOCS, m[1]) + path.sep) ? file : null; // belt and braces
}

async function sendDocsFile(res, file) {
  let body;
  try {
    body = await fs.promises.readFile(file);
  } catch (err) {
    if (err.code === "ENOENT" || err.code === "EISDIR") return sendJson(res, 404, { error: "Not found" });
    throw err;
  }
  res.writeHead(200, {
    "Content-Type": TYPES[path.extname(file)] || "application/octet-stream",
    "X-Content-Type-Options": "nosniff", // the browser must use the type above, never guess
  });
  res.end(body);
}

// ---------- Saved data ----------

function emptyStore() {
  return { threads: 0, nextId: 1, claims: [], conflicts: [], questions: [], totalCost: 0 };
}

function loadStore() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  } catch (err) {
    if (err.code === "ENOENT") return emptyStore();
    throw err;
  }
}

function saveStore(store) {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  const tmp = DATA_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2));
  fs.renameSync(tmp, DATA_FILE); // swap in one step, so a crash can't leave a half-written file
}

// ---------- The AI call ----------

async function callModel(userMessage) {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key || key.includes("replace-with-your-key")) {
    throw new Error("OPENROUTER_API_KEY is missing from .env.");
  }
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      "X-Title": "Homeward (local prototype)",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 16000,
      reasoning: { effort: "low" },
      response_format: {
        type: "json_schema",
        json_schema: { name: "homeward_analysis", strict: true, schema: RESPONSE_SCHEMA },
      },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userMessage },
      ],
      usage: { include: true },
    }),
    signal: AbortSignal.timeout(180_000),
  });

  const body = await res.json().catch(() => null);
  if (!res.ok || body?.error) {
    throw new Error(`OpenRouter error ${res.status}: ${body?.error?.message || "no details"}`);
  }
  const choice = body?.choices?.[0];
  if (choice?.finish_reason === "length") {
    throw new Error("The AI's answer was cut off because it ran too long. Try a shorter thread.");
  }
  let result;
  try {
    result = JSON.parse(choice?.message?.content ?? "");
  } catch {
    throw new Error("The AI's answer wasn't in the expected format. Try again.");
  }
  return { result, cost: body.usage?.cost ?? null };
}

// ---------- One analysis: extract, compare, save ----------

async function analyzeThread(text, store) {
  const { result, cost } = await callModel(buildUserMessage(store, text));
  const thread = store.threads + 1;

  // Give each new claim a permanent id (c1, c2, ...), remembering the AI's temporary ref (n1, n2, ...).
  const refToId = new Map();
  const newClaimIds = [];
  for (const c of result.claims) {
    const id = `c${store.nextId++}`;
    refToId.set(c.ref, id);
    newClaimIds.push(id);
    store.claims.push({ id, thread, party: c.party, topic: c.topic, date: c.date, statement: c.statement, quote: c.quote });
  }

  // Conflicts must point at real claims. Drop any that don't, rather than show made-up statements.
  const known = new Set(store.claims.map((c) => c.id));
  const resolve = (ref) => refToId.get(ref) ?? (known.has(ref) ? ref : null);
  const newConflictIds = [];
  for (const k of result.conflicts) {
    const earlier = resolve(k.earlier);
    const later = resolve(k.later);
    if (!earlier || !later || earlier === later) {
      console.warn("Skipped a conflict that pointed at unknown claims:", k);
      continue;
    }
    const id = `k${store.conflicts.length + 1}`;
    newConflictIds.push(id);
    store.conflicts.push({ id, thread, kind: k.kind, topic: k.topic, summary: k.summary, earlier, later });
  }

  for (const q of result.open_questions) {
    store.questions.push({ thread, topic: q.topic, question: q.question, ask: q.ask });
  }

  store.threads = thread;
  store.totalCost += cost ?? 0;
  return { thread, newClaimIds, newConflictIds, newQuestions: result.open_questions.length, cost };
}

// What the page needs: conflicts come with both full statements attached.
function publicState(store) {
  const byId = new Map(store.claims.map((c) => [c.id, c]));
  return {
    model: MODEL,
    threads: store.threads,
    totalCost: store.totalCost,
    claims: store.claims,
    conflicts: store.conflicts.map((k) => ({ ...k, earlier: byId.get(k.earlier), later: byId.get(k.later) })),
    questions: store.questions,
  };
}

// ---------- Web server ----------

function readBody(req, limit = 500_000) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error("That text is too long (over 500 KB)."));
        req.destroy();
      } else {
        chunks.push(chunk);
      }
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function sendJson(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

const ALLOWED_HOSTS = new Set([`localhost:${PORT}`, `127.0.0.1:${PORT}`]);

const server = http.createServer(async (req, res) => {
  try {
    // Only answer this computer's own browser. This blocks other websites from
    // sending requests here and spending your OpenRouter credit.
    if (!ALLOWED_HOSTS.has(req.headers.host)) return sendJson(res, 403, { error: "Forbidden" });
    if (req.method === "POST" && !String(req.headers["content-type"]).startsWith("application/json")) {
      return sendJson(res, 415, { error: "Expected JSON" });
    }

    if (req.method === "GET" && req.url === "/") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      return res.end(fs.readFileSync(PAGE));
    }
    if (req.method === "GET" && req.url === "/api/state") {
      return sendJson(res, 200, publicState(loadStore()));
    }
    if (req.method === "POST" && req.url === "/api/analyze") {
      const { text } = JSON.parse(await readBody(req));
      if (typeof text !== "string" || !text.trim()) {
        return sendJson(res, 400, { error: "Paste an email thread or letter first." });
      }
      const store = loadStore();
      const run = await analyzeThread(text, store);
      saveStore(store);
      return sendJson(res, 200, { run, state: publicState(store) });
    }
    if (req.method === "GET") {
      const file = docsFileFor(req.url.split("?")[0]);
      if (file) return sendDocsFile(res, file);
    }
    if (req.method === "POST" && req.url === "/api/clear") {
      const store = emptyStore();
      saveStore(store);
      return sendJson(res, 200, { state: publicState(store) });
    }
    sendJson(res, 404, { error: "Not found" });
  } catch (err) {
    console.error(err);
    sendJson(res, 500, { error: err.message });
  }
});

if (require.main === module) {
  server.on("error", (err) => {
    if (err.code === "EADDRINUSE") console.error(`Port ${PORT} is already in use. Is Homeward already running in another terminal?`);
    else console.error(err);
    process.exit(1);
  });
  server.listen(PORT, "127.0.0.1", () => {
    console.log(`Homeward is running at http://localhost:${PORT}  (model: ${MODEL})`);
    console.log("Press Ctrl+C to stop.");
  });
}

module.exports = { analyzeThread, emptyStore, loadStore, saveStore, publicState, MODEL, DATA_FILE, server, PORT };
