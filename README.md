# MLB Edge Finder

A Vite + React app that pulls today's MLB games from the MLB Stats API and analyzes prop markets through an Anthropic Claude proxy.

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Copy the example env file and add your API key locally:
   ```bash
   cp .env.example .env
   ```

3. Run locally:
   ```bash
   npm run dev
   ```

4. Add your API key in Vercel as `OPENAI_API_KEY` or `ANTHROPIC_KEY`.

If your OpenAI key is rate limited or has insufficient quota, the app will now fall back to Anthropic if `ANTHROPIC_KEY` is available.

> If the site returns `API error: 429`, that means your OpenAI key was rate limited or exceeded quota. Wait a minute and try again, or switch to a lower-cost model such as `gpt-3.5-turbo`.

## Deployment

Deploy this repo to Vercel with the framework preset `Vite`.

Place the `api/analyze.js` file in the root `api/` folder so Vercel can use it as a serverless function.
