const imageCache = new Map();

export function rememberPlayerImage(url) {
  if (!url) return;
  imageCache.set(url, true);
}

export function hasCachedPlayerImage(url) {
  return Boolean(url && imageCache.has(url));
}

export function preloadPlayerImage(url) {
  if (!url || imageCache.has(url)) return;
  const img = new Image();
  img.onload = () => imageCache.set(url, true);
  img.onerror = () => imageCache.set(url, false);
  img.src = url;
}
