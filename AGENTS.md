# AGENTS.md — Coding Agent Operating Manual

> Give this file to your coding agent and check that it is using these instructions. Keep the stack, commands, and ground rules current.

## 1. Project Overview
- **What this repo builds:** Homeward, a single source of truth for families rebuilding after a wildfire. It tracks what the HOA, builder, insurer, and city each said, and flags when they contradict each other.
- **Primary user & core workflow:** [See the living PRD in `docs/index.html`]
- **Tech stack:** Node.js 21+ (no npm dependencies) / plain HTML page / OpenRouter API (default model `anthropic/claude-opus-5.5`) / saved data in a local JSON file under `data/` (git-ignored)
- **Main files:** `server.js` (web server, AI call, saving, and serving the shared `docs/` pages), `prompt.js` (AI instructions and answer schema), `public/index.html` (the Conflict Tracker page), `docs/` (Business Directory (`business-map.html`), Recovery Resources, shared `theme.css` and `nav.js`, photos, fonts, data; published on GitHub Pages and also served by the local app), `tests/server-routes.js` (route test), `tests/posthog-pages.js` (analytics check), `tests/run-samples.js` (sample test). See the folder map in section 3.
- **Private data:** real family documents go in `private/`; saved claims go in `data/`. Both are git-ignored and must never be committed.

## 2. Setup From Scratch
1. **Clone:** `git clone https://github.com/building-with-ai-f26/lmw8154-homeward.git`, then `cd lmw8154-homeward`.
2. **Node.js 21 or newer:** check with `node --version`. There is nothing to install: the app has no npm dependencies (it uses Node's built-in `fetch` and `.env` loading).
3. **Keys:** `cp .env.example .env`, then open `.env` and set `OPENROUTER_API_KEY` to your key from https://openrouter.ai/keys. `OPENROUTER_MODEL` is optional (default `anthropic/claude-opus-5.5`). Never commit `.env`; git ignores it.
4. **Run:** `npm start`, then open http://localhost:3000. The nav links the Conflict Tracker, Business Directory and Recovery Resources; the last two are the same `docs/` files GitHub Pages publishes.
5. **Check:** `npm test` (free, a few seconds). Optionally `npm run test:samples` (real AI, about $0.20).
6. **PostHog:** nothing to set up locally; see section 4.

## 3. Commands and Folders
- **Run locally:** `npm start`, then open http://localhost:3000 (`PORT=3001 npm start` if 3000 is taken)
- **Run deterministic tests:** `npm test`. Free, no AI calls. It runs:
  - `tests/server-routes.js`: pages and shared files load, nothing outside the allowlist is reachable, local-only checks hold. If you add a file the app should serve from `docs/`, add it to the allowlist in `server.js` and to this test.
  - `tests/posthog-pages.js`: every HTML page in `docs/` and `public/` has the PostHog snippet, and the Conflict Tracker keeps its masking and custom events.
- **Run model evals:** `npm run test:samples` (calls the real AI, about $0.20 per run; compare output with `samples/ANSWER_KEY.md`)

```
server.js            Web server: AI call, saving, serves allowlisted docs/ files
prompt.js            AI instructions and answer schema
public/index.html    Conflict Tracker (local app only)
docs/                GitHub Pages site, also served by the local app
  index.html         Product Page (Living PRD, build log)
  business-map.html  Business Directory
  resources.html     Recovery Resources
  theme.css, nav.js  Shared styles and navigation
  images/, fonts/    Photos; self-hosted Fraunces font (license in fonts/OFL.txt)
  map-data/, resources-data/   JSON the pages load
research/            Hand-compiled source data (copied into docs/ for the pages)
samples/             Fictional email threads and ANSWER_KEY.md
tests/               npm test checks and the paid sample run
journal/             Weekly build notes
data/                Saved claims (git-ignored, never commit)
private/             Real family documents (git-ignored, never commit)
.env                 Your keys (git-ignored); template in .env.example
```

## 4. Analytics (PostHog)
- **Where:** PostHog's official snippet sits in the `<head>` of every page in `docs/` and `public/`. Project region is US (`https://us.i.posthog.com`). The project key in the snippet is a public key by design, not a secret; it is not an `.env` value.
- **What's collected:** pageviews, autocaptured clicks, and session replay with every input masked (`maskAllInputs: true`). Session replay must also be turned on in the PostHog project settings.
- **What's never collected:** on the Conflict Tracker, the thread box, summary line, claims, conflicts and open questions have the `ph-no-capture` class, so replays and click capture skip them.
- **Custom events (Conflict Tracker):** `thread_analyzed` with `conflict_count` (new conflicts in that run) and `duration_ms`; `conflict_flagged` with `party_pair` such as `"builder vs city"` (one of the four roles, otherwise "other"). Never send thread text, statements, quotes, names or addresses.

## 5. Non-Negotiable Engineering Rules
1. **Plan before coding:** Before touching multiple files, propose a brief plan and wait for approval.
2. **Small batches:** Make small, focused changes that can be reviewed and explained by a human in a single Pull Request.
3. **Explainability:** Avoid unnecessary abstractions or dependencies. Help the human builder understand the main components, what changed, why it matters, what could break, and how it was checked.
4. **Verify changes:** Run relevant checks. For a reproducible logic bug, use a failing test to demonstrate the fix when practical. Record manual checks and known limitations; follow the selected Build 4 evaluation track.
5. **Zero secrets in code:** Never hardcode API keys, tokens, or credentials. Always read from environment variables (`.env`) and update `.env.example` when new variables are needed.
6. **Stop when looping:** If a fix fails twice in a row, stop, summarize what failed, and ask the human before trying a third approach.
7. **Analytics and docs stay current:** Every page in docs/ and public/ must include the PostHog snippet. Keep the thread_analyzed and conflict_flagged events and the ph-no-capture masking on the thread box and results when changing the Conflict Tracker. If a change affects how the app works, its cost, folders or commands, update PRD v2 on the Product Page and AGENTS.md too.
