# DFS Pick'em Analytics

PrizePicks + Underdog reference tool for finding safer MLB prop picks and tracking saved results. The app is a reference tool only; it does not place picks or manage a real streak.

**Current mode:** MLB-only with verified sportsbook props, cache fallback, and rate-limit protection.

## Install

```bash
npm install
```

## Run locally

```bash
npm run dev
```

Open [http://localhost:5173](http://localhost:5173).

The dev server proxies `/api/*` routes so PrizePicks, Underdog, Odds API, and stats endpoints return JSON instead of raw HTML.

## API keys and environment variables

### Option A — `.env.local` (recommended for first setup)

```bash
cp .env.example .env.local
```

Edit `.env.local` and paste your keys:

| Variable | Purpose |
|----------|---------|
| `VITE_ODDS_API_KEY` | The Odds API — sportsbook line comparison |
| `VITE_SPORTSDATA_API_KEY` | Optional BallDontLie / stats enrichment |
| `VITE_STATMUSE_API_KEY` | Optional — reserved for future StatMuse wiring |
| `VITE_PRIZEPICKS_PROXY_URL` | External proxy when PrizePicks direct fetch is blocked |
| `VITE_UNDERDOG_PROXY_URL` | External proxy when Underdog direct fetch is blocked |

Shorter aliases `VITE_PRIZEPICKS_PROXY` and `VITE_UNDERDOG_PROXY` are also accepted.

All keys are read through `src/config/apiConfig.js`, which honours the resolution
order: **localStorage override → Vite env → legacy storage key**. Missing keys
never crash the app — `validateApiConfig()` surfaces warnings inside the
Settings panel.

Restart `npm run dev` after changing `.env.local`.

### Option B — Settings panel (browser localStorage)

1. Open the app → **Settings**
2. Enter keys and proxy URLs
3. Click **Save settings**
4. Click **Test API Connections**
5. Review statuses in **API Health**
6. Click **Refresh lines**

Settings saved in localStorage override empty env values for development. They are stored on your device only.

### Security notes

- Never commit `.env.local` or paste real keys into source code.
- `VITE_*` variables are bundled into the frontend — only use providers that allow browser or proxy-side keys.
- For production, prefer Vercel **server-side** env vars for proxies (`APIFY_TOKEN`, `PRIZEPICKS_PROXY_URL`) when the provider must stay private.

## Deploy to Vercel

1. Push the repo to GitHub and import the project in Vercel.
2. Add environment variables in **Project → Settings → Environment Variables**:

   - `VITE_ODDS_API_KEY` (if using client-side Odds API via proxy)
   - `VITE_PRIZEPICKS_PROXY_URL` / `VITE_UNDERDOG_PROXY_URL` (optional)
   - `APIFY_TOKEN` + `UNDERDOG_APIFY_ACTOR` (optional Apify fallback)
   - Server-side: `ODDS_API_KEY`, `PRIZEPICKS_PROXY_URL`, `UNDERDOG_PROXY_URL`

3. Deploy. The `api/` folder routes run as serverless functions on Vercel.

## Daily use flow

1. Open app
2. Confirm **Settings** keys are saved (or env vars set)
3. **Test API Connections** — expect LIVE / CACHED / DEGRADED / NOT CONFIGURED (never a crash)
4. **Refresh lines**
5. Review **Accepted Props**, **Top 2 Picks**, and **Ready to Bet**
6. During provider downtime, verified cache props remain available with a clear degraded banner

## Provider priority (MLB)

1. PrizePicks live lines  
2. Underdog live lines  
3. Odds API sportsbook comparison  
4. SportsData / MLB Stats API  
5. Verified cache (not used for Top Picks when expired)

## Proxy fallback order

For PrizePicks and Underdog:

1. Local `/api/*` proxy route (Vite dev or Vercel serverless)
2. Configured `VITE_*_PROXY_URL` if direct fetch fails (CORS / blocking)
3. Verified cache fallback
4. Degraded status shown in API Health

## Manual paste lines

If live APIs fail, open **Manual Paste Lines** and paste one prop per line:

```text
PrizePicks MLB Aaron Judge Total Bases 1.5 More vs BOS 2026-05-22 7:05 PM
```

Manual pasted lines are marked as fallback until real stats/model data are available.

## API route checks

These routes should return JSON only:

```text
http://localhost:5173/api/health
http://localhost:5173/api/prizepicks
http://localhost:5173/api/underdog
http://localhost:5173/api/sportsbookOdds?path=/v4/sports&apiKey=YOUR_KEY
```

Use **Test API Connections** in Settings for a full provider report with LIVE / CACHED / DEGRADED / FAILED / NOT CONFIGURED statuses.

## Result tracking

Generated top picks are saved to localStorage for model review. In **Accuracy Review**, manually mark results: Win, Loss, Push, Void, or Pending.
