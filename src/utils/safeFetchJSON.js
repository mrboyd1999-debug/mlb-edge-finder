/**
 * Fetch helper that never throws — returns parsed JSON or a structured error object.
 */
export async function safeFetchJSON(url, options = {}) {
  try {
    const res = await fetch(url, options);
    const text = await res.text();
    try {
      const data = JSON.parse(text);
      return { ok: res.ok, status: res.status, data, text };
    } catch {
      console.error("Non-JSON response:", text.slice(0, 300));
      return {
        ok: false,
        success: false,
        error: "Non-JSON response",
        raw: text.slice(0, 300),
        status: res.status,
        text,
      };
    }
  } catch (err) {
    return {
      ok: false,
      success: false,
      error: err?.message || String(err),
    };
  }
}
