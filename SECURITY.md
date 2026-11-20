# SECURITY.md — Homeward security audit (Build 3)

**Lane:** Beginner. **App type:** AI app, no database, no sign-in.
**Last updated:** Nov 19, 2026. **Live URL:** _added after the first Render deploy_.

## What the app holds
- **Nothing on the server.** The calculator runs in the browser. What a family types stays in that browser (a convenience copy in its local storage) or in a share link they choose to create. The server has no database and writes no files.
- **One paid route:** `POST /api/summary` sends rounded numbers (in $ millions) and two labels (situation, recovery speed) to OpenRouter and returns a short summary. No names, addresses or free text are accepted.
- **Public data only** in `docs/market-data/`: neighborhood totals and ~330 m grid squares built from CAL FIRE, City of LA, HMDA, CA Department of Insurance and FHFA data. Squares with fewer than 10 homes are dropped. Raw files with addresses stay in `private/raw-data/`, which git ignores and the server never serves.

## What I checked, what I found, what I fixed

| # | Check | Result | Fix |
|---|---|---|---|
| 1 | **Secret key search, repo:** searched for `sb_secret_`, `service_role`, `sk-or-`, `sk-ant-`, `sk-proj-`, `sk_live_` in every tracked file | Only the placeholder `sk-or-v1-replace-with-your-key` in `.env.example`, and the search pattern itself in `scripts/check-live-rate-limit.js` | None needed. Real key lives only in `.env` (git-ignored) and Render's settings |
| 2 | **Secret key search, Git history:** `git log -p --all` for real key patterns | Nothing found. `.env` was never committed | None needed |
| 3 | **Secret key search, live site:** `npm run check:live` fetches every page and script the app serves and searches them | _Run after deploy; screenshot in submission_ | — |
| 4 | **Rate limit on the paid route:** 30 calls in a row (`tests/server-routes.js` locally, `npm run check:live` on the live site) | Calls after the visitor's 5th in 10 minutes return **429** with a plain message and `Retry-After` | Added per-visitor limits (5 per 10 min, 20 per day) and an app-wide cap (200 per day) |
| 5 | **Spending cap:** OpenRouter key | Key has a spending limit set in OpenRouter | _Confirm the limit resets monthly (see "Left to do")_ |
| 6 | **Other websites calling the paid route** | Before: the old local app trusted any request from localhost | Route now requires a same-origin `Origin` header and JSON; tested: other origin → 403, no origin → 403, text → 415 |
| 7 | **Host header / DNS rebinding** | Only the app's own host names are answered; anything else → 403 | Kept from Build 2, extended to Render's host name |
| 8 | **Path traversal and file exposure:** `.env`, server code, `private/`, `data/`, `../` and `%2e%2e` tricks, removed files | All 404 (tested, 34 paths) | Strict allowlist of files and folders |
| 9 | **Input validation on the AI route** | Extra fields (e.g. an address), out-of-range numbers, and text injected into labels are all rejected (400) | `summary-prompt.js` accepts exactly 14 fields with fixed ranges and two fixed labels |
| 10 | **Oversized requests** | Bodies over 4 KB are cut off (413) | Body size limit |
| 11 | **Prompt injection** | The AI never sees free text from visitors, only validated numbers and fixed labels, so there's nothing to inject. Its answer is clipped and shown as plain text (`textContent`), never as HTML | Validation + plain-text rendering |
| 12 | **Cross-site scripting** | No user text is ever inserted as HTML. Names in family decision mode and the AI answer are set with `textContent` / input values | Reviewed all DOM writes |
| 13 | **Malicious share links** | A crafted link could carry odd keys (like `__proto__`) | The calculator now copies only known fields and clamps every number; test added |
| 14 | **Analytics leaking numbers** | Session replay could have recorded results on screen; share-link numbers could appear in page URLs | `ph-no-capture` on all inputs and results; share-link data removed from the address bar before PostHog loads; events carry only labels and counts (tested) |
| 15 | **Security headers** | Added a Content-Security-Policy (scripts only from this site and PostHog), `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`, and HSTS on Render | Tested locally |
| 16 | **Dependencies:** `npm audit` | **0 vulnerabilities** (the app has no npm dependencies) | — |
| 17 | **Agent security review** | Asked the coding agent to try to break the app: the attempts above (#6–#14), plus spamming the route and malformed JSON | Fixes listed above; all covered by `npm test` |
| 18 | **Deploy safety** | Render runs `npm test` as the build step, so a failing test blocks a deploy. Rollback steps are in AGENTS.md | `render.yaml` |

## How to reproduce the security test
- Locally (free): `npm test` → see "30 calls in a row: rate limit kicks in (429)".
- Live (a few cents): `npm run check:live -- https://<app>.onrender.com` → the key search result, then calls 1–30 with their status codes.

## Left to do / known limits
- **Confirm the OpenRouter spending cap is monthly.** The key has a dollar limit; check in OpenRouter's key settings that it resets monthly rather than being a one-time total.
- **Rate limits reset when the server restarts.** They're kept in memory, and Render's free tier restarts the app after 15 minutes idle. The daily caps are therefore "per running server". The OpenRouter spending cap is the hard backstop.
- **Visitor identity for the rate limit** uses the last address in `X-Forwarded-For` added by Render's proxy. If several visitors share a proxy address, they share a limit (stricter, not looser).
- **The CSP allows inline scripts,** because PostHog's official snippet and the share-link scrub are inline. Script sources are still limited to this site and PostHog.
- **Share links contain the family's numbers** (and any names typed into family decision mode). They're never sent to the server, but anyone who has the link can read them. The page says so when the link is copied.
- **Local storage:** the browser keeps the last numbers for convenience. Anyone using the same browser profile can see them.
