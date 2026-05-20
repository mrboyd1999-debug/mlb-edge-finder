DFS Proxy Patch V2

WHAT THIS FIXES:
Your old proxy was installed, but it called dead unofficial DFS URLs.
PrizePicks returned 404 because that URL does not exist anymore.

This version removes the dead hardcoded URLs.

FILES:
api/prizepicks.js
api/underdog.js

HOW TO INSTALL:
1. Replace your current api/prizepicks.js with this one.
2. Replace your current api/underdog.js with this one.
3. Keep frontend calls as:
   fetch("/api/prizepicks")
   fetch("/api/underdog")

WHAT YOU NEED FOR TRUE LIVE DFS LINES:
You must connect a real provider endpoint.

In Vercel:
Project -> Settings -> Environment Variables

Add:
PRIZEPICKS_PROXY_URL = your working PrizePicks provider/scraper endpoint
UNDERDOG_PROXY_URL = your working Underdog provider/scraper endpoint

Then redeploy:
npx vercel --prod

Without those provider URLs, the app should fall back to manual pasted lines instead of showing a broken 404.
