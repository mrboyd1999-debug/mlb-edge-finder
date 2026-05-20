const DEFAULT_TTL_MS = 7.5 * 60 * 1000;
const memoryCache = new Map();

function cacheKey(url, init = {}) {
  const method = (init.method || "GET").toUpperCase();
  return `${method}:${url}`;
}

export function clearApiCache() {
  memoryCache.clear();
  try {
    const keys = [];
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const key = window.localStorage.key(i);
      if (key && (key.startsWith("dfs-fetch-cache:") || key === "dfs-prizepicks-last-good-payload")) {
        keys.push(key);
      }
    }
    keys.forEach((key) => window.localStorage.removeItem(key));
  } catch {
    // ignore storage errors
  }
}

export async function cachedFetch(url, init = {}, ttlMs = DEFAULT_TTL_MS) {
  const key = cacheKey(url, init);
  const now = Date.now();
  const cached = memoryCache.get(key);
  if (cached && now - cached.fetchedAt < ttlMs) {
    return cached.clone ? cached.response.clone() : cached.response;
  }

  try {
    const stored = window.localStorage.getItem(`dfs-fetch-cache:${key}`);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (parsed?.body != null && now - parsed.fetchedAt < ttlMs) {
        const response = new Response(parsed.body, {
          status: parsed.status || 200,
          headers: { "content-type": parsed.contentType || "application/json" },
        });
        memoryCache.set(key, { response, fetchedAt: parsed.fetchedAt });
        return response.clone();
      }
    }
  } catch {
    // ignore parse/storage errors
  }

  const response = await fetch(url, init);
  const clone = response.clone();
  const bodyText = await clone.text();

  memoryCache.set(key, {
    response: new Response(bodyText, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    }),
    fetchedAt: now,
  });

  try {
    window.localStorage.setItem(
      `dfs-fetch-cache:${key}`,
      JSON.stringify({
        body: bodyText,
        status: response.status,
        contentType: response.headers.get("content-type") || "application/json",
        fetchedAt: now,
      })
    );
  } catch {
    // storage full — memory cache still works
  }

  return new Response(bodyText, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

export function getCacheTtlMs() {
  return DEFAULT_TTL_MS;
}
