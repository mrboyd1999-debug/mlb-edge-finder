/** Strip paste artifacts from API keys — shared by API routes and client. */
export function cleanApiKey(value) {
  return String(value || "")
    .trim()
    .replace(/^["']|["']$/g, "")
    .replace(/^(the\s+)?odds(\s+api)?(\s+key)?:?\s*/i, "")
    .replace(/^sportsdata(io)?(\s+api)?(\s+key)?:?\s*/i, "")
    .replace(/[\r\n\t]+/g, "")
    .replace(/\s+/g, "");
}
