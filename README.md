# DFS Pick'em Analytics

PrizePicks + Underdog reference tool for finding safer streak picks and tracking saved results. The app is a reference tool only; it does not place picks or manage a real streak.

## Install

```bash
npm install
```

## Run Locally

```bash
npm run dev -- --host 0.0.0.0
```

Open:

```text
http://localhost:5173
```

## Settings

Open the Settings panel at the top of the app and paste any values you want to use at runtime:

- `VITE_ODDS_API_KEY`
- `PRIZEPICKS_PROXY_URL`
- `UNDERDOG_PROXY_URL`

These are saved in `localStorage`, so normal local use does not require editing `.env`. After saving settings, click `Refresh (clear cache)`.

## Manual Paste Lines

If live APIs fail, open `Manual Paste Lines` and paste one prop per line.

Example:

```text
PrizePicks MLB Aaron Judge Total Bases 1.5 More vs BOS 2026-05-22 7:05 PM
Underdog WNBA A'ja Wilson Rebounds 9.5 Less vs NY 2026-05-22 8:00 PM
```

Manual pasted lines are parsed into cards, but they are marked `Fallback / demo data - not bettable` until real stats/model data are available.

## API Route Checks

These local routes should return JSON only:

```text
http://localhost:5173/api/prizepicks
http://localhost:5173/api/prizepicks/projections
http://localhost:5173/api/underdog
http://localhost:5173/api/underdog/beta/v3/over_under_lines
```

If an upstream service is blocked or a proxy is misconfigured, the route should still return JSON with a readable error, such as:

```json
{
  "ok": false,
  "error": true,
  "message": "API route is serving source/HTML instead of JSON. Check proxy/backend routing.",
  "props": []
}
```

If you see raw JavaScript source code or HTML in the browser, the dev proxy/backend route is not being used. Start the app with:

```bash
npm run dev -- --host 0.0.0.0
```

Then refresh the API route.

## Result Tracking

Generated top picks are saved to localStorage for model review. In `Accuracy Review`, manually mark results:

- Win
- Loss
- Push
- Void
- Pending

The dashboard tracks total picks, wins, losses, pushes, hit rate, and breakdowns by sport/category/platform.
