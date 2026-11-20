# AGENTS.md — Coding Agent Operating Manual

> Give this file to your coding agent and check that it is using these instructions. Keep the stack, commands, and ground rules current.

## 1. Project Overview
- **What this repo builds:** Homeward, a decision tool for Pacific Palisades homeowners after the January 2025 Palisades fire. It compares rebuilding, selling and holding with the family's own numbers (break-even, projection ranges, family decision mode, an AI plain-language summary) and shows how the neighborhood is recovering from public data.
- **Primary user & core workflow:** [See the living PRD (v3) in `docs/index.html`]
- **Tech stack:** Node.js 21+ (no npm dependencies) / plain HTML, CSS and JavaScript / OpenRouter API for the AI summary only (default model `anthropic/claude-opus-5.5`) / hosted on Render (free tier) / no database, no sign-in.
- **Privacy model:** all math runs in the browser; what a family types stays on their device (and in a share link only if they create one). The server stores nothing. The AI summary receives rounded numbers only, never names or addresses.
- **Private data:** raw downloads and personal files go in `private/` (git-ignored); old saved data is in `data/` (git-ignored). Neither is ever committed or served.

## 2. Setup From Scratch
1. **Clone:** `git clone https://github.com/building-with-ai-f26/lmw8154-homeward.git`, then `cd lmw8154-homeward`.
2. **Node.js 21 or newer:** check with `node --version`. There is nothing to install: the app has no npm dependencies.
3. **Keys (only for the AI summary):** `cp .env.example .env`, then set `OPENROUTER_API_KEY`. Never commit `.env`; git ignores it. The calculator and recovery pulse work without a key.
4. **Run:** `npm start`, then open http://localhost:3000.
5. **Check:** `npm test` (free, a few seconds, uses a fake AI).

## 3. Commands and Folders
- **Run locally:** `npm start`, then http://localhost:3000 (`PORT=3001 npm start` if 3000 is taken)
- **Run all deterministic tests:** `npm test`. Free, no AI calls. It runs:
  - `tests/calc.js`: calculator math against numbers worked out by hand, plus bad-input handling.
  - `tests/server-routes.js`: pages load, nothing outside the allowlist is reachable, host and origin checks, input checks on the AI route, security headers, and the rate limit (30 calls in a row, refused with 429).
  - `tests/posthog-pages.js`: every page has PostHog, the Decide page keeps `ph-no-capture` on inputs and results, and analytics events carry no numbers or names.
- **Live security test:** `npm run check:live -- https://<app>.onrender.com` (searches the live site's code for secret keys, then calls the AI route 30 times; costs a few cents).
- **Rebuild neighborhood data:** `npm run build:data` (needs Python 3 with `openpyxl`, and the raw files in `private/raw-data/`; see `docs/market-data/SOURCES.md`).

```
server.js              Web server: serves allowlisted files, POST /api/summary (rate-limited), security headers
summary-prompt.js      AI summary instructions, input checks and answer clean-up
render.yaml            Render deploy settings (no secrets)
public/                The app (served by server.js)
  index.html           Landing page
  decide.html, decide.js   Rebuild, sell, or hold calculator
  pulse.html, pulse.js     Recovery pulse
  calc.js              All calculator math (browser and tests)
  app.css, landing.js  App styles; landing decoration and live numbers
docs/                  GitHub Pages site (Product Page), plus shared files the app also serves
  index.html           Product Page (Living PRD, build log)
  resources.html       Recovery Resources
  editorial.css, nav.js    Shared styles and navigation
  images/, fonts/      Photos; self-hosted Fraunces font (license in fonts/OFL.txt)
  market-data/         Neighborhood totals (built by scripts/build_market_data.py) and SOURCES.md
  resources-data/      Recovery Resources data
scripts/               build_market_data.py, check-live-rate-limit.js
tests/                 npm test checks
private/, data/        Git-ignored; never committed, never served
```

## 4. Analytics (PostHog)
- **Where:** PostHog's official snippet sits in the `<head>` of every page in `docs/` and `public/`. Region US (`https://us.i.posthog.com`). The `phc_` project key is public by design.
- **What's collected:** pageviews, autocaptured clicks, and session replay with every input masked.
- **What's never collected:** on the Decide page, the inputs form (`#inputs`) and results (`#results`) have `ph-no-capture`, so replays and click capture skip everything a family types or sees as a result. Shared-link numbers are removed from the address bar before PostHog loads.
- **Custom events:** `scenario_changed` (situation, speed), `summary_requested` (situation, speed), `share_link_created`, `print_clicked`, `family_member_added` (people count), `pulse_grid_mode` (mode). Never send dollar amounts, names or addresses.

## 5. Shipping (deploying to Render)
First deploy (the human does steps 1–4; the agent can guide):
1. Sign in at render.com with GitHub and give Render access to `building-with-ai-f26/lmw8154-homeward`. If the organization blocks it, ask the instructor to approve Render for the repo.
2. In Render: **New → Blueprint**, pick the repo. Render reads `render.yaml` (one free Node web service, tests run as the build step, health check `/healthz`).
3. When asked for `OPENROUTER_API_KEY`, paste the key into Render's form. Never put it in a file, a commit, or a chat.
4. Click **Apply** and wait for "Live". Copy the `https://<name>.onrender.com` address.
5. Agent: set `APP_URL` in `docs/nav.js` and the live link on the Product Page to that address, run `npm test`, then (after asking) commit and push. Render redeploys automatically on every push to `main`.

Every later deploy:
1. `npm test` must pass locally (Render runs it again and refuses to deploy if it fails).
2. Ask before pushing to `main` (pushing deploys).
3. After Render shows "Live": open `/healthz`, load `/`, `/decide` and `/pulse` on a phone-sized screen, and check PostHog shows a pageview from the live site.

Rollback: Render dashboard → the service → **Events/Deploys** → pick the last good deploy → **Rollback**. Then fix forward with a new commit.

## 6. Ask Me First
Stop and ask the human before:
- Deleting files or data, or rewriting Git history.
- Anything touching keys, secrets, `.env`, Render environment variables, or account and repo permissions.
- Anything that costs money: real AI calls (`npm run check:live`, testing the summary), changing the AI model, upgrading a Render plan, adding a paid service.
- Pushing to `main` (it deploys) or changing deploy settings in `render.yaml`.
- Adding an npm dependency or any new outside service, script or font host.
- Changing what analytics collect or what the AI receives.

## 7. Non-Negotiable Engineering Rules
1. **Plan before coding:** Before touching multiple files, propose a brief plan and wait for approval.
2. **Small batches:** Make small, focused changes that can be reviewed and explained by a human in a single Pull Request.
3. **Explainability:** Avoid unnecessary abstractions or dependencies. Help the human builder understand the main components, what changed, why it matters, what could break, and how it was checked.
4. **Verify changes:** Run `npm test`. For a reproducible logic bug, add a failing test first when practical. Look at changed pages in a browser at desktop and phone widths; tests don't catch layout problems.
5. **Zero secrets in code:** Never hardcode API keys, tokens, or credentials. Locally they come from `.env`; on Render from its Environment settings.
6. **Stop when looping:** If a fix fails twice in a row, stop, summarize what failed, and ask the human before trying a third approach.
7. **Privacy and analytics stay intact:** Every page includes the PostHog snippet. Keep `ph-no-capture` on the Decide inputs and results, the shared-link scrub before PostHog loads, and number-free events. The server must never store or log what visitors type; the AI gets only the fields in `summary-prompt.js`. Public data is shown as neighborhood totals only: never addresses, parcels or single properties.
8. **Docs stay current:** If a change affects how the app works, its cost, folders, commands or hosting, update PRD v3 on the Product Page, this file, and `SECURITY.md` in the same change.
9. **Never delete before the search has run (from a real mistake):** On Nov 15 the agent deleted `docs/theme.css` before its reference search had actually run (the shell mangled the command, so the search printed nothing and that looked like "no references"). Before deleting or renaming a file, run the reference search, confirm it printed real output, and show it.
10. **Numbers shown to users must be traceable (from a real mistake):** Earlier map and log drafts said "Pacific Palisades" for Santa Monica Canyon businesses and "last checked" for dates nobody checked. Every figure or label on a page must match its source file, with the source named on the page.
11. **Run security tests against the live site, not just locally (from a real mistake):** The rate limit passed every local test, but the first live run let 15 of 30 calls through, because behind Render's proxies the visitor's address looked different on each request. After any change to the server or hosting, run `npm run check:live` (ask first: it costs a few cents).
