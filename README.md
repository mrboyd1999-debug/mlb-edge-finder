# MLB Edge Finder

A Vite + React app that pulls today's MLB games from the MLB Stats API and analyzes prop markets through an Anthropic Claude proxy.

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Run locally:
   ```bash
   npm run dev
   ```

3. Add your Anthropic key in Vercel as `ANTHROPIC_KEY` for deployment.

## Deployment

Deploy this repo to Vercel with the framework preset `Vite`.

Place the `api/analyze.js` file in the root `api/` folder so Vercel can use it as a serverless function.
